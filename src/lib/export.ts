import { Contact } from '../types/contact'
import { SavedInvoice } from '../types/invoice'

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

/** Columns Google My Maps expects for Import → place markers. */
const MY_MAPS_HEADERS = [
  'Name',
  'Address',
  'City',
  'State',
  'Zip Code',
  'Full Address',
  'Phone',
  'Email',
]

function contactPinName(c: Contact): string {
  return (c.company || c.name || 'Customer').trim()
}

function fullAddressLine(parts: {
  address?: string
  city?: string
  state?: string
  zip?: string
}): string {
  return [parts.address, parts.city, parts.state, parts.zip]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ')
}

function canMapAddress(parts: {
  address?: string
  city?: string
  state?: string
  zip?: string
}): boolean {
  const street = (parts.address ?? '').trim()
  const city = (parts.city ?? '').trim()
  const state = (parts.state ?? '').trim()
  const zip = (parts.zip ?? '').trim()
  // Street + city/ZIP pins best; city+state alone still drops a town pin.
  if (street && (city || zip || state)) return true
  if (city && state) return true
  if (zip.length >= 5) return true
  return false
}

/**
 * CSV shaped for Google My Maps → Import.
 * Only contacts with a usable address are included; multi-location cards
 * get one row per extra address.
 */
export function exportForGoogleMyMaps(contacts: Contact[]): {
  exported: number
  skipped: number
} {
  const rows: string[] = []
  let skipped = 0

  for (const c of contacts) {
    const primary = {
      address: c.address,
      city: c.city,
      state: c.state,
      zip: c.zip,
    }
    const extras = Array.isArray(c.extra_addresses) ? c.extra_addresses : []
    const locations = [primary, ...extras]
    let wroteOne = false

    locations.forEach((loc, index) => {
      if (!canMapAddress(loc)) return
      const name = index === 0
        ? contactPinName(c)
        : `${contactPinName(c)} (${index + 1})`
      const who = c.company && c.name && c.company !== c.name ? c.name : ''
      const label = who && index === 0 ? `${name} — ${who}` : name
      rows.push(
        [
          label,
          (loc.address ?? '').trim(),
          (loc.city ?? '').trim(),
          (loc.state ?? '').trim(),
          (loc.zip ?? '').trim(),
          fullAddressLine(loc),
          c.phone_mobile || c.phone_work || '',
          c.email || '',
        ]
          .map(csvQuote)
          .join(','),
      )
      wroteOne = true
    })

    if (!wroteOne) skipped++
  }

  if (!rows.length) {
    return { exported: 0, skipped }
  }

  // UTF-8 BOM helps Excel/Sheets open the file without mangling names.
  const blob = new Blob(
    ['\uFEFF' + MY_MAPS_HEADERS.join(',') + '\n' + rows.join('\n')],
    { type: 'text/csv;charset=utf-8' },
  )
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = `google_my_maps_customers_${new Date().toISOString().split('T')[0]}.csv`
  anchor.click()
  return { exported: rows.length, skipped }
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

export async function sendInvoiceToSheets(invoice: SavedInvoice): Promise<void> {
  const itemsSummary = invoice.items
    .map((it) => `${it.size} x${it.pcs} ${it.ct.toFixed(2)}ct`)
    .join('; ')
  const row = {
    date:        sheetsText(invoice.date),
    company:     sheetsText(invoice.company),
    contactName: sheetsText(invoice.contactName),
    state:       sheetsText(invoice.state),
    city:        sheetsText(invoice.city),
    docKind:     sheetsText(invoice.docKind),
    paidBy:      sheetsText(invoice.paidBy),
    items:       sheetsText(itemsSummary),
    total:       invoice.total,
    notes:       sheetsText(invoice.notes),
    savedAt:     sheetsText(invoice.saved_at),
    invoiceNumber: sheetsText(invoice.invoiceNumber ?? ''),
  }
  const res = await fetch('/api/invoice-sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([row]),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? `Server error ${res.status}`)
  }
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
