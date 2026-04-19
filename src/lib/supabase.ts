import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Contact } from '../types/contact'

let client: SupabaseClient | null = null

export function initSupabase(url: string, key: string): void {
  client = url && key ? createClient(url, key) : null
}

export function getSupabaseClient(): SupabaseClient | null {
  return client
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

/** Upserts a contact — strips base64 images since they're too large for DB */
export async function saveContactToDB(contact: Contact): Promise<void> {
  if (!client) return
  const row = { ...contact, front_image: '', back_image: '' }
  const { error } = await client.from('contacts').upsert(row, { onConflict: 'id' })
  if (error) console.warn('Supabase upsert error:', error)
}

export async function deleteContactFromDB(id: string): Promise<void> {
  if (!client) return
  const { error } = await client.from('contacts').delete().eq('id', id)
  if (error) console.warn('Supabase delete error:', error)
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
