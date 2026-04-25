import { useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'

type InvoiceItem = {
  id: string
  description: string
  qty: string
  price: string
}

function money(value: number): string {
  return `$${value.toFixed(2)}`
}

function num(value: string): number {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function rowTotal(item: InvoiceItem): number {
  return num(item.qty) * num(item.price)
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

export function InvoiceModal() {
  const invoiceContactId = useStore((s) => s.invoiceContactId)
  const setInvoiceContactId = useStore((s) => s.setInvoiceContactId)
  const contacts = useStore((s) => s.contacts)
  const showToast = useStore((s) => s.showToast)

  const contact = contacts.find((c) => c.id === invoiceContactId) || null
  const [invoiceNo, setInvoiceNo] = useState(() => `${Date.now().toString().slice(-6)}`)
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<InvoiceItem[]>([
    { id: uid(), description: 'Product / Service', qty: '1', price: '' },
  ])

  const subtotal = useMemo(() => items.reduce((sum, item) => sum + rowTotal(item), 0), [items])

  if (!contact) return null

  const close = () => setInvoiceContactId(null)

  const updateItem = (id: string, patch: Partial<InvoiceItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const removeItem = (id: string) => {
    setItems((current) => (current.length === 1 ? current : current.filter((item) => item.id !== id)))
  }

  const addItem = () => {
    setItems((current) => [...current, { id: uid(), description: '', qty: '1', price: '' }])
  }

  const customer = contact.company || contact.name || 'Customer'
  const address = [contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(', ')

  const printInvoice = () => {
    const invoiceRows = items
      .map((item) => {
        const lineTotal = rowTotal(item)
        return `<tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.description || '-'}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${num(item.qty)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(num(item.price))}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(lineTotal)}</td>
        </tr>`
      })
      .join('')

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice ${invoiceNo}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 28px; color: #111827;">
  <h1 style="margin: 0 0 8px;">Invoice #${invoiceNo}</h1>
  <div style="margin-bottom: 18px; color: #374151;">Date: ${invoiceDate}</div>
  <div style="margin-bottom: 18px;">
    <div style="font-weight: 700;">Bill To</div>
    <div>${customer}</div>
    <div>${address || '-'}</div>
    <div>${contact.phone_mobile || contact.phone_work || ''}</div>
  </div>
  <table style="width:100%; border-collapse: collapse; margin-top: 10px;">
    <thead>
      <tr style="background:#f9fafb;">
        <th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;">Item</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb;">Qty</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb;">Price</th>
        <th style="text-align:right;padding:8px;border-bottom:1px solid #e5e7eb;">Amount</th>
      </tr>
    </thead>
    <tbody>${invoiceRows}</tbody>
  </table>
  <div style="margin-top: 14px; text-align: right; font-size: 18px; font-weight: 700;">
    Total: ${money(subtotal)}
  </div>
  <div style="margin-top: 22px; color: #4b5563; white-space: pre-wrap;">${notes || ''}</div>
</body>
</html>`

    const popup = window.open('', '_blank')
    if (!popup) {
      showToast('Popup blocked. Please allow popups to print invoice.')
      return
    }
    popup.document.open()
    popup.document.write(html)
    popup.document.close()
    popup.focus()
    popup.print()
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
          <div style={{ fontSize: 19, fontWeight: 800 }}>Create Invoice</div>
          <button onClick={close} style={{ border: 'none', background: 'none', fontSize: 22, color: 'var(--text3)' }}>✕</button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>Customer</div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{customer}</div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{address || 'No address'}</div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Invoice #</div>
            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>Date</div>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', margin: '14px 0 8px' }}>Items</div>
        {items.map((item) => (
          <div key={item.id} style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <input
              value={item.description}
              onChange={(e) => updateItem(item.id, { description: e.target.value })}
              placeholder="Description"
              style={inputStyle}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                value={item.qty}
                onChange={(e) => updateItem(item.id, { qty: e.target.value })}
                placeholder="Qty"
                inputMode="decimal"
                style={{ ...inputStyle, flex: 1 }}
              />
              <input
                value={item.price}
                onChange={(e) => updateItem(item.id, { price: e.target.value })}
                placeholder="Price"
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

        <button onClick={addItem} style={ghostBtnStyle}>+ Add item</button>

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
          <button onClick={printInvoice} style={primaryBtnStyle}>Print / Save PDF</button>
        </div>
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
