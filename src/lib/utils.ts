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

export function blankContact(): Contact {
  return {
    id: uid(),
    user_id: '',
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
