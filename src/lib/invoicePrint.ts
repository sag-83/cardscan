import { SavedInvoice } from '../types/invoice'
import { dueDateLabel, termsLabel } from './invoiceTerms'

const COMPANY_LOGO = '/ak-monogram.png'
const COMPANY_ADDRESS = '61 Hackensack St, Flr 2, East Rutherford, NJ - 07073'
const COMPANY_PHONE = '8622359224'

// ⚠️ Transcribed from a handwritten note — please double-check every digit
// (account number, zip) before this goes out on a real invoice.
const WIRE_ACCOUNT_NAME = 'AK Gems Inc'
const WIRE_BANK_NAME = 'JP Morgan Chase'
const WIRE_BANK_ADDRESS = '90 Hackensack St, East Rutherford, NJ 07073, US'
const WIRE_ACCOUNT_NUMBER = '2911976566'
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
  const customer = upper(inv.company || inv.contactName || 'Customer')
  const location = upper([inv.city, inv.state].filter(Boolean).join(', ') || '—')

  const rows = inv.items.map((item) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${esc(upper(item.size || '—'))}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${esc(item.pcs)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${item.ct.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(item.pct)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(item.amount)}</td>
    </tr>`).join('')

  const subtotal = inv.items.reduce((sum, item) => sum + item.amount, 0)
  const dueLabel = inv.docKind === 'invoice' ? dueDateLabel(inv) : ''

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${docTitle}</title>
  <style>@page { margin: 0; }</style>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:48px 40px;color:#111827;text-transform:uppercase;">
  <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
    <tr>
      <td style="vertical-align:top;text-align:left;">
        <img src="${COMPANY_LOGO}" alt="AK" style="display:inline-block;height:60px;width:auto;vertical-align:bottom;" />
        <span style="display:inline-block;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:400;letter-spacing:6px;margin-left:10px;vertical-align:bottom;">GEMS INC</span>
        <div style="margin-top:12px;color:#374151;font-size:12px;line-height:1.6;">
          ${COMPANY_ADDRESS}<br />
          Tel: ${formatPhone(COMPANY_PHONE)}
        </div>
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div style="font-size:26px;font-weight:800;">${docTitle}</div>
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
    <tr>
      <td style="width:50%;vertical-align:top;border:1px solid #d1d5db;padding:10px 12px;">
        <div style="font-weight:700;font-size:11px;margin-bottom:5px;">${docTitle} To</div>
        <div>${esc(customer)}</div>
        <div>${esc(location)}</div>
      </td>
      <td style="width:50%;vertical-align:top;border:1px solid #d1d5db;border-left:none;padding:10px 12px;">
        <div style="font-weight:700;font-size:11px;margin-bottom:5px;">Ship To</div>
        <div>${esc(customer)}</div>
        <div>${esc(location)}</div>
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;margin-bottom:22px;font-size:11px;">
    <thead>
      <tr style="background:#111827;color:#fff;">
        <th style="text-align:left;padding:7px 10px;border:1px solid #111827;">Terms</th>
        <th style="text-align:left;padding:7px 10px;border:1px solid #111827;">${docTitle} Date</th>
        <th style="text-align:left;padding:7px 10px;border:1px solid #111827;">Due Date</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding:7px 10px;border:1px solid #d1d5db;">${inv.docKind === 'invoice' ? esc(upper(termsLabel(inv.termsDays ?? 0))) : '—'}</td>
        <td style="padding:7px 10px;border:1px solid #d1d5db;">${esc(formatUsDate(inv.date))}</td>
        <td style="padding:7px 10px;border:1px solid #d1d5db;">${dueLabel ? esc(dueLabel) : '—'}</td>
      </tr>
    </tbody>
  </table>

  <table style="width:100%;border-collapse:collapse;">
    <thead>
      <tr style="background:#f9fafb;">
        <th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;">Size</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb;">Pcs</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb;">Ct</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb;">P/Ct</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb;">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <table style="width:100%;border-collapse:collapse;margin-top:28px;">
    <tr>
      <td style="width:56%;vertical-align:top;font-size:11px;color:#374151;line-height:1.7;">
        <div style="font-weight:700;margin-bottom:5px;">Wire Transfer Details</div>
        <div>Account Name: ${esc(WIRE_ACCOUNT_NAME)}</div>
        <div>Bank: ${esc(WIRE_BANK_NAME)}</div>
        <div>Bank Address: ${esc(WIRE_BANK_ADDRESS)}</div>
        <div>Account Number: ${esc(WIRE_ACCOUNT_NUMBER)}</div>
        <div>Zelle: <span style="text-transform:lowercase;">${esc(WIRE_ZELLE)}</span></div>
      </td>
      <td style="width:44%;vertical-align:top;text-align:right;">
        <div style="color:#374151;">Subtotal: ${money(subtotal)}</div>
        <div style="margin-top:4px;color:#374151;">Shipping: ${money(inv.shipping ?? 0)}</div>
        <div style="margin-top:8px;font-size:18px;font-weight:700;">Total: ${money(inv.total)}</div>
      </td>
    </tr>
  </table>

  ${inv.notes ? `<div style="margin-top:22px;color:#4b5563;white-space:pre-wrap;">${esc(upper(inv.notes))}</div>` : ''}
</body>
</html>`
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
