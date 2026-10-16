import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { SavedInvoice } from '../types/invoice'
import { dueDateLabel, termsLabel } from './invoiceTerms'
import { itemDescriptionLabel } from './invoiceFormUtils'

// Letterhead details, shared with the on-screen invoice preview so the two
// cannot drift apart.
export const COMPANY_LOGO = '/ak-monogram.png'
export const ZELLE_QR = '/zelle-qr.png'

/** Absolute URL so PDF capture can load logo / QR from any render host. */
function assetUrl(path: string): string {
  if (/^(https?:|data:|blob:)/i.test(path)) return path
  if (typeof window === 'undefined') return path
  const origin = window.location.origin
  return path.startsWith('/') ? `${origin}${path}` : `${origin}/${path}`
}
export const COMPANY_ADDRESS = '580 5th Avenue, Ste # 523, New York, NY 10036'
export const COMPANY_PHONE = '8622359224'
export const COMPANY_EMAIL = 'info@akgemsinc.com'

// Standing disclosures printed on every document (kept verbatim from the
// firm's letterhead — trade-standard consignment + Kimberley Process wording).
export const ATTACHMENT_ONE =
  'The goods described and valued as below are delivered to you for examination and ' +
  'inspection only and remain our property and shall be returned to us on demand and in ' +
  'any event, such merchandise, until returned to us and actually received by us, is at ' +
  'your risk from all hazards. No right or power is given to you to sell, pledge, ' +
  'hypothecate or otherwise dispose of this merchandise regardless of prior transactions. ' +
  'A sale of this merchandise can only be effected and title will pass only if, as and ' +
  'when we the said owners shall agree to such sale in writing and shall have billed you ' +
  'for the merchandise. All money received by you on the sale of the merchandise shall be ' +
  'held in trust for us until the full amount invoiced has been paid to us. The ' +
  'undersigned personally guarantee the below obligations on behalf of the company.'

export const ATTACHMENT_TWO =
  'The diamonds herein invoiced have been purchased from legitimate sources not involved ' +
  'in funding conflict and in compliance with United Nations resolutions. The seller ' +
  'hereby guarantees that these diamonds are conflict free, based on personal knowledge ' +
  'and/or written guarantees provided by the supplier of these diamonds.'

// ⚠️ Transcribed from a handwritten note — please double-check every digit
// (account number, routing number, zip) before this goes out on a real invoice.
const WIRE_ACCOUNT_NAME = 'AK Gems Inc'
const WIRE_BANK_NAME = 'JP Morgan Chase'
const WIRE_ACCOUNT_NUMBER = '2911976566'
const WIRE_ROUTING_NUMBER = '021202337'
const WIRE_ZELLE = 'angandhi2@gmail.com'

function money(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

function esc(value: string | number): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function upper(s: string): string { return s.toUpperCase() }

function formatUsDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return isoDate
  return parsed.toLocaleDateString('en-US')
}

function formatPhone(digits: string): string {
  const d = digits.replace(/\D/g, '')
  if (d.length !== 10) return digits
  return `(${d.slice(0, 3)})-${d.slice(3, 6)}-${d.slice(6)}`
}

const DOC_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  table { border-collapse: collapse; }
  img { display: block; max-width: 100%; }
`

export function buildInvoiceHtml(inv: SavedInvoice): string {
  const docTitle = inv.docKind === 'invoice' ? 'INVOICE' : 'MEMO'
  const docNumber = inv.invoiceNumber || inv.id
  const customer = upper(inv.company || inv.contactName || 'Customer')
  const cityStateZip = upper(
    [[inv.city, inv.state].filter(Boolean).join(', '), inv.contactZip].filter(Boolean).join(', ') || '—',
  )
  const partyLines = [
    esc(customer),
    inv.contactAddress ? esc(upper(inv.contactAddress)) : '',
    esc(cityStateZip),
    inv.contactPhone ? esc(inv.contactPhone) : '',
  ].filter(Boolean).map((line) => `<div>${line}</div>`).join('')

  const rows = inv.items.map((item, i) => {
    const label = itemDescriptionLabel(item) || '—'
    const remark = item.certGiven ? 'Certificate Given' : ''
    return `
    <tr>
      <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280;width:28px;">${i + 1}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;">${esc(upper(label))}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;width:92px;">${esc(item.certNo || '')}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;width:88px;">${esc(remark)}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;text-align:right;width:42px;">${esc(item.pcs)}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;text-align:right;width:52px;">${item.ct.toFixed(2)}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;text-align:right;width:64px;">${money(item.pct)}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #e5e7eb;text-align:right;width:78px;">${money(item.amount)}</td>
    </tr>`
  }).join('')
  const totalPcs = inv.items.reduce((sum, item) => sum + (Number(item.pcs) || 0), 0)
  const totalCt = inv.items.reduce((sum, item) => sum + (Number(item.ct) || 0), 0)
  const subtotal = inv.items.reduce((sum, item) => sum + item.amount, 0)
  const dueLabel = inv.docKind === 'invoice' ? dueDateLabel(inv) : ''

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${docTitle} ${esc(docNumber)}</title>
  <style>${DOC_CSS}</style>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;margin:0;padding:28px 32px 36px;color:#111827;text-transform:uppercase;font-size:11px;line-height:1.35;width:816px;background:#fff;">
  <table style="width:100%;margin-bottom:14px;">
    <tr>
      <td style="vertical-align:top;width:62%;">
        <div style="display:flex;align-items:flex-end;gap:10px;">
          <img src="${assetUrl(COMPANY_LOGO)}" alt="AK" style="height:46px;width:auto;" />
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:17px;font-weight:400;letter-spacing:1.2px;word-spacing:4px;line-height:1;padding-bottom:4px;">GEMS INC</span>
        </div>
        <div style="margin-top:8px;color:#374151;font-size:10px;line-height:1.45;">
          ${esc(upper(COMPANY_ADDRESS))}<br />
          TEL: ${formatPhone(COMPANY_PHONE)}<br />
          EMAIL: <span style="text-transform:lowercase;">${COMPANY_EMAIL}</span>
        </div>
      </td>
      <td style="vertical-align:top;text-align:right;width:38%;">
        <div style="font-size:26px;font-weight:800;letter-spacing:1.5px;color:#0f172a;line-height:1;">${docTitle}</div>
        <div style="margin-top:6px;color:#4b5563;font-size:11px;font-weight:600;">${docTitle} #: ${esc(docNumber)}</div>
      </td>
    </tr>
  </table>

  <table style="width:100%;margin-bottom:10px;font-size:10.5px;line-height:1.45;">
    <tr>
      <td style="width:50%;vertical-align:top;border:1px solid #d1d5db;padding:8px 10px;">
        <div style="font-weight:700;font-size:9px;margin-bottom:4px;color:#334155;letter-spacing:0.4px;">${docTitle} TO</div>
        ${partyLines}
      </td>
      <td style="width:50%;vertical-align:top;border:1px solid #d1d5db;border-left:none;padding:8px 10px;">
        <div style="font-weight:700;font-size:9px;margin-bottom:4px;color:#334155;letter-spacing:0.4px;">SHIP TO</div>
        ${partyLines}
      </td>
    </tr>
  </table>

  <table style="width:100%;margin-bottom:10px;font-size:10px;">
    <thead>
      <tr style="background:#0f172a;color:#fff;">
        <th style="text-align:left;padding:6px 10px;font-weight:700;letter-spacing:0.4px;">TERMS</th>
        <th style="text-align:left;padding:6px 10px;font-weight:700;letter-spacing:0.4px;">${docTitle} DATE</th>
        <th style="text-align:left;padding:6px 10px;font-weight:700;letter-spacing:0.4px;">DUE DATE</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding:6px 10px;border:1px solid #d1d5db;">${inv.docKind === 'invoice' ? esc(upper(termsLabel(inv.termsDays ?? 0))) : '—'}</td>
        <td style="padding:6px 10px;border:1px solid #d1d5db;">${esc(formatUsDate(inv.date))}</td>
        <td style="padding:6px 10px;border:1px solid #d1d5db;">${dueLabel ? esc(dueLabel) : '—'}</td>
      </tr>
    </tbody>
  </table>

  <div style="margin-bottom:10px;border:1px solid #d1d5db;padding:8px 10px;font-size:7.5px;line-height:1.45;color:#4b5563;text-transform:none;">
    ${esc(ATTACHMENT_ONE)}
  </div>

  <table style="width:100%;font-size:10px;table-layout:fixed;">
    <thead>
      <tr style="background:#f3f4f6;">
        <th style="text-align:right;padding:6px;border-bottom:1px solid #d1d5db;width:28px;font-weight:700;">#</th>
        <th style="text-align:left;padding:6px;border-bottom:1px solid #d1d5db;font-weight:700;">DESCRIPTION</th>
        <th style="text-align:left;padding:6px;border-bottom:1px solid #d1d5db;width:92px;font-weight:700;">CERTIFICATE NO.</th>
        <th style="text-align:left;padding:6px;border-bottom:1px solid #d1d5db;width:88px;font-weight:700;">REMARK</th>
        <th style="text-align:right;padding:6px;border-bottom:1px solid #d1d5db;width:42px;font-weight:700;">PCS</th>
        <th style="text-align:right;padding:6px;border-bottom:1px solid #d1d5db;width:52px;font-weight:700;">CT</th>
        <th style="text-align:right;padding:6px;border-bottom:1px solid #d1d5db;width:64px;font-weight:700;">P/CT</th>
        <th style="text-align:right;padding:6px;border-bottom:1px solid #d1d5db;width:78px;font-weight:700;">AMOUNT</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr style="border-top:2px solid #0f172a;font-weight:800;">
        <td colspan="4" style="padding:7px 6px;">TOTAL</td>
        <td style="padding:7px 6px;text-align:right;">${totalPcs}</td>
        <td style="padding:7px 6px;text-align:right;">${totalCt.toFixed(2)} CT</td>
        <td></td>
        <td style="padding:7px 6px;text-align:right;">${money(subtotal)}</td>
      </tr>
    </tfoot>
  </table>

  <div style="margin-top:12px;text-align:right;font-size:10px;color:#374151;">
    <div>SHIPPING: ${money(inv.shipping ?? 0)}</div>
    <div style="margin-top:4px;font-size:16px;font-weight:800;color:#0f172a;">TOTAL: ${money(inv.total)}</div>
  </div>

  <table style="width:100%;margin-top:14px;">
    <tr>
      <td style="width:62%;vertical-align:top;font-size:10px;color:#374151;line-height:1.55;">
        <div style="font-weight:800;margin-bottom:4px;color:#0f172a;letter-spacing:0.3px;">PAYMENT INSTRUCTION</div>
        <div>ACCOUNT NAME: <strong style="color:#111827;">${esc(upper(WIRE_ACCOUNT_NAME))}</strong></div>
        <div>BANK: <strong style="color:#111827;">${esc(upper(WIRE_BANK_NAME))}</strong></div>
        <div>ACCOUNT NUMBER: <strong style="color:#111827;">${esc(WIRE_ACCOUNT_NUMBER)}</strong></div>
        <div>ROUTING NUMBER: <strong style="color:#111827;">${esc(WIRE_ROUTING_NUMBER)}</strong></div>
        <div>ZELLE: <strong style="color:#111827;text-transform:lowercase;">${esc(WIRE_ZELLE)}</strong></div>
      </td>
      <td style="width:38%;vertical-align:top;text-align:right;">
        <img src="${assetUrl(ZELLE_QR)}" alt="Zelle QR" style="width:96px;height:96px;margin-left:auto;" />
        <div style="margin-top:4px;font-size:9px;color:#6b7280;text-transform:none;">Zelle QR</div>
      </td>
    </tr>
  </table>

  ${inv.notes ? `<div style="margin-top:12px;font-size:10px;color:#4b5563;white-space:pre-wrap;">${esc(upper(inv.notes))}</div>` : ''}

  <div style="margin-top:22px;text-transform:none;">
    <div style="font-size:11px;color:#111827;margin-bottom:10px;">Signature: <span style="display:inline-block;border-bottom:1px solid #111827;width:280px;height:14px;vertical-align:bottom;"></span></div>
    <div style="font-size:7.5px;line-height:1.45;color:#4b5563;">&ldquo;${esc(ATTACHMENT_TWO)}&rdquo;</div>
  </div>
</body>
</html>`
}

/**
 * A blank, pre-printed MEMO the client prints in a pad and fills in by hand
 * before handing goods to a customer. Same identity + disclosures as the
 * digital memo, but every field is an empty ruled line and the item grid is
 * a full page of numbered rows.
 */
export function buildBlankMemoHtml(rowCount = 22): string {
  const line = (w: string): string =>
    `<span style="display:inline-block;border-bottom:1px solid #9ca3af;width:${w};">&nbsp;</span>`
  const blankParty = `<div style="line-height:2.1;">
      ${line('92%')}<br />${line('92%')}<br />${line('92%')}
    </div>`
  const bodyRows = Array.from({ length: rowCount }, (_, i) => `
    <tr>
      <td style="padding:6px 8px;border:1px solid #d1d5db;text-align:right;color:#6b7280;width:26px;">${i + 1}</td>
      <td style="padding:6px 8px;border:1px solid #d1d5db;"></td>
      <td style="padding:6px 8px;border:1px solid #d1d5db;width:88px;"></td>
      <td style="padding:6px 8px;border:1px solid #d1d5db;width:72px;"></td>
      <td style="padding:6px 8px;border:1px solid #d1d5db;width:64px;"></td>
      <td style="padding:6px 8px;border:1px solid #d1d5db;width:64px;"></td>
      <td style="padding:6px 8px;border:1px solid #d1d5db;width:88px;"></td>
      <td style="padding:6px 8px;border:1px solid #d1d5db;width:104px;"></td>
    </tr>`).join('')

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>MEMO</title>
  <style>${DOC_CSS}</style>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;padding:28px 32px 36px;margin:0;color:#111827;text-transform:uppercase;font-size:11px;line-height:1.35;width:816px;background:#fff;">
  <table style="width:100%;margin-bottom:8px;">
    <tr>
      <td style="vertical-align:top;">
        <div style="display:flex;align-items:flex-end;gap:10px;">
          <img src="${assetUrl(COMPANY_LOGO)}" alt="AK" style="height:46px;width:auto;" />
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:17px;letter-spacing:1.2px;word-spacing:4px;padding-bottom:4px;">GEMS INC</span>
        </div>
        <div style="margin-top:6px;color:#374151;font-size:10px;line-height:1.4;">
          ${COMPANY_ADDRESS}<br />Tel: ${formatPhone(COMPANY_PHONE)}<br />
          Email: <span style="text-transform:lowercase;">${COMPANY_EMAIL}</span>
        </div>
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div style="font-size:21px;font-weight:800;letter-spacing:1px;">MEMO</div>
        <div style="margin-top:8px;color:#374151;font-size:10px;">Memo #: ${line('120px')}</div>
        <div style="margin-top:6px;color:#374151;font-size:10px;">Date: ${line('120px')}</div>
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
    <tr>
      <td style="width:50%;vertical-align:top;border:1px solid #d1d5db;padding:6px 9px;">
        <div style="font-weight:700;font-size:9px;color:#6b7280;margin-bottom:4px;">Memo To</div>${blankParty}
      </td>
      <td style="width:50%;vertical-align:top;border:1px solid #d1d5db;border-left:none;padding:6px 9px;">
        <div style="font-weight:700;font-size:9px;color:#6b7280;margin-bottom:4px;">Ship To</div>${blankParty}
      </td>
    </tr>
  </table>

  <div style="margin-bottom:8px;border:1px solid #d1d5db;padding:6px 9px;font-size:8px;line-height:1.4;color:#4b5563;text-transform:none;">
    ${esc(ATTACHMENT_ONE)}
  </div>

  <table style="width:100%;border-collapse:collapse;font-size:10px;">
    <thead>
      <tr style="background:#111827;color:#fff;">
        <th style="text-align:right;padding:5px 8px;border:1px solid #111827;">#</th>
        <th style="text-align:left;padding:5px 8px;border:1px solid #111827;">Description</th>
        <th style="text-align:left;padding:5px 8px;border:1px solid #111827;">Cert. No.</th>
        <th style="text-align:left;padding:5px 8px;border:1px solid #111827;">Remark</th>
        <th style="text-align:right;padding:5px 8px;border:1px solid #111827;">Pcs</th>
        <th style="text-align:right;padding:5px 8px;border:1px solid #111827;">Ct</th>
        <th style="text-align:right;padding:5px 8px;border:1px solid #111827;">P/Ct</th>
        <th style="text-align:right;padding:5px 8px;border:1px solid #111827;">Amount</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
    <tfoot>
      <tr style="font-weight:700;">
        <td colspan="4" style="padding:6px 8px;border:1px solid #111827;">Total</td>
        <td style="padding:6px 8px;border:1px solid #111827;"></td>
        <td style="padding:6px 8px;border:1px solid #111827;"></td>
        <td style="padding:6px 8px;border:1px solid #111827;"></td>
        <td style="padding:6px 8px;border:1px solid #111827;"></td>
      </tr>
    </tfoot>
  </table>

  <div style="margin-top:12px;text-transform:none;">
    <div style="font-size:11px;color:#111827;margin-bottom:8px;">Signature: ${line('260px')}</div>
    <div style="font-size:8px;line-height:1.4;color:#4b5563;">&ldquo;${esc(ATTACHMENT_TWO)}&rdquo;</div>
  </div>
</body>
</html>`
}

async function loadImageDataUrl(path: string): Promise<string | null> {
  try {
    const res = await fetch(assetUrl(path), { cache: 'force-cache' })
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function drawWrappedText(
  pdf: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const lines = pdf.splitTextToSize(text, maxWidth) as string[]
  pdf.text(lines, x, y)
  return y + lines.length * lineHeight
}

/**
 * Draw the invoice as a real vector PDF (no html2canvas).
 * Screenshotting HTML was clipping AMOUNT / QR / disclaimer — this matches
 * the AK Gems letterhead layout on a clean letter page with no browser chrome.
 */
async function buildInvoicePdf(inv: SavedInvoice): Promise<jsPDF> {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter', compress: true })
  const pageW = 8.5
  const marginX = 0.48
  const contentW = pageW - marginX * 2
  let y = 0.42

  const docTitle = inv.docKind === 'invoice' ? 'INVOICE' : 'MEMO'
  const docNumber = inv.invoiceNumber || inv.id
  const customer = upper(inv.company || inv.contactName || 'Customer')
  const street = inv.contactAddress ? upper(inv.contactAddress) : ''
  const cityStateZip = upper(
    [[inv.city, inv.state].filter(Boolean).join(', '), inv.contactZip].filter(Boolean).join(', '),
  )
  const phone = inv.contactPhone || ''
  const dueLabel = inv.docKind === 'invoice' ? dueDateLabel(inv) : ''
  const terms = inv.docKind === 'invoice' ? upper(termsLabel(inv.termsDays ?? 0)) : '—'

  const [logoData, qrData] = await Promise.all([
    loadImageDataUrl(COMPANY_LOGO),
    loadImageDataUrl(ZELLE_QR),
  ])

  // ── Header ──────────────────────────────────────────────────────────────
  if (logoData) {
    try { pdf.addImage(logoData, 'PNG', marginX, y, 0.55, 0.55) } catch { /* ignore */ }
  }
  pdf.setFont('times', 'normal')
  pdf.setFontSize(15)
  pdf.setTextColor(17, 24, 39)
  pdf.text('GEMS INC', marginX + 0.68, y + 0.38)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(22)
  pdf.text(docTitle, pageW - marginX, y + 0.28, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(75, 85, 99)
  pdf.text(`${docTitle} #: ${docNumber}`, pageW - marginX, y + 0.52, { align: 'right' })

  y += 0.68
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.setTextColor(55, 65, 81)
  pdf.text(upper(COMPANY_ADDRESS), marginX, y)
  y += 0.15
  pdf.text(`TEL: ${formatPhone(COMPANY_PHONE)}`, marginX, y)
  y += 0.15
  pdf.text(`EMAIL: ${COMPANY_EMAIL}`, marginX, y)

  // ── Invoice To / Ship To ────────────────────────────────────────────────
  y += 0.22
  const partyLines = [customer, street, cityStateZip, phone].filter(Boolean)
  const boxH = Math.max(0.88, 0.34 + partyLines.length * 0.15)
  const half = contentW / 2
  pdf.setDrawColor(209, 213, 219)
  pdf.setLineWidth(0.012)
  pdf.rect(marginX, y, half, boxH)
  pdf.rect(marginX + half, y, half, boxH)

  const partyY = y + 0.18
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(51, 65, 85)
  pdf.text(`${docTitle} TO`, marginX + 0.12, partyY)
  pdf.text('SHIP TO', marginX + half + 0.12, partyY)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(17, 24, 39)
  let py = partyY + 0.18
  for (const line of partyLines) {
    pdf.text(line, marginX + 0.12, py)
    pdf.text(line, marginX + half + 0.12, py)
    py += 0.15
  }
  y += boxH + 0.14

  // ── Terms bar ───────────────────────────────────────────────────────────
  const termsH = 0.28
  pdf.setFillColor(15, 23, 42)
  pdf.rect(marginX, y, contentW, termsH, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8.5)
  pdf.setTextColor(255, 255, 255)
  const colW = contentW / 3
  pdf.text('TERMS', marginX + 0.12, y + 0.18)
  pdf.text(`${docTitle} DATE`, marginX + colW + 0.12, y + 0.18)
  pdf.text('DUE DATE', marginX + colW * 2 + 0.12, y + 0.18)
  y += termsH

  const valH = 0.3
  pdf.setDrawColor(209, 213, 219)
  pdf.setLineWidth(0.012)
  pdf.rect(marginX, y, contentW, valH)
  pdf.line(marginX + colW, y, marginX + colW, y + valH)
  pdf.line(marginX + colW * 2, y, marginX + colW * 2, y + valH)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(17, 24, 39)
  pdf.text(terms, marginX + 0.12, y + 0.2)
  pdf.text(formatUsDate(inv.date), marginX + colW + 0.12, y + 0.2)
  pdf.text(dueLabel || '—', marginX + colW * 2 + 0.12, y + 0.2)
  y += valH + 0.12

  // ── Disclaimer 1 ────────────────────────────────────────────────────────
  pdf.setDrawColor(209, 213, 219)
  pdf.rect(marginX, y, contentW, 0.02, 'S')
  const discPad = 0.1
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(6.6)
  pdf.setTextColor(75, 85, 99)
  const discLines = pdf.splitTextToSize(ATTACHMENT_ONE, contentW - discPad * 2) as string[]
  const discH = discLines.length * 0.11 + discPad * 2
  pdf.rect(marginX, y, contentW, discH)
  pdf.text(discLines, marginX + discPad, y + discPad + 0.1)
  y += discH + 0.14

  // ── Items table ─────────────────────────────────────────────────────────
  const cols = [
    { key: '#', w: 0.28, align: 'right' as const },
    { key: 'DESCRIPTION', w: 1.85, align: 'left' as const },
    { key: 'CERTIFICATE NO.', w: 1.15, align: 'left' as const },
    { key: 'REMARK', w: 1.05, align: 'left' as const },
    { key: 'PCS', w: 0.45, align: 'right' as const },
    { key: 'CT', w: 0.55, align: 'right' as const },
    { key: 'P/CT', w: 0.7, align: 'right' as const },
    { key: 'AMOUNT', w: 0.85, align: 'right' as const },
  ]
  // Normalize widths to contentW
  const colSum = cols.reduce((s, c) => s + c.w, 0)
  const scale = contentW / colSum
  const widths = cols.map((c) => c.w * scale)

  const headerH = 0.28
  pdf.setFillColor(243, 244, 246)
  pdf.rect(marginX, y, contentW, headerH, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7.5)
  pdf.setTextColor(17, 24, 39)
  let cx = marginX
  cols.forEach((col, i) => {
    const w = widths[i]
    const tx = col.align === 'right' ? cx + w - 0.06 : cx + 0.06
    pdf.text(col.key, tx, y + 0.18, { align: col.align })
    cx += w
  })
  y += headerH
  pdf.setDrawColor(209, 213, 219)
  pdf.setLineWidth(0.01)
  pdf.line(marginX, y, marginX + contentW, y)

  const totalPcs = inv.items.reduce((sum, item) => sum + (Number(item.pcs) || 0), 0)
  const totalCt = inv.items.reduce((sum, item) => sum + (Number(item.ct) || 0), 0)
  const subtotal = inv.items.reduce((sum, item) => sum + item.amount, 0)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  for (let idx = 0; idx < inv.items.length; idx++) {
    const item = inv.items[idx]
    const rowH = 0.26
    const values = [
      String(idx + 1),
      upper(itemDescriptionLabel(item) || '—'),
      item.certNo || '',
      item.certGiven ? 'Certificate Given' : '',
      String(item.pcs ?? ''),
      Number(item.ct || 0).toFixed(2),
      money(item.pct),
      money(item.amount),
    ]
    cx = marginX
    values.forEach((val, i) => {
      const w = widths[i]
      const align = cols[i].align
      const tx = align === 'right' ? cx + w - 0.06 : cx + 0.06
      const clipped = pdf.splitTextToSize(val, w - 0.1)[0] || ''
      pdf.setTextColor(i === 0 ? 107 : 17, i === 0 ? 114 : 24, i === 0 ? 128 : 39)
      pdf.text(clipped, tx, y + 0.17, { align })
      cx += w
    })
    y += rowH
    pdf.setDrawColor(229, 231, 235)
    pdf.line(marginX, y, marginX + contentW, y)
  }

  // Totals row
  y += 0.02
  pdf.setDrawColor(15, 23, 42)
  pdf.setLineWidth(0.025)
  pdf.line(marginX, y, marginX + contentW, y)
  y += 0.08
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(17, 24, 39)
  const totalVals = ['', 'TOTAL', '', '', String(totalPcs), `${totalCt.toFixed(2)} CT`, '', money(subtotal)]
  cx = marginX
  totalVals.forEach((val, i) => {
    const w = widths[i]
    if (!val) { cx += w; return }
    const align = cols[i].align
    const tx = align === 'right' ? cx + w - 0.06 : cx + 0.06
    pdf.text(val, tx, y + 0.14, { align })
    cx += w
  })
  y += 0.32

  // Shipping + grand total
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(55, 65, 81)
  pdf.text(`SHIPPING: ${money(inv.shipping ?? 0)}`, pageW - marginX, y, { align: 'right' })
  y += 0.22
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13)
  pdf.setTextColor(15, 23, 42)
  pdf.text(`TOTAL: ${money(inv.total)}`, pageW - marginX, y, { align: 'right' })
  y += 0.28

  // ── Payment + QR ────────────────────────────────────────────────────────
  const payX = marginX
  const payY = y
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(15, 23, 42)
  pdf.text('PAYMENT INSTRUCTION', payX, payY)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.setTextColor(55, 65, 81)
  const payLines: Array<[string, string, boolean]> = [
    ['ACCOUNT NAME:', upper(WIRE_ACCOUNT_NAME), true],
    ['BANK:', upper(WIRE_BANK_NAME), true],
    ['ACCOUNT NUMBER:', WIRE_ACCOUNT_NUMBER, true],
    ['ROUTING NUMBER:', WIRE_ROUTING_NUMBER, true],
    ['ZELLE:', WIRE_ZELLE, true],
  ]
  let ly = payY + 0.2
  for (const [label, value, boldValue] of payLines) {
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(55, 65, 81)
    pdf.text(label, payX, ly)
    const labelW = pdf.getTextWidth(label) + 0.08
    pdf.setFont('helvetica', boldValue ? 'bold' : 'normal')
    pdf.setTextColor(17, 24, 39)
    pdf.text(value, payX + labelW, ly)
    ly += 0.17
  }

  if (qrData) {
    const qrSize = 1.05
    const qrX = pageW - marginX - qrSize
    try {
      pdf.addImage(qrData, 'PNG', qrX, payY, qrSize, qrSize)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7.5)
      pdf.setTextColor(107, 114, 128)
      pdf.text('Zelle QR', qrX + qrSize / 2, payY + qrSize + 0.14, { align: 'center' })
    } catch { /* ignore */ }
  }

  y = Math.max(ly, payY + 1.25) + 0.18

  if (inv.notes?.trim()) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor(75, 85, 99)
    y = drawWrappedText(pdf, upper(inv.notes.trim()), marginX, y, contentW, 0.14) + 0.12
  }

  // ── Signature + disclaimer 2 ────────────────────────────────────────────
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(17, 24, 39)
  pdf.text('Signature:', marginX, y)
  pdf.setDrawColor(17, 24, 39)
  pdf.setLineWidth(0.012)
  pdf.line(marginX + 0.85, y + 0.02, marginX + 3.6, y + 0.02)
  y += 0.28

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(6.6)
  pdf.setTextColor(75, 85, 99)
  drawWrappedText(pdf, `"${ATTACHMENT_TWO}"`, marginX, y, contentW, 0.11)

  return pdf
}

function waitForImages(doc: Document): Promise<void> {
  const images = [...doc.images]
  if (!images.length) return Promise.resolve()
  return Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve()
            return
          }
          img.onload = () => resolve()
          img.onerror = () => resolve()
        }),
    ),
  ).then(() => undefined)
}

/** Fallback HTML→canvas path used only for the blank memo pad. */
async function downloadPdfFromHtml(html: string, filename: string): Promise<void> {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:816px;height:2000px;border:0;opacity:0;'
  document.body.appendChild(frame)
  const fw = frame.contentWindow
  if (!fw) { frame.remove(); throw new Error('Could not open PDF frame') }
  try {
    fw.document.open(); fw.document.write(html); fw.document.close()
    await waitForImages(fw.document)
    await new Promise((r) => setTimeout(r, 100))
    const body = fw.document.body
    frame.style.height = `${body.scrollHeight + 40}px`
    const canvas = await html2canvas(body, {
      scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#ffffff',
      width: 816, height: body.scrollHeight, windowWidth: 816, windowHeight: body.scrollHeight, logging: false,
    })
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter', compress: true })
    const imgData = canvas.toDataURL('image/png')
    const imgHeight = (canvas.height * 8.5) / canvas.width
    pdf.addImage(imgData, 'PNG', 0, 0, 8.5, Math.min(imgHeight, 11))
    pdf.save(filename)
  } finally {
    frame.remove()
  }
}

function safeFilename(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'document'
}

export async function printBlankMemo(): Promise<void> {
  await downloadPdfFromHtml(buildBlankMemoHtml(), 'AK-Gems-Blank-Memo.pdf')
}

export async function printSavedInvoice(inv: SavedInvoice): Promise<void> {
  const kind = inv.docKind === 'memo' ? 'Memo' : 'Invoice'
  const number = safeFilename(inv.invoiceNumber || inv.id)
  const pdf = await buildInvoicePdf(inv)
  pdf.save(`AK-Gems-${kind}-${number}.pdf`)
}
