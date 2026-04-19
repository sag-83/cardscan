import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Contact } from '../types/contact'

export const SUPABASE_SCHEMA_SQL = `create table if not exists contacts (
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
);`

let client: SupabaseClient | null = null

export function initSupabase(url: string, key: string): void {
  client = url && key ? createClient(url, key) : null
}

export function getSupabaseClient(): SupabaseClient | null {
  return client
}

function sanitizeContactForDB(contact: Contact): Contact {
  return {
    ...contact,
    front_image: '',
    back_image: '',
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