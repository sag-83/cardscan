import { Contact } from '../types/contact'


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
    name:      sheetsText(c.name),
    title:     sheetsText(c.title),
    company:   sheetsText(c.company),
    email:     sheetsText(c.email),
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
