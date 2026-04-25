import { Contact } from '../types/contact'

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function norm(s: string | undefined | null): string {
  return (s ?? '').toUpperCase().trim()
}

export function mUrl(u: string): string {
  if (!u) return u
  return /^https?:\/\//.test(u) ? u : 'https://' + u
}

export function formatDate(d: string): string {
  if (!d || d === 'UNKNOWN') return 'UNKNOWN'
  try {
    return new Date(d)
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      .toUpperCase()
  } catch {
    return d
  }
}

export function initials(c: Pick<Contact, 'name' | 'company'>): string {
  return (c.name || c.company || '?')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function normalizeContact(c: Contact): Contact {
  return {
    ...c,
    company: norm(c.company),
    city: norm(c.city),
    state: norm(c.state),
    zip: norm(c.zip),
    country: norm(c.country),
    email: (c.email ?? '').toLowerCase().trim(),
  }
}

function compact(s: string | undefined | null): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function phoneKey(s: string | undefined | null): string {
  return (s ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
}

export function contactDedupKey(c: Partial<Contact>): string {
  const email = compact(c.email)
  if (email) return `email:${email}`

  const phone = phoneKey(c.phone_mobile) || phoneKey(c.phone_work) || phoneKey(c.phone_fax)
  if (phone.length >= 7) return `phone:${phone}`

  const name = compact(c.name)
  const company = compact(c.company)
  if (name && company) return `name-company:${name}|${company}`
  if (company && compact(c.address)) return `company-address:${company}|${compact(c.address)}`

  return `id:${c.id ?? ''}`
}

function scoreContact(c: Contact): number {
  return [
    c.name,
    c.title,
    c.company,
    c.email,
    c.phone_mobile,
    c.phone_work,
    c.phone_fax,
    c.website,
    c.address,
    c.city,
    c.state,
    c.zip,
    c.country,
    c.notes,
    c.back_notes,
    c.user_notes,
    c.front_image,
    c.back_image,
    c.front_image_url,
    c.back_image_url,
  ].filter(Boolean).length + c.stars
}

export function mergeContact(existing: Contact, incoming: Contact): Contact {
  const base = scoreContact(incoming) > scoreContact(existing) ? incoming : existing
  const other = base === incoming ? existing : incoming

  return normalizeContact({
    ...base,
    name: base.name || other.name,
    title: base.title || other.title,
    company: base.company || other.company,
    email: base.email || other.email,
    phone_mobile: base.phone_mobile || other.phone_mobile,
    phone_work: base.phone_work || other.phone_work,
    phone_fax: base.phone_fax || other.phone_fax,
    website: base.website || other.website,
    address: base.address || other.address,
    city: base.city || other.city,
    state: base.state || other.state,
    zip: base.zip || other.zip,
    country: base.country || other.country,
    area: base.area || other.area,
    notes: base.notes || other.notes,
    back_notes: base.back_notes || other.back_notes,
    user_notes: base.user_notes || other.user_notes,
    front_image: base.front_image || other.front_image,
    back_image: base.back_image || other.back_image,
    front_image_url: base.front_image_url || other.front_image_url,
    back_image_url: base.back_image_url || other.back_image_url,
    stars: Math.max(base.stars, other.stars),
    sent_to_sheets: base.sent_to_sheets || other.sent_to_sheets,
    visited: base.visited || other.visited,
    is_customer: base.is_customer || other.is_customer,
    followup_at: base.followup_at || other.followup_at,
    followup_note: base.followup_note || other.followup_note,
    scanned_at: base.scanned_at || other.scanned_at,
    created_at: base.created_at || other.created_at,
  })
}

export function dedupeContacts(contacts: Contact[]): Contact[] {
  const byId = new Map<string, Contact>()
  const byFingerprint = new Map<string, Contact>()

  contacts.forEach((contact) => {
    const normalized = normalizeContact(contact)
    const idMatch = byId.get(normalized.id)
    const key = contactDedupKey(normalized)
    const fingerprintMatch = byFingerprint.get(key)
    const match = idMatch ?? fingerprintMatch

    if (match) {
      const merged = { ...mergeContact(match, normalized), id: match.id }
      byId.set(match.id, merged)
      if (normalized.id !== match.id) byId.delete(normalized.id)
      byFingerprint.set(contactDedupKey(merged), merged)
      return
    }

    byId.set(normalized.id, normalized)
    byFingerprint.set(key, normalized)
  })

  return Array.from(byId.values())
}

export function contactSortName(c: Pick<Contact, 'name' | 'company' | 'email'>): string {
  return (c.name || c.company || c.email || '').toLowerCase().trim()
}

export function sortContactsAlphabetically(contacts: Contact[]): Contact[] {
  return [...contacts].sort((a, b) => {
    const aName = contactSortName(a)
    const bName = contactSortName(b)
    if (aName && bName && aName !== bName) return aName.localeCompare(bName)
    if (aName && !bName) return -1
    if (!aName && bName) return 1
    return a.created_at.localeCompare(b.created_at)
  })
}

export function findDuplicateContact(
  contact: Contact,
  contacts: Contact[]
): Contact | undefined {
  const key = contactDedupKey(contact)
  return contacts.find((existing) => existing.id === contact.id || contactDedupKey(existing) === key)
}

export function blankContact(): Contact {
  return {
    id: uid(),
    name: '',
    title: '',
    company: '',
    email: '',
    phone_mobile: '',
    phone_work: '',
    phone_fax: '',
    website: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    country: '',
    area: '',
    notes: '',
    user_notes: '',
    back_notes: '',
    stars: 0,
    scanned_at: new Date().toISOString().split('T')[0],
    front_image: '',
    back_image: '',
    front_image_url: '',
    back_image_url: '',
    sent_to_sheets: false,
    visited: false,
    is_customer: false,
    created_at: new Date().toISOString(),
  }
}

export function groupByDate(contacts: Contact[]): Record<string, Contact[]> {
  return contacts.reduce<Record<string, Contact[]>>((acc, c) => {
    const key = c.scanned_at || 'UNKNOWN'
    if (!acc[key]) acc[key] = []
    acc[key].push(c)
    return acc
  }, {})
}
