import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Contact } from '../types/contact'

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

export const SUPABASE_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT, title TEXT, company TEXT, email TEXT,
  phone_mobile TEXT, phone_work TEXT, phone_fax TEXT,
  website TEXT, address TEXT, city TEXT,
  state TEXT, zip TEXT, country TEXT,
  notes TEXT, user_notes TEXT, back_notes TEXT,
  stars INT DEFAULT 0, scanned_at TEXT,
  front_image TEXT, back_image TEXT,
  front_image_url TEXT, back_image_url TEXT,
  sent_to_sheets BOOL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all" ON contacts
 FOR ALL USING (true) WITH CHECK (true);`