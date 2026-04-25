import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Contact } from '../types/contact'
import { contactDedupKey, findDuplicateContact, mergeContact } from './utils'

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
  area text default '',
  notes text default '',
  back_notes text default '',
  user_notes text default '',
  front_image text default '',
  back_image text default '',
  front_image_url text default '',
  back_image_url text default '',
  dedupe_key text default '',
  stars integer default 0,
  visited boolean default false,
  is_customer boolean default false,
  followup_at timestamptz,
  followup_note text default '',
  scanned_at text default '',
  created_at timestamptz default now()
);

-- 2. Make older tables match the current app
alter table contacts drop column if exists user_id;
alter table contacts add column if not exists dedupe_key text default '';
alter table contacts add column if not exists area text default '';
alter table contacts add column if not exists visited boolean default false;
alter table contacts add column if not exists is_customer boolean default false;
alter table contacts add column if not exists followup_at timestamptz;
alter table contacts add column if not exists followup_note text default '';

-- 3. Backfill and enforce duplicate protection
update contacts
set dedupe_key = coalesce(
  nullif('email:' || lower(trim(email)), 'email:'),
  case
    when length(regexp_replace(coalesce(phone_mobile, phone_work, phone_fax, ''), '\\D', '', 'g')) >= 7
    then 'phone:' || regexp_replace(regexp_replace(coalesce(phone_mobile, phone_work, phone_fax, ''), '\\D', '', 'g'), '^1(?=\\d{10}$)', '')
  end,
  nullif('name-company:' || lower(trim(name)) || '|' || lower(trim(company)), 'name-company:|'),
  'id:' || id
)
where dedupe_key is null or dedupe_key = '';

delete from contacts
where id in (
  select id
  from (
    select id, row_number() over (
      partition by dedupe_key
      order by created_at desc, id desc
    ) as duplicate_rank
    from contacts
    where dedupe_key <> ''
  ) ranked
  where duplicate_rank > 1
);

create unique index if not exists contacts_dedupe_key_idx
on contacts (dedupe_key)
where dedupe_key <> '';

-- 4. Allow anonymous read/write (no auth used in this app)
alter table contacts disable row level security;`

let client: SupabaseClient | null = null
let lastError = ''

export function initSupabase(url: string, key: string): void {
  client = url && key ? createClient(url, key) : null
  lastError = client ? '' : 'Supabase URL or anon key is missing'
}

export function getSupabaseClient(): SupabaseClient | null {
  return client
}

export function getLastSupabaseError(): string {
  return lastError
}

function rememberSupabaseError(prefix: string, err: unknown): void {
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message)
      : String(err)

  lastError = `${prefix}: ${message}`
}

function ensureSupabaseClient(): SupabaseClient | null {
  if (client) return client

  const url = import.meta.env.VITE_SUPABASE_URL as string
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

  if (url && key) {
    client = createClient(url, key)
    lastError = ''
    return client
  }

  lastError = 'Supabase env is missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel.'
  return null
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
    area:            contact.area,
    notes:           contact.notes,
    back_notes:      contact.back_notes,
    user_notes:      contact.user_notes,
    front_image:     '',
    back_image:      '',
    front_image_url: contact.front_image_url,
    back_image_url:  contact.back_image_url,
    dedupe_key:      contactDedupKey(contact),
    stars:           contact.stars,
    visited:         contact.visited ?? false,
    is_customer:     contact.is_customer ?? false,
    followup_at:     contact.followup_at || null,
    followup_note:   contact.followup_note || '',
    scanned_at:      contact.scanned_at,
    created_at:      contact.created_at,
  }
}

function withoutDedupeKey(row: Record<string, unknown>): Record<string, unknown> {
  const { dedupe_key, ...rest } = row
  void dedupe_key
  return rest
}

function missingColumnFromError(error: { message?: string } | null): string | null {
  const message = error?.message ?? ''
  const quotedColumn = message.match(/'([^']+)' column/)
  if (quotedColumn?.[1]) return quotedColumn[1]

  const plainColumn = message.match(/column "([^"]+)"/)
  if (plainColumn?.[1]) return plainColumn[1]

  return null
}

async function upsertContactRow(
  sb: SupabaseClient,
  row: Record<string, unknown>,
  omitDedupeKey: boolean
): Promise<boolean> {
  let nextRow = omitDedupeKey ? withoutDedupeKey(row) : row
  const removedColumns = new Set<string>()

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await sb.from('contacts').upsert(nextRow, { onConflict: 'id' })

    if (!error) return true

    const missingColumn = missingColumnFromError(error)
    if (missingColumn && missingColumn in nextRow && !removedColumns.has(missingColumn)) {
      const { [missingColumn]: _removed, ...rest } = nextRow
      void _removed
      nextRow = rest
      removedColumns.add(missingColumn)
      continue
    }

    rememberSupabaseError('Supabase save failed', error)
    console.warn('Supabase upsert error:', error)
    return false
  }

  lastError = 'Supabase save failed: too many table schema mismatches. Run the SQL in Settings.'
  return false
}

export async function syncContactsFromDB(): Promise<Contact[]> {
  const sb = ensureSupabaseClient()
  if (!sb) return []

  const { data, error } = await sb
    .from('contacts')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    rememberSupabaseError('Supabase sync failed', error)
    throw error
  }
  return (data ?? []) as Contact[]
}

export async function findDuplicateContactInDB(contact: Contact): Promise<Contact | null> {
  const sb = ensureSupabaseClient()
  if (!sb) return null

  const key = contactDedupKey(contact)
  const { data, error } = await sb
    .from('contacts')
    .select('*')
    .eq('dedupe_key', key)
    .maybeSingle()

  const dedupeColumnMissing = Boolean(
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    error?.message?.toLowerCase().includes('dedupe_key')
  )

  if (data) return data as Contact

  if (error && error.code !== 'PGRST116' && !dedupeColumnMissing) {
    rememberSupabaseError('Supabase duplicate check failed', error)
    console.warn('Supabase duplicate check error:', error)
    return null
  }

  if (!dedupeColumnMissing) return null

  const fallback = await sb.from('contacts').select('*')
  if (fallback.error) {
    rememberSupabaseError('Supabase duplicate check failed', fallback.error)
    console.warn('Supabase duplicate fallback error:', fallback.error)
    return null
  }

  return findDuplicateContact(contact, (fallback.data ?? []) as Contact[]) ?? null
}

export async function saveContactToDB(contact: Contact): Promise<'new' | 'merged' | false> {
  const sb = ensureSupabaseClient()
  if (!sb) return false

  let row = sanitizeContactForDB(contact)

  const { data: existing, error: lookupError } = await sb
    .from('contacts')
    .select('*')
    .eq('dedupe_key', contactDedupKey(contact))
    .maybeSingle()

  const dedupeColumnMissing = Boolean(
    lookupError?.code === '42703' ||
    lookupError?.code === 'PGRST204' ||
    lookupError?.message?.toLowerCase().includes('dedupe_key')
  )

  if (lookupError && lookupError.code !== 'PGRST116' && !dedupeColumnMissing) {
    console.warn('Supabase duplicate lookup error:', lookupError)
  }

  const wasMerged = existing && existing.id !== contact.id
  if (wasMerged) {
    const merged = mergeContact(existing as Contact, contact)
    row = sanitizeContactForDB({ ...merged, id: existing.id })
  }

  const ok = await upsertContactRow(sb, row, dedupeColumnMissing)
  if (!ok) return false
  return wasMerged ? 'merged' : 'new'
}

async function saveContactToDBForce(contact: Contact): Promise<'new' | false> {
  const sb = ensureSupabaseClient()
  if (!sb) return false
  const row = sanitizeContactForDB(contact)
  const ok = await upsertContactRow(sb, row, false)
  return ok ? 'new' : false
}

export async function saveContactsToDB(
  contacts: Contact[],
  opts?: { skipDedupe?: boolean }
): Promise<{
  ok: number
  merged: number
  failed: number
  error?: string
}> {
  if (!contacts.length) return { ok: 0, merged: 0, failed: 0 }

  const results = await Promise.allSettled(
    contacts.map((c) => opts?.skipDedupe ? saveContactToDBForce(c) : saveContactToDB(c))
  )

  let ok = 0
  let merged = 0
  let failed = 0

  results.forEach((r) => {
    if (r.status === 'fulfilled' && r.value === 'new') ok += 1
    else if (r.status === 'fulfilled' && r.value === 'merged') merged += 1
    else failed += 1
  })

  return { ok, merged, failed, error: failed ? lastError : undefined }
}

export async function deleteContactFromDB(id: string): Promise<boolean> {
  const sb = ensureSupabaseClient()
  if (!sb) return false

  const { error } = await sb.from('contacts').delete().eq('id', id)

  if (error) {
    rememberSupabaseError('Supabase delete failed', error)
    console.warn('Supabase delete error:', error)
    return false
  }

  return true
}

export async function testSupabaseConnection(): Promise<void> {
  const sb = ensureSupabaseClient()
  if (!sb) throw new Error(lastError || 'Supabase not configured')

  const { error } = await sb.from('contacts').select('id').limit(1)
  if (error) {
    rememberSupabaseError('Supabase test failed', error)
    throw error
  }
}

export async function uploadCardPhoto(
  contactId: string,
  side: 'front' | 'back',
  base64: string,
  mimeType = 'image/jpeg'
): Promise<string | null> {
  const sb = ensureSupabaseClient()
  if (!sb || !base64) return null
  try {
    const byteChars = atob(base64)
    const byteArray = new Uint8Array(byteChars.length)
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i)
    }
    const blob = new Blob([byteArray], { type: mimeType })
    const path = `${contactId}_${side}.jpg`

    const { error } = await sb.storage
      .from('card-photos')
      .upload(path, blob, { upsert: true, contentType: mimeType })

    if (error) {
      rememberSupabaseError('Photo upload failed', error)
      console.warn('Photo upload error:', error)
      return null
    }

    const { data } = sb.storage.from('card-photos').getPublicUrl(path)
    return data?.publicUrl ?? null
  } catch (err) {
    rememberSupabaseError('Photo upload failed', err)
    console.warn('Photo upload failed:', err)
    return null
  }
}
