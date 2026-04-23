import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Contact } from '../types/contact'

export const SUPABASE_SCHEMA_SQL = `-- 1. Create table (safe to re-run)
create table if not exists contacts (
  id text primary key,
  name text default '',
  title text default '',
  company text default '',
  email text default '',
  phone_mobile text default '',
  phone_work text default '',
  phone_fax text default '',
  website text default '',
  address text default '',
  city text default '',
  state text default '',
  zip text default '',
  country text default '',
  notes text default '',
  back_notes text default '',
  user_notes text default '',
  front_image text default '',
  back_image text default '',
  front_image_url text default '',
  back_image_url text default '',
  stars integer default 0,
  scanned_at text default '',
  created_at timestamptz default now()
);

-- 2. Remove user_id if it exists from a previous setup
alter table contacts drop column if exists user_id;

-- 3. Allow anonymous read/write (no auth used in this app)
alter table contacts disable row level security;`

let client: SupabaseClient | null = null

export function initSupabase(url: string, key: string): void {
  client = url && key ? createClient(url, key) : null
}

export function getSupabaseClient(): SupabaseClient | null {
  return client
}

function sanitizeContactForDB(contact: Contact): Record<string, unknown> {
  return {
    id:              contact.id,
    name:            contact.name,
    title:           contact.title,
    company:         contact.company,
    email:           contact.email,
    phone_mobile:    contact.phone_mobile,
    phone_work:      contact.phone_work,
    phone_fax:       contact.phone_fax,
    website:         contact.website,
    address:         contact.address,
    city:            contact.city,
    state:           contact.state,
    zip:             contact.zip,
    country:         contact.country,
    notes:           contact.notes,
    back_notes:      contact.back_notes,
    user_notes:      contact.user_notes,
    front_image:     '',
    back_image:      '',
    front_image_url: contact.front_image_url,
    back_image_url:  contact.back_image_url,
    stars:           contact.stars,
    scanned_at:      contact.scanned_at,
    created_at:      contact.created_at,
  }
}

export async function syncContactsFromDB(): Promise<Contact[]> {
  if (!client) return []

  const { data, error } = await client
    .from('contacts')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as Contact[]
}

export async function saveContactToDB(contact: Contact): Promise<boolean> {
  if (!client) return false

  const row = sanitizeContactForDB(contact)
  const { error } = await client.from('contacts').upsert(row, { onConflict: 'id' })

  if (error) {
    console.warn('Supabase upsert error:', error)
    return false
  }

  return true
}

export async function saveContactsToDB(contacts: Contact[]): Promise<{
  ok: number
  failed: number
}> {
  if (!contacts.length) return { ok: 0, failed: 0 }

  const results = await Promise.allSettled(contacts.map((c) => saveContactToDB(c)))

  let ok = 0
  let failed = 0

  results.forEach((r) => {
    if (r.status === 'fulfilled' && r.value) ok += 1
    else failed += 1
  })

  return { ok, failed }
}

export async function deleteContactFromDB(id: string): Promise<boolean> {
  if (!client) return false

  const { error } = await client.from('contacts').delete().eq('id', id)

  if (error) {
    console.warn('Supabase delete error:', error)
    return false
  }

  return true
}

export async function testSupabaseConnection(): Promise<void> {
  if (!client) throw new Error('Supabase not configured')

  const { error } = await client.from('contacts').select('id').limit(1)
  if (error) throw error
}

export async function uploadCardPhoto(
  contactId: string,
  side: 'front' | 'back',
  base64: string,
  mimeType = 'image/jpeg'
): Promise<string | null> {
  if (!client || !base64) return null
  try {
    const byteChars = atob(base64)
    const byteArray = new Uint8Array(byteChars.length)
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i)
    }
    const blob = new Blob([byteArray], { type: mimeType })
    const path = `${contactId}_${side}.jpg`

    const { error } = await client.storage
      .from('card-photos')
      .upload(path, blob, { upsert: true, contentType: mimeType })

    if (error) {
      console.warn('Photo upload error:', error)
      return null
    }

    const { data } = client.storage.from('card-photos').getPublicUrl(path)
    return data?.publicUrl ?? null
  } catch (err) {
    console.warn('Photo upload failed:', err)
    return null
  }
}