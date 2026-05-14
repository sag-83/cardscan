import { SavedInvoice } from '../types/invoice'

const COMPANY_ADDRESS = '30 West 47th Street #MEZZ 26 New York-10036.'
const COMPANY_PHONE = '+1(212)380-3190'
const COMPANY_EMAIL = 'info@deltadiamondsinc.com'
const COMPANY_LOGO = '/delta-logo.png'

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
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:28px;color:#111827;text-transform:uppercase;">
  <div style="text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Delta Diamonds" style="max-width:460px;width:100%;height:auto;" />
  </div>
  <div style="text-align:center;color:#374151;margin:8px 0 18px;">
    <div>${COMPANY_ADDRESS}</div>
    <div>Tel: ${COMPANY_PHONE} &nbsp;|&nbsp; ${COMPANY_EMAIL}</div>
  </div>
  <h1 style="margin:0 0 8px;">${docTitle}</h1>
  <div style="margin-bottom:6px;color:#374151;">Date: ${formatUsDate(inv.date)}</div>
  ${inv.docKind === 'invoice' ? `<div style="margin-bottom:14px;color:#374151;">Paid by: ${upper(inv.paidBy)}</div>` : ''}
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
