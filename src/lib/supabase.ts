import { createClient, SupabaseClient, User } from '@supabase/supabase-js'
import { Contact } from '../types/contact'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? ''
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? ''
const PHOTO_BUCKET = 'card-photos'
const SIGNED_URL_TTL_SECONDS = 60 * 60
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()

export const SUPABASE_SCHEMA_SQL = `create extension if not exists "pgcrypto";

create table if not exists public.contacts (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
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
  front_image_url text default '',
  back_image_url text default '',
  stars integer default 0,
  sent_to_sheets boolean default false,
  scanned_at text default '',
  created_at timestamptz default now()
);

alter table public.contacts enable row level security;

drop policy if exists "contacts_select_own" on public.contacts;
create policy "contacts_select_own"
on public.contacts for select
using (auth.uid() = user_id);

drop policy if exists "contacts_insert_own" on public.contacts;
create policy "contacts_insert_own"
on public.contacts for insert
with check (auth.uid() = user_id);

drop policy if exists "contacts_update_own" on public.contacts;
create policy "contacts_update_own"
on public.contacts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "contacts_delete_own" on public.contacts;
create policy "contacts_delete_own"
on public.contacts for delete
using (auth.uid() = user_id);

create index if not exists contacts_user_id_created_at_idx
on public.contacts (user_id, created_at desc);

insert into storage.buckets (id, name, public)
values ('card-photos', 'card-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "card_photos_select_own" on storage.objects;
create policy "card_photos_select_own"
on storage.objects for select
using (bucket_id = 'card-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "card_photos_insert_own" on storage.objects;
create policy "card_photos_insert_own"
on storage.objects for insert
with check (bucket_id = 'card-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "card_photos_update_own" on storage.objects;
create policy "card_photos_update_own"
on storage.objects for update
using (bucket_id = 'card-photos' and auth.uid()::text = (storage.foldername(name))[1])
with check (bucket_id = 'card-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "card_photos_delete_own" on storage.objects;
create policy "card_photos_delete_own"
on storage.objects for delete
using (bucket_id = 'card-photos' and auth.uid()::text = (storage.foldername(name))[1]);`

let client: SupabaseClient | null = null

function sanitizeContactForDB(contact: Contact, userId: string) {
  const { front_image, back_image, ...rest } = contact
  void front_image
  void back_image

  return {
    ...rest,
    user_id: userId,
  }
}

async function requireUser(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Sign in required')
  return user
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
}

export function initSupabase(
  url: string = SUPABASE_URL,
  key: string = SUPABASE_ANON_KEY
): void {
  client = url && key
    ? createClient(url, key, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      })
    : null
}

export function getSupabaseClient(): SupabaseClient | null {
  return client
}

export async function getCurrentUser(): Promise<User | null> {
  if (!client) return null

  const {
    data: { session },
  } = await client.auth.getSession()

  if (session?.user) return session.user

  const {
    data: { user },
  } = await client.auth.getUser()

  return user ?? null
}

export async function getAccessToken(): Promise<string | null> {
  if (!client) return null

  const {
    data: { session },
  } = await client.auth.getSession()

  return session?.access_token ?? null
}

export async function startDemoSession(): Promise<User> {
  if (!client) throw new Error('Supabase not configured')

  const existingUser = await getCurrentUser()
  if (existingUser) return existingUser

  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw error ?? new Error('Unable to start demo session')
  return data.user
}

export async function endDemoSession(): Promise<void> {
  if (!client) return
  const { error } = await client.auth.signOut()
  if (error) throw error
}

export function onAuthStateChange(callback: (user: User | null) => void): () => void {
  if (!client) return () => undefined

  const { data } = client.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null)
  })

  return () => data.subscription.unsubscribe()
}

export async function syncContactsFromDB(): Promise<Contact[]> {
  if (!client) return []

  const user = await getCurrentUser()
  if (!user) return []

  const { data, error } = await client
    .from('contacts')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((contact) =>
    ({
      ...contact,
      user_id: contact.user_id ?? user.id,
      front_image: '',
      back_image: '',
    }) as Contact
  )
}

export async function saveContactToDB(contact: Contact): Promise<boolean> {
  if (!client) return false

  const user = await requireUser()
  const row = sanitizeContactForDB(contact, user.id)
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

  const results = await Promise.allSettled(contacts.map((contact) => saveContactToDB(contact)))

  let ok = 0
  let failed = 0

  results.forEach((result) => {
    if (result.status === 'fulfilled' && result.value) ok += 1
    else failed += 1
  })

  return { ok, failed }
}

export async function deleteContactFromDB(id: string): Promise<boolean> {
  if (!client) return false

  await requireUser()
  const { error } = await client.from('contacts').delete().eq('id', id)

  if (error) {
    console.warn('Supabase delete error:', error)
    return false
  }

  return true
}

export async function testSupabaseConnection(): Promise<void> {
  if (!client) throw new Error('Supabase not configured')
  await requireUser()

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

  const user = await requireUser()

  try {
    const byteChars = atob(base64)
    const byteArray = new Uint8Array(byteChars.length)
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i)
    }

    const blob = new Blob([byteArray], { type: mimeType })
    const path = `${user.id}/${contactId}/${side}.jpg`

    const { error } = await client.storage
      .from(PHOTO_BUCKET)
      .upload(path, blob, { upsert: true, contentType: mimeType })

    if (error) {
      console.warn('Photo upload error:', error)
      return null
    }

    signedUrlCache.delete(path)
    return path
  } catch (err) {
    console.warn('Photo upload failed:', err)
    return null
  }
}

export async function getSignedPhotoUrl(path: string): Promise<string | null> {
  if (!client || !path) return null

  const cached = signedUrlCache.get(path)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url
  }

  const { data, error } = await client.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

  if (error || !data?.signedUrl) {
    console.warn('Signed URL error:', error)
    return null
  }

  signedUrlCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - 30) * 1000,
  })

  return data.signedUrl
}
