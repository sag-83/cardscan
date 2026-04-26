import { Contact } from '../types/contact'

const SHEETS_SENT_IDS_KEY = 'cs_sheets_sent_ids_v1'


const CSV_HEADERS = [
  'Name', 'Title', 'Company', 'Email', 'Mobile', 'Work Phone', 'Fax',
  'Website', 'Address', 'City', 'State', 'ZIP', 'Country', 'Stars',
  'Notes', 'Your Notes', 'Scanned',
]

function csvQuote(val: string | number | boolean | undefined | null): string {
  return `"${(val ?? '').toString().replace(/"/g, '""').replace(/\n/g, ' ')}"`
}

function sheetsText(val: string | number | boolean | undefined | null): string {
  const text = (val ?? '').toString().trim()
  if (!text) return ''

  // Prevent Sheets from treating values like +1 555... as formulas.
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function sheetsEmailLink(val: string | undefined | null): string {
  const email = (val ?? '').trim().toLowerCase()
  if (!email) return ''

  const safeEmail = email.match(/^[^\s@"'=+<>]+@[^\s@"'=+<>]+\.[^\s@"'=+<>]+$/)?.[0]
  if (!safeEmail) return sheetsText(email)

  return `=HYPERLINK("mailto:${safeEmail}","${safeEmail}")`
}

export function exportToCSV(contacts: Contact[]): void {
  if (!contacts.length) return
  const rows = contacts.map((c) =>
    [
      c.name, c.title, c.company, c.email, c.phone_mobile, c.phone_work,
      c.phone_fax, c.website, c.address, c.city, c.state, c.zip,
      c.country, c.stars, c.notes, c.user_notes, c.scanned_at,
    ]
      .map(csvQuote)
      .join(',')
  )
  const blob = new Blob([CSV_HEADERS.join(',') + '\n' + rows.join('\n')], {
    type: 'text/csv',
  })
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = `contacts_${new Date().toISOString().split('T')[0]}.csv`
  anchor.click()
}

/**
 * Maps Contact fields to the shape the Apps Script expects:
 * name, title, company, email, phone, phone2, website,
 * address, city, state, country, stars, notes, backNotes, scannedAt
 */
function toSheetsRow(c: Contact) {
  return {
    id:        sheetsText(c.id),
    name:      sheetsText(c.name),
    title:     sheetsText(c.title),
    company:   sheetsText(c.company),
    email:     sheetsEmailLink(c.email),
    phone:     sheetsText(c.phone_mobile),
    phone2:    sheetsText(c.phone_work),
    fax:       sheetsText(c.phone_fax),
    website:   sheetsText(c.website),
    address:   sheetsText(c.address),
    city:      sheetsText(c.city),
    state:     sheetsText(c.state),
    zip:       sheetsText(c.zip),
    country:   sheetsText(c.country),
    stars:     c.stars,
    notes:     sheetsText(c.notes),
    backNotes: sheetsText(c.back_notes),
    userNotes: sheetsText(c.user_notes),
    scannedAt: sheetsText(c.scanned_at),
  }
}

function readSentIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SHEETS_SENT_IDS_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0))
  } catch {
    return new Set()
  }
}

export function hasBeenSentToSheets(contact: Pick<Contact, 'id' | 'sent_to_sheets'>): boolean {
  if (contact.sent_to_sheets) return true
  return readSentIds().has(contact.id)
}

export function filterUnsentContactsForSheets(contacts: Contact[]): Contact[] {
  const sentIds = readSentIds()
  return contacts.filter((contact) => !contact.sent_to_sheets && !sentIds.has(contact.id))
}

export function markContactsSentToSheets(contactIds: string[]): void {
  if (!contactIds.length) return
  const sentIds = readSentIds()
  contactIds.forEach((id) => {
    if (id) sentIds.add(id)
  })
  localStorage.setItem(SHEETS_SENT_IDS_KEY, JSON.stringify(Array.from(sentIds)))
}

export async function sendToGoogleSheets(contacts: Contact[]): Promise<number> {
  // Goes through /api/sheets (Vercel serverless) to avoid Safari CORS issues
  const res = await fetch('/api/sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contacts.map(toSheetsRow)),
  })
  const data = await res.json().catch(() => ({})) as { error?: string; sent?: number }
  if (!res.ok) {
    throw new Error(data.error ?? `Server error ${res.status}`)
  }
  return data.sent ?? contacts.length
}

export function backupToJSON(contacts: Contact[]): void {
  if (!contacts.length) return
  const blob = new Blob(
    [JSON.stringify({ contacts, exportedAt: new Date().toISOString() }, null, 2)],
    { type: 'application/json' }
  )
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = `cardscan_${new Date().toISOString().split('T')[0]}.json`
  anchor.click()
}

export function restoreFromJSON(
  jsonText: string
): { contacts: Contact[]; count: number } {
  const parsed = JSON.parse(jsonText)
  const contacts: Contact[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.contacts)
    ? parsed.contacts
    : []
  if (!contacts.length) throw new Error('No contacts found in file')
  return { contacts, count: contacts.length }
}
