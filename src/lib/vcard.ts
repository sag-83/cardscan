import { Contact } from '../types/contact'
import { mUrl } from './utils'

/**
 * vCard treats \ ; , and line breaks as syntax, so an unescaped note with a
 * line break in it corrupts every field after it.
 */
function esc(value: string | undefined | null): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

export function buildVCard(contact: Contact): string {
  const person = (contact.name ?? '').trim()
  const company = (contact.company ?? '').trim()

  // The person is the contact; the company only becomes the name when nobody is named on the card.
  const displayName = person || company || 'Unknown'
  const nameParts = person.split(/\s+/).filter(Boolean)
  const first = nameParts[0] ?? ''
  const last = nameParts.slice(1).join(' ')

  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(displayName)}`,
    person ? `N:${esc(last)};${esc(first)};;;` : 'N:;;;;',
  ]

  if (company) lines.push(`ORG:${esc(company)}`)
  if (contact.title) lines.push(`TITLE:${esc(contact.title)}`)
  // Without this Apple Contacts files a company-only card under a blank name.
  if (!person && company) lines.push('X-ABShowAs:COMPANY')

  if (contact.phone_mobile) lines.push(`TEL;TYPE=CELL:${esc(contact.phone_mobile)}`)
  if (contact.phone_work) lines.push(`TEL;TYPE=WORK:${esc(contact.phone_work)}`)
  if (contact.phone_fax) lines.push(`TEL;TYPE=FAX:${esc(contact.phone_fax)}`)
  if (contact.email) lines.push(`EMAIL:${esc(contact.email)}`)

  const addressParts = [contact.address, contact.city, contact.state, contact.zip, contact.country]
  if (addressParts.some((part) => (part ?? '').trim())) {
    const adr = ['', '', ...addressParts.map(esc)].join(';')
    lines.push(`ADR;TYPE=WORK:${adr}`)
  }

  if (contact.website) lines.push(`URL:${esc(mUrl(contact.website))}`)

  const notes = [contact.user_notes, contact.notes].filter(Boolean).join(' | ')
  if (notes) lines.push(`NOTE:${esc(notes)}`)

  lines.push('END:VCARD')

  return lines.join('\r\n')
}

export function downloadVCard(contact: Contact): void {
  const fileBase = (contact.name || contact.company || 'contact').replace(/\s+/g, '_')
  const blob = new Blob([buildVCard(contact)], { type: 'text/vcard' })
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = `${fileBase}.vcf`
  anchor.click()
}
