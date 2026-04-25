import { useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'

type DocKind = 'invoice' | 'memo'
type PaidBy = 'cash' | 'check'

type InvoiceItem = {
  id: string
  size: string
  pcs: string
  ct: string
  pct: string
  amount: string
}

const COMPANY_ADDRESS = '30 West 47th Street #MEZZ 26 New York-10036.'
const COMPANY_PHONE = '+1(212)380-3190'
const COMPANY_EMAIL = 'info@deltadiamondsinc.com'
const COMPANY_LOGO = '/delta-logo.png'

function money(value: number): string {
  return `$${value.toFixed(2)}`
}

function num(value: string): number {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function rowTotal(item: InvoiceItem): number {
  if (item.amount.trim()) return num(item.amount)
  return num(item.ct) * num(item.pct)
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function upper(value: string): string {
  return value.toUpperCase()
}

export function InvoiceModal() {
  const invoiceContactId = useStore((s) => s.invoiceContactId)
  const setInvoiceContactId = useStore((s) => s.setInvoiceContactId)
  const contacts = useStore((s) => s.contacts)
  const showToast = useStore((s) => s.showToast)

  const contact = contacts.find((c) => c.id === invoiceContactId) || null
  const [docKind, setDocKind] = useState<DocKind>('invoice')
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [paidBy, setPaidBy] = useState<PaidBy>('cash')
  const [notes, setNotes] = useState('')
  const [isPreview, setIsPreview] = useState(false)
  const [items, setItems] = useState<InvoiceItem[]>([
    { id: uid(), size: '', pcs: '1', ct: '', pct: '', amount: '' },
  ])

  const subtotal = useMemo(() => items.reduce((sum, item) => sum + rowTotal(item), 0), [items])

  if (!contact) return null

  const close = () => {
    setIsPreview(false)
    setInvoiceContactId(null)
  }

  const updateItem = (id: string, patch: Partial<InvoiceItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const removeItem = (id: string) => {
    setItems((current) => (current.length === 1 ? current : current.filter((item) => item.id !== id)))
  }

  const addItem = () => {
    setItems((current) => [...current, { id: uid(), size: '', pcs: '1', ct: '', pct: '', amount: '' }])
  }

  const customer = contact.company || contact.name || 'Customer'
  const customerAddress = [contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(', ')

  const printInvoice = () => {
    const invoiceRows = items
      .map((item) => {
        const lineTotal = rowTotal(item)
        return `<tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(upper(item.size || '-'))}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escapeHtml(item.pcs || '0')}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${num(item.ct).toFixed(2)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(num(item.pct))}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(lineTotal)}</td>
        </tr>`
      })
      .join('')

    const docTitle = docKind === 'invoice' ? 'INVOICE' : 'MEMO'
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${docTitle}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 28px; color: #111827; text-transform: uppercase;">
  <div style="text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Delta Diamonds" style="max-width:460px;width:100%;height:auto;" />
  </div>
  <div style="text-align:center;color:#374151;margin:8px 0 18px;">
    <div>${COMPANY_ADDRESS}</div>
    <div>Tel: ${COMPANY_PHONE} &nbsp; | &nbsp; ${COMPANY_EMAIL}</div>
  </div>
  <h1 style="margin: 0 0 8px;">${docTitle}</h1>
  <div style="margin-bottom: 6px; color: #374151;">Date: ${upper(invoiceDate)}</div>
  <div style="margin-bottom: 14px; color: #374151;">Paid by: ${paidBy.toUpperCase()}</div>
  <div style="margin-bottom: 18px;">
    <div style="font-weight: 700;">Bill To</div>
    <div>${escapeHtml(upper(customer))}</div>
    <div>${escapeHtml(upper(customerAddress || '-'))}</div>
    <div>${escapeHtml(contact.phone_mobile || contact.phone_work || '')}</div>
  </div>
  <table style="width:100%; border-collapse: collapse; margin-top: 10px;">
    <thead>
      <tr style="background:#f9fafb;">
        <th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;">Size</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb;">Pcs</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb;">Ct</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb;">P/Ct</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb;">Amount</th>
      </tr>
    </thead>
    <tbody>${invoiceRows}</tbody>
  </table>
  <div style="margin-top: 14px; text-align: right; font-size: 18px; font-weight: 700;">
    Total: ${money(subtotal)}
  </div>
  <div style="margin-top: 22px; color: #4b5563; white-space: pre-wrap;">${escapeHtml(upper(notes || ''))}</div>
</body>
</html>`

    const frame = document.createElement('iframe')
    frame.style.position = 'fixed'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.width = '0'
    frame.style.height = '0'
    frame.style.border = '0'
    frame.setAttribute('aria-hidden', 'true')
    document.body.appendChild(frame)

    const cleanup = () => {
      window.setTimeout(() => {
        if (frame.parentNode) frame.parentNode.removeChild(frame)
      }, 250)
    }

    const frameWindow = frame.contentWindow
    if (!frameWindow) {
      cleanup()
      showToast('Could not open print view. Please try again.')
      return
    }

    frameWindow.document.open()
    frameWindow.document.write(html)
    frameWindow.document.close()

    // Keep users inside the app after opening print/save PDF.
    close()

    const onAfterPrint = () => {
      cleanup()
      frameWindow.removeEventListener('afterprint', onAfterPrint)
    }
    frameWindow.addEventListener('afterprint', onAfterPrint)

    window.setTimeout(() => {
      try {
        frameWindow.focus()
        frameWindow.print()
      } catch {
        cleanup()
        showToast('Print failed. Please try again.')
      }
    }, 200)
  }

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--modal-bg)',
        zIndex: 320,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg2)',
          borderRadius: '22px 22px 0 0',
          width: '100%',
          maxWidth: 480,
          maxHeight: '92dvh',
          overflowY: 'auto',
          padding: '16px 16px 24px',
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 4, background: 'var(--bg4)', margin: '0 auto 14px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>{isPreview ? 'Invoice Preview' : 'Create Invoice'}</div>
          <button onClick={close} style={{ border: 'none', background: 'none', fontSize: 22, color: 'var(--text3)' }}>✕</button>
        </div>
        {!isPreview ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>Customer</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{customer}</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{customerAddress || 'No address'}</div>

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={labelStyle}>Type</div>
                <select value={docKind} onChange={(e) => setDocKind(e.target.value as DocKind)} style={inputStyle}>
                  <option value="invoice">Invoice</option>
                  <option value="memo">Memo</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <div style={labelStyle}>Date</div>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={labelStyle}>Paid By</div>
              <select value={paidBy} onChange={(e) => setPaidBy(e.target.value as PaidBy)} style={inputStyle}>
                <option value="cash">Cash</option>
                <option value="check">Check</option>
              </select>
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', margin: '14px 0 8px' }}>Lines</div>
            {items.map((item) => (
              <div key={item.id} style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={item.size}
                    onChange={(e) => updateItem(item.id, { size: e.target.value })}
                    placeholder="Size (e.g. 1.25VS)"
                    style={{ ...inputStyle, flex: 2 }}
                  />
                  <input
                    value={item.pcs}
                    onChange={(e) => updateItem(item.id, { pcs: e.target.value.replace(/[^\d]/g, '') })}
                    placeholder="Pcs"
                    inputMode="numeric"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input
                    value={item.ct}
                    onChange={(e) => updateItem(item.id, { ct: e.target.value })}
                    placeholder="Ct"
                    inputMode="decimal"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <input
                    value={item.pct}
                    onChange={(e) => updateItem(item.id, { pct: e.target.value })}
                    placeholder="P/Ct"
                    inputMode="decimal"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <input
                    value={item.amount}
                    onChange={(e) => updateItem(item.id, { amount: e.target.value })}
                    placeholder="Amount"
                    inputMode="decimal"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button onClick={() => removeItem(item.id)} style={removeBtnStyle}>✕</button>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                  Line total: {money(rowTotal(item))}
                </div>
              </div>
            ))}

            <button onClick={addItem} style={ghostBtnStyle}>+ Add line</button>

            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', margin: '14px 0 8px' }}>Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Payment terms or notes"
              style={{ ...inputStyle, resize: 'vertical' }}
            />

            <div style={{ marginTop: 12, fontSize: 18, fontWeight: 800, textAlign: 'right' }}>
              Total: {money(subtotal)}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={close} style={ghostBtnStyle}>Cancel</button>
              <button onClick={() => setIsPreview(true)} style={primaryBtnStyle}>Preview</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ border: '1px solid var(--border2)', borderRadius: 12, padding: 12, background: '#fff', color: '#111827', textTransform: 'uppercase' }}>
              <div style={{ textAlign: 'center' }}>
                <img src={COMPANY_LOGO} alt="Delta Diamonds" style={{ width: '100%', maxWidth: 400, height: 'auto' }} />
              </div>
              <div style={{ textAlign: 'center', fontSize: 12, color: '#374151', marginTop: 6 }}>
                <div>{COMPANY_ADDRESS}</div>
                <div>Tel: {COMPANY_PHONE} | {COMPANY_EMAIL}</div>
              </div>
              <div style={{ marginTop: 12, fontWeight: 800, fontSize: 16 }}>{docKind === 'invoice' ? 'INVOICE' : 'MEMO'}</div>
              <div style={{ fontSize: 12, color: '#374151' }}>Date: {upper(invoiceDate)}</div>
              <div style={{ fontSize: 12, color: '#374151' }}>Paid by: {paidBy.toUpperCase()}</div>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <div style={{ fontWeight: 700 }}>Bill To</div>
                <div>{upper(customer)}</div>
                <div>{upper(customerAddress || '-')}</div>
              </div>
              <table style={{ width: '100%', marginTop: 10, borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Size</th>
                    <th style={thStyleRight}>Pcs</th>
                    <th style={thStyleRight}>Ct</th>
                    <th style={thStyleRight}>P/Ct</th>
                    <th style={thStyleRight}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td style={tdStyle}>{upper(item.size || '-')}</td>
                      <td style={tdStyleRight}>{item.pcs || '0'}</td>
                      <td style={tdStyleRight}>{num(item.ct).toFixed(2)}</td>
                      <td style={tdStyleRight}>{money(num(item.pct))}</td>
                      <td style={tdStyleRight}>{money(rowTotal(item))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 10, textAlign: 'right', fontWeight: 800 }}>Total: {money(subtotal)}</div>
              {notes && <div style={{ marginTop: 10, fontSize: 12, whiteSpace: 'pre-wrap' }}>{upper(notes)}</div>}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => setIsPreview(false)} style={ghostBtnStyle}>Back</button>
              <button onClick={printInvoice} style={primaryBtnStyle}>Download PDF / Print</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  fontWeight: 700,
  textTransform: 'uppercase',
  marginBottom: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1.5px solid var(--border)',
  background: 'var(--bg3)',
  color: 'var(--text)',
  fontSize: 14,
}

const primaryBtnStyle: React.CSSProperties = {
  flex: 1,
  borderRadius: 10,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 800,
  fontSize: 14,
  padding: '11px 12px',
  cursor: 'pointer',
}

const ghostBtnStyle: React.CSSProperties = {
  flex: 1,
  borderRadius: 10,
  border: '1.5px solid var(--border)',
  background: 'var(--bg3)',
  color: 'var(--text2)',
  fontWeight: 700,
  fontSize: 14,
  padding: '11px 12px',
  cursor: 'pointer',
}

const removeBtnStyle: React.CSSProperties = {
  width: 36,
  borderRadius: 10,
  border: '1.5px solid var(--border)',
  background: 'var(--bg3)',
  color: 'var(--text3)',
  fontWeight: 700,
  cursor: 'pointer',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 4px',
  borderBottom: '1px solid #e5e7eb',
}

const thStyleRight: React.CSSProperties = {
  textAlign: 'right',
  padding: '6px 4px',
  borderBottom: '1px solid #e5e7eb',
}

const tdStyle: React.CSSProperties = {
  padding: '6px 4px',
  borderBottom: '1px solid #f3f4f6',
}

const tdStyleRight: React.CSSProperties = {
  textAlign: 'right',
  padding: '6px 4px',
  borderBottom: '1px solid #f3f4f6',
}
