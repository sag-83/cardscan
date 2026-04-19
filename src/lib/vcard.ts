import { Contact } from '../types/contact'
import { mUrl } from './utils'

export function downloadVCard(contact: Contact): void {
  const parts = (contact.name ?? '').trim().split(' ')
  const first = parts[0] ?? ''
  const last = parts.slice(1).join(' ')

  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${contact.name || contact.company || 'Unknown'}`,
    `N:${last};${first};;;`,
    `ORG:${contact.company ?? ''}`,
    `TITLE:${contact.title ?? ''}`,
  ]

  if (contact.phone_mobile) lines.push(`TEL;TYPE=CELL:${contact.phone_mobile}`)
  if (contact.phone_work) lines.push(`TEL;TYPE=WORK:${contact.phone_work}`)
  if (contact.phone_fax) lines.push(`TEL;TYPE=FAX:${contact.phone_fax}`)
  if (contact.email) lines.push(`EMAIL:${contact.email}`)

  lines.push(
    `ADR;TYPE=WORK:;;${contact.address ?? ''};${contact.city ?? ''};${contact.state ?? ''};${contact.zip ?? ''};${contact.country ?? ''}`
  )

  if (contact.website) lines.push(`URL:${mUrl(contact.website)}`)

  const notes = [contact.user_notes, contact.notes].filter(Boolean).join(' | ')
  if (notes) lines.push(`NOTE:${notes}`)

  lines.push('END:VCARD')

  const blob = new Blob([lines.join('\n')], { type: 'text/vcard' })
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = `${(contact.name || contact.company || 'contact').replace(/\s+/g, '_')}.vcf`
  anchor.click()
}
