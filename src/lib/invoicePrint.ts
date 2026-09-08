import { SavedInvoice } from '../types/invoice'
import { dueDateLabel, termsLabel } from './invoiceTerms'

const COMPANY_LOGO = '/ak-monogram.png'
const COMPANY_ADDRESS = '61 Hackensack St, Flr 2, East Rutherford, NJ 07073'
const COMPANY_PHONE = '8622359224'
const COMPANY_EMAIL = 'info@akgemsinc.com'

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

  const rows = inv.items.map((item, i) => `
    <tr>
      <td style="padding:4px 8px;border-bottom:1px solid #ececec;text-align:right;color:#6b7280;">${i + 1}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ececec;">${esc(upper(item.size || '—'))}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ececec;text-align:right;">${esc(item.pcs)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ececec;text-align:right;">${item.ct.toFixed(2)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ececec;text-align:right;">${money(item.pct)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ececec;text-align:right;">${money(item.amount)}</td>
    </tr>`).join('')
  const totalPcs = inv.items.reduce((sum, item) => sum + (Number(item.pcs) || 0), 0)
  const totalCt = inv.items.reduce((sum, item) => sum + (Number(item.ct) || 0), 0)

  const subtotal = inv.items.reduce((sum, item) => sum + item.amount, 0)
  const dueLabel = inv.docKind === 'invoice' ? dueDateLabel(inv) : ''

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${docTitle}</title>
  <style>
    @page { margin: 0; }
    * { box-sizing: border-box; }
  </style>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:22px 26px;margin:0;color:#111827;text-transform:uppercase;font-size:11px;line-height:1.35;">
  <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
    <tr>
      <td style="vertical-align:top;text-align:left;">
        <img src="${COMPANY_LOGO}" alt="AK" style="display:inline-block;height:42px;width:auto;vertical-align:bottom;" />
        <span style="display:inline-block;font-family:Georgia,'Times New Roman',serif;font-size:16px;font-weight:400;letter-spacing:1px;word-spacing:3px;margin-left:8px;vertical-align:bottom;">GEMS INC</span>
        <div style="margin-top:6px;color:#374151;font-size:10px;line-height:1.4;">
          ${COMPANY_ADDRESS}<br />
          Tel: ${formatPhone(COMPANY_PHONE)}<br />
          Email: <span style="text-transform:lowercase;">${COMPANY_EMAIL}</span>
        </div>
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div style="font-size:21px;font-weight:800;letter-spacing:1px;">${docTitle}</div>
        <div style="margin-top:3px;color:#374151;font-size:10px;">${docTitle} #: ${esc(docNumber)}</div>
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10.5px;line-height:1.4;">
    <tr>
      <td style="width:50%;vertical-align:top;border:1px solid #d1d5db;padding:6px 9px;">
        <div style="font-weight:700;font-size:9px;margin-bottom:3px;color:#6b7280;">${docTitle} To</div>
        ${partyLines}
      </td>
      <td style="width:50%;vertical-align:top;border:1px solid #d1d5db;border-left:none;padding:6px 9px;">
        <div style="font-weight:700;font-size:9px;margin-bottom:3px;color:#6b7280;">Ship To</div>
        ${partyLines}
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:10px;">
    <thead>
      <tr style="background:#111827;color:#fff;">
        <th style="text-align:left;padding:4px 8px;border:1px solid #111827;">Terms</th>
        <th style="text-align:left;padding:4px 8px;border:1px solid #111827;">${docTitle} Date</th>
        <th style="text-align:left;padding:4px 8px;border:1px solid #111827;">Due Date</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding:4px 8px;border:1px solid #d1d5db;">${inv.docKind === 'invoice' ? esc(upper(termsLabel(inv.termsDays ?? 0))) : '—'}</td>
        <td style="padding:4px 8px;border:1px solid #d1d5db;">${esc(formatUsDate(inv.date))}</td>
        <td style="padding:4px 8px;border:1px solid #d1d5db;">${dueLabel ? esc(dueLabel) : '—'}</td>
      </tr>
    </tbody>
  </table>

  <div style="margin-bottom:8px;border:1px solid #d1d5db;padding:6px 9px;font-size:8px;line-height:1.4;color:#4b5563;text-transform:none;">
    ${esc(ATTACHMENT_ONE)}
  </div>

  <table style="width:100%;border-collapse:collapse;font-size:10px;">
    <thead>
      <tr style="background:#f3f4f6;">
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #d1d5db;width:26px;">#</th>
        <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #d1d5db;">Size</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #d1d5db;">Pcs</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #d1d5db;">Ct</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #d1d5db;">P/Ct</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:1px solid #d1d5db;">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr style="border-top:2px solid #111827;font-weight:700;">
        <td colspan="2" style="padding:5px 8px;">Total</td>
        <td style="padding:5px 8px;text-align:right;">${totalPcs}</td>
        <td style="padding:5px 8px;text-align:right;">${totalCt.toFixed(2)} ct</td>
        <td></td>
        <td style="padding:5px 8px;text-align:right;">${money(subtotal)}</td>
      </tr>
    </tfoot>
  </table>

  <table style="width:100%;border-collapse:collapse;margin-top:12px;">
    <tr>
      <td style="width:56%;vertical-align:top;font-size:10px;color:#374151;line-height:1.5;">
        <div style="font-weight:700;margin-bottom:3px;">Payment Instruction</div>
        <div>Account Name: ${esc(WIRE_ACCOUNT_NAME)}</div>
        <div>Bank: ${esc(WIRE_BANK_NAME)}</div>
        <div>Account Number: <strong style="color:#111827;">${esc(WIRE_ACCOUNT_NUMBER)}</strong></div>
        <div>Routing Number: <strong style="color:#111827;">${esc(WIRE_ROUTING_NUMBER)}</strong></div>
        <div>Zelle: <strong style="color:#111827;text-transform:lowercase;">${esc(WIRE_ZELLE)}</strong></div>
      </td>
      <td style="width:44%;vertical-align:top;text-align:right;font-size:10px;">
        <div style="color:#374151;">Total Pcs: ${totalPcs}</div>
        <div style="margin-top:2px;color:#374151;">Total Ct: ${totalCt.toFixed(2)}</div>
        <div style="margin-top:5px;color:#374151;">Subtotal: ${money(subtotal)}</div>
        <div style="margin-top:2px;color:#374151;">Shipping: ${money(inv.shipping ?? 0)}</div>
        <div style="margin-top:5px;font-size:15px;font-weight:700;">Total: ${money(inv.total)}</div>
      </td>
    </tr>
  </table>

  ${inv.notes ? `<div style="margin-top:10px;font-size:10px;color:#4b5563;white-space:pre-wrap;">${esc(upper(inv.notes))}</div>` : ''}

  <div style="margin-top:14px;border-top:1px solid #d1d5db;padding-top:10px;text-transform:none;">
    <div style="font-size:11px;color:#111827;margin-bottom:8px;">Signature: <span style="display:inline-block;border-bottom:1px solid #111827;width:260px;">&nbsp;</span></div>
    <div style="font-size:8px;line-height:1.4;color:#4b5563;">&ldquo;${esc(ATTACHMENT_TWO)}&rdquo;</div>
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
  <style>@page { margin: 0; } * { box-sizing: border-box; }</style>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px 24px;margin:0;color:#111827;text-transform:uppercase;font-size:11px;line-height:1.35;">
  <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
    <tr>
      <td style="vertical-align:top;">
        <img src="${COMPANY_LOGO}" alt="AK" style="display:inline-block;height:42px;vertical-align:bottom;" />
        <span style="display:inline-block;font-family:Georgia,'Times New Roman',serif;font-size:16px;letter-spacing:1px;word-spacing:3px;margin-left:8px;vertical-align:bottom;">GEMS INC</span>
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
        <th style="text-align:left;padding:5px 8px;border:1px solid #111827;">Size</th>
        <th style="text-align:right;padding:5px 8px;border:1px solid #111827;">Pcs</th>
        <th style="text-align:right;padding:5px 8px;border:1px solid #111827;">Ct</th>
        <th style="text-align:right;padding:5px 8px;border:1px solid #111827;">P/Ct</th>
        <th style="text-align:right;padding:5px 8px;border:1px solid #111827;">Amount</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
    <tfoot>
      <tr style="font-weight:700;">
        <td colspan="2" style="padding:6px 8px;border:1px solid #111827;">Total</td>
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

function printHtmlDoc(html: string): void {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  frame.setAttribute('aria-hidden', 'true')
  document.body.appendChild(frame)
  const cleanup = () => setTimeout(() => frame.parentNode?.removeChild(frame), 250)
  const fw = frame.contentWindow
  if (!fw) { cleanup(); return }
  fw.document.open(); fw.document.write(html); fw.document.close()
  const onAfterPrint = () => { cleanup(); fw.removeEventListener('afterprint', onAfterPrint) }
  fw.addEventListener('afterprint', onAfterPrint)
  setTimeout(() => { try { fw.focus(); fw.print() } catch { cleanup() } }, 200)
}

export function printBlankMemo(): void {
  printHtmlDoc(buildBlankMemoHtml())
}

export function printSavedInvoice(inv: SavedInvoice): void {
  const html = buildInvoiceHtml(inv)
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  frame.setAttribute('aria-hidden', 'true')
  document.body.appendChild(frame)
  const cleanup = () => setTimeout(() => frame.parentNode?.removeChild(frame), 250)
  const fw = frame.contentWindow
  if (!fw) { cleanup(); return }
  fw.document.open(); fw.document.write(html); fw.document.close()
  const onAfterPrint = () => { cleanup(); fw.removeEventListener('afterprint', onAfterPrint) }
  fw.addEventListener('afterprint', onAfterPrint)
  setTimeout(() => { try { fw.focus(); fw.print() } catch { cleanup() } }, 200)
}
