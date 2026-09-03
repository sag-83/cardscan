import { SavedInvoice } from '../types/invoice'
import { dueDateLabel, termsLabel } from './invoiceTerms'

const COMPANY_LOGO = '/ak-monogram.png'
const COMPANY_ADDRESS = '61 Hackensack St, Flr 2, East Rutherford, NJ - 07073'
const COMPANY_PHONE = '8622359224'

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

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${docTitle}</title>
  <style>@page { margin: 0; }</style>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:48px 40px;color:#111827;text-transform:uppercase;">
  <div style="text-align:left;">
    <img src="${COMPANY_LOGO}" alt="AK" style="display:inline-block;height:60px;width:auto;vertical-align:bottom;" />
    <span style="display:inline-block;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:400;letter-spacing:6px;margin-left:10px;vertical-align:bottom;">GEMS INC</span>
  </div>
  <div style="text-align:left;color:#374151;margin:22px 0 26px;">
    <div>${COMPANY_ADDRESS} &nbsp;|&nbsp; Tel: ${formatPhone(COMPANY_PHONE)}</div>
  </div>
  <h1 style="margin:0 0 8px;">${docTitle}</h1>
  <div style="margin-bottom:6px;color:#374151;">Date: ${formatUsDate(inv.date)}</div>
  ${inv.docKind === 'invoice' ? `<div style="margin-bottom:6px;color:#374151;">Terms: ${esc(upper(termsLabel(inv.termsDays ?? 0)))}</div>` : ''}
  ${inv.docKind === 'invoice' && dueDateLabel(inv) ? `<div style="margin-bottom:14px;color:#374151;">Payment due: ${esc(dueDateLabel(inv))}</div>` : ''}
  <div style="margin-bottom:18px;">
    <div style="font-weight:700;">Bill To</div>
    <div>${esc(customer)}</div>
    <div>${esc(location)}</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-top:10px;">
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
  <div style="margin-top:14px;text-align:right;font-size:18px;font-weight:700;">
    Total: ${money(inv.total)}
  </div>
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
