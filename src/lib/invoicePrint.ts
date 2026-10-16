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

/**
 * Build a real PDF file (not browser Print), so Safari/Chrome never stamp
 * the site URL, date/time, or "Page 1 of 1" onto the invoice.
 */
async function downloadPdfFromHtml(html: string, filename: string): Promise<void> {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('title', 'Invoice PDF')
  frame.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    'width:816px',
    'height:2000px',
    'border:0',
    'opacity:0',
    'pointer-events:none',
  ].join(';')
  document.body.appendChild(frame)

  const fw = frame.contentWindow
  if (!fw) {
    frame.remove()
    throw new Error('Could not open PDF frame')
  }

  try {
    fw.document.open()
    fw.document.write(html)
    fw.document.close()
    await waitForImages(fw.document)
    await new Promise((resolve) => setTimeout(resolve, 120))

    const body = fw.document.body
    const captureWidth = Math.max(816, body.scrollWidth)
    const captureHeight = Math.max(body.scrollHeight, body.offsetHeight)
    // Grow the frame so html2canvas does not clip the right edge or footer.
    frame.style.height = `${captureHeight + 40}px`

    const canvas = await html2canvas(body, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      width: captureWidth,
      height: captureHeight,
      windowWidth: captureWidth,
      windowHeight: captureHeight,
      scrollX: 0,
      scrollY: 0,
      logging: false,
    })

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter', compress: true })
    const pageWidth = 8.5
    const pageHeight = 11
    const imgData = canvas.toDataURL('image/png')
    let imgWidth = pageWidth
    let imgHeight = (canvas.height * pageWidth) / canvas.width

    // Prefer a single clean letter page when the invoice is only slightly tall.
    if (imgHeight > pageHeight && imgHeight <= pageHeight * 1.12) {
      const fit = pageHeight / imgHeight
      imgWidth *= fit
      imgHeight = pageHeight
      const x = (pageWidth - imgWidth) / 2
      pdf.addImage(imgData, 'PNG', x, 0, imgWidth, imgHeight)
      pdf.save(filename)
      return
    }

    let heightLeft = imgHeight
    let position = 0
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight

    while (heightLeft > 0.02) {
      position -= pageHeight
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }

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
  await downloadPdfFromHtml(buildInvoiceHtml(inv), `AK-Gems-${kind}-${number}.pdf`)
}
