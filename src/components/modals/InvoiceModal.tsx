import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { sendInvoiceToSheets } from '../../lib/export'
import { saveInvoiceSynced } from '../../lib/invoiceSync'
import { money } from '../../lib/invoiceFormUtils'
import { dueDateLabel, termsLabel } from '../../lib/invoiceTerms'
import { syncFollowupReminders } from '../../lib/reminderNotifications'
import { SavedInvoice } from '../../types/invoice'
import { CreateInvoiceForm } from '../invoice/CreateInvoiceForm'

const COMPANY_LOGO = '/ak-monogram.png'
const COMPANY_ADDRESS = '61 Hackensack St, Flr 2, East Rutherford, NJ - 07073'
const COMPANY_PHONE = '8622359224'

// ⚠️ Transcribed from a handwritten note — please double-check every digit
// (account number, routing number, zip) before this goes out on a real invoice.
const WIRE_ACCOUNT_NAME = 'AK Gems Inc'
const WIRE_BANK_NAME = 'JP Morgan Chase'
const WIRE_BANK_ADDRESS = '90 Hackensack St, East Rutherford, NJ 07073, US'
const WIRE_ACCOUNT_NUMBER = '2911976566'
const WIRE_ABA_ROUTING = '021202337'
const WIRE_ZELLE = 'angandhi2@gmail.com'

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

function formatUsDate(isoDate: string): string {
  if (!isoDate) return ''
  const parsed = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return isoDate
  return parsed.toLocaleDateString('en-US')
}

function formatPhone(digits: string): string {
  const d = digits.replace(/\D/g, '')
  if (d.length !== 10) return digits
  return `(${d.slice(0, 3)})-${d.slice(3, 6)}-${d.slice(6)}`
}

export function InvoiceModal() {
  const invoiceContactId = useStore((s) => s.invoiceContactId)
  const setInvoiceContactId = useStore((s) => s.setInvoiceContactId)
  const contacts = useStore((s) => s.contacts)
  const addInvoice = useStore((s) => s.addInvoice)
  const showToast = useStore((s) => s.showToast)

  const contact = contacts.find((c) => c.id === invoiceContactId) || null
  const [isPreview, setIsPreview] = useState(false)
  const [draft, setDraft] = useState<SavedInvoice | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const savedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!invoiceContactId) return
    setIsPreview(false)
    setDraft(null)
    setSavedId(null)
    savedIdRef.current = null
  }, [invoiceContactId])

  if (!contact) return null

  const close = () => {
    setIsPreview(false)
    setDraft(null)
    setSavedId(null)
    savedIdRef.current = null
    setInvoiceContactId(null)
  }

  /** Store + cloud + Sheets. Guarded so Save followed by Print does not file it twice. */
  const persistInvoice = (record: SavedInvoice) => {
    if (savedIdRef.current === record.id) return
    savedIdRef.current = record.id
    setSavedId(record.id)

    addInvoice(record)
    void saveInvoiceSynced(record).then((ok) => {
      if (!ok) showToast('Invoice saved locally — cloud sync failed')
    })
    sendInvoiceToSheets(record).catch(() => {
      // silent — invoice is already saved locally
    })
    const { contacts: allContacts, invoices } = useStore.getState()
    void syncFollowupReminders(allContacts, invoices)
  }

  const saveInvoice = () => {
    if (!draft) return
    const alreadySaved = savedIdRef.current === draft.id
    persistInvoice(draft)
    showToast(alreadySaved ? 'Invoice already saved' : 'Invoice saved')
  }

  const customer = contact.company || contact.name || 'Customer'
  const customerAddress = [contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(', ')

  const printInvoice = () => {
    if (!draft) return
    const record = draft
    persistInvoice(record)

    const invoiceRows = record.items
      .map((item) => {
        return `<tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(upper(item.size || '-'))}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escapeHtml(String(item.pcs || '0'))}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${item.ct.toFixed(2)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(item.pct)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(item.amount)}</td>
        </tr>`
      })
      .join('')

    const docTitle = record.docKind === 'invoice' ? 'INVOICE' : 'MEMO'
    const customerPhone = contact.phone_mobile || contact.phone_work || ''
    const subtotal = record.items.reduce((sum, item) => sum + item.amount, 0)
    const dueLabel = record.docKind === 'invoice' ? dueDateLabel(record) : ''
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${docTitle}</title>
  <style>@page { margin: 0; }</style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 48px 40px; color: #111827; text-transform: uppercase;">
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
        <div style="margin-top:4px;color:#374151;font-size:12px;">${docTitle} #: ${escapeHtml(record.id)}</div>
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
    <tr>
      <td style="width:50%;vertical-align:top;border:1px solid #d1d5db;padding:10px 12px;">
        <div style="font-weight:700;font-size:11px;margin-bottom:5px;">${docTitle} To</div>
        <div>${escapeHtml(upper(customer))}</div>
        <div>${escapeHtml(upper(customerAddress || '-'))}</div>
        ${customerPhone ? `<div>${escapeHtml(customerPhone)}</div>` : ''}
      </td>
      <td style="width:50%;vertical-align:top;border:1px solid #d1d5db;border-left:none;padding:10px 12px;">
        <div style="font-weight:700;font-size:11px;margin-bottom:5px;">Ship To</div>
        <div>${escapeHtml(upper(customer))}</div>
        <div>${escapeHtml(upper(customerAddress || '-'))}</div>
        ${customerPhone ? `<div>${escapeHtml(customerPhone)}</div>` : ''}
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
        <td style="padding:7px 10px;border:1px solid #d1d5db;">${record.docKind === 'invoice' ? escapeHtml(upper(termsLabel(record.termsDays ?? 0))) : '—'}</td>
        <td style="padding:7px 10px;border:1px solid #d1d5db;">${escapeHtml(formatUsDate(record.date))}</td>
        <td style="padding:7px 10px;border:1px solid #d1d5db;">${dueLabel ? escapeHtml(dueLabel) : '—'}</td>
      </tr>
    </tbody>
  </table>

  <table style="width:100%; border-collapse: collapse;">
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

  <table style="width:100%;border-collapse:collapse;margin-top:28px;">
    <tr>
      <td style="width:56%;vertical-align:top;font-size:11px;color:#374151;line-height:1.7;">
        <div style="font-weight:700;margin-bottom:5px;">Wire Transfer Details</div>
        <div>Account Name: ${escapeHtml(WIRE_ACCOUNT_NAME)}</div>
        <div>Bank: ${escapeHtml(WIRE_BANK_NAME)}</div>
        <div>Bank Address: ${escapeHtml(WIRE_BANK_ADDRESS)}</div>
        <div>Account Number: ${escapeHtml(WIRE_ACCOUNT_NUMBER)}</div>
        <div>ABA Routing No: ${escapeHtml(WIRE_ABA_ROUTING)}</div>
        <div>Zelle: ${escapeHtml(WIRE_ZELLE)}</div>
      </td>
      <td style="width:44%;vertical-align:top;text-align:right;">
        <div style="color:#374151;">Subtotal: ${money(subtotal)}</div>
        <div style="margin-top:4px;color:#374151;">Shipping: ${money(record.shipping ?? 0)}</div>
        <div style="margin-top:8px;font-size:18px;font-weight:700;">Total: ${money(record.total)}</div>
      </td>
    </tr>
  </table>

  ${record.notes ? `<div style="margin-top: 22px; color: #4b5563; white-space: pre-wrap;">${escapeHtml(upper(record.notes))}</div>` : ''}
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
          overscrollBehavior: 'none',
          padding: '16px 16px 24px',
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 4, background: 'var(--bg4)', margin: '0 auto 14px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>{isPreview ? 'Invoice Preview' : 'Create Invoice'}</div>
          <button type="button" onClick={close} style={{ border: 'none', background: 'none', color: 'var(--text3)', display: 'flex', padding: 4 }} aria-label="Close">
            <X size={22} strokeWidth={2} />
          </button>
        </div>
        {!isPreview || !draft ? (
          <CreateInvoiceForm
            contact={contact}
            submitLabel="Preview"
            onCancel={close}
            onSubmit={(inv) => {
              setDraft(inv)
              setIsPreview(true)
            }}
          />
        ) : (
          <>
            <div style={{ border: '1px solid var(--border2)', borderRadius: 12, padding: 12, background: '#fff', color: '#111827', textTransform: 'uppercase' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ textAlign: 'left' }}>
                  <img src={COMPANY_LOGO} alt="AK" style={{ display: 'inline-block', height: 50, width: 'auto', verticalAlign: 'bottom' }} />
                  <span style={{ display: 'inline-block', fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 16, fontWeight: 400, letterSpacing: 5, marginLeft: 8, verticalAlign: 'bottom' }}>GEMS INC</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{draft.docKind === 'invoice' ? 'INVOICE' : 'MEMO'}</div>
                  <div style={{ fontSize: 10, color: '#374151' }}>#{draft.id}</div>
                </div>
              </div>
              <div style={{ textAlign: 'left', fontSize: 12, color: '#374151', marginTop: 10 }}>
                <div>{COMPANY_ADDRESS} | Tel: {formatPhone(COMPANY_PHONE)}</div>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: '#374151', display: 'flex', gap: 16 }}>
                {draft.docKind === 'invoice' && <div>Terms: {upper(termsLabel(draft.termsDays ?? 0))}</div>}
                <div>Date: {formatUsDate(draft.date)}</div>
                {draft.docKind === 'invoice' && dueDateLabel(draft) && <div>Due: {dueDateLabel(draft)}</div>}
              </div>
              <div style={{ marginTop: 10, fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                <div style={{ fontWeight: 700 }}>Bill To / Ship To</div>
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
                  {draft.items.map((item, idx) => (
                    <tr key={idx}>
                      <td style={tdStyle}>{upper(item.size || '-')}</td>
                      <td style={tdStyleRight}>{item.pcs || 0}</td>
                      <td style={tdStyleRight}>{item.ct.toFixed(2)}</td>
                      <td style={tdStyleRight}>{money(item.pct)}</td>
                      <td style={tdStyleRight}>{money(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 10.5, color: '#374151', lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700 }}>Wire Transfer Details</div>
                  <div>Account Name: {WIRE_ACCOUNT_NAME}</div>
                  <div>Bank: {WIRE_BANK_NAME}</div>
                  <div>Bank Address: {WIRE_BANK_ADDRESS}</div>
                  <div>Account Number: {WIRE_ACCOUNT_NUMBER}</div>
                  <div>ABA Routing No: {WIRE_ABA_ROUTING}</div>
                  <div>Zelle: {WIRE_ZELLE}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, color: '#374151', flexShrink: 0 }}>
                  <div>Subtotal: {money(draft.items.reduce((sum, item) => sum + item.amount, 0))}</div>
                  <div style={{ marginTop: 2 }}>Shipping: {money(draft.shipping ?? 0)}</div>
                  <div style={{ marginTop: 6, fontWeight: 800, fontSize: 14, color: '#111827' }}>Total: {money(draft.total)}</div>
                </div>
              </div>
              {draft.notes && <div style={{ marginTop: 10, fontSize: 12, whiteSpace: 'pre-wrap' }}>{upper(draft.notes)}</div>}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setIsPreview(false)} style={ghostBtnStyle}>Back</button>
              <button
                type="button"
                onClick={saveInvoice}
                disabled={savedId === draft.id}
                style={{ ...saveBtnStyle, opacity: savedId === draft.id ? 0.55 : 1 }}
              >
                {savedId === draft.id ? 'Saved' : 'Save'}
              </button>
            </div>
            <button type="button" onClick={printInvoice} style={{ ...primaryBtnStyle, width: '100%', marginTop: 8 }}>
              Download PDF / Print
            </button>
          </>
        )}
      </div>
    </div>
  )
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

const saveBtnStyle: React.CSSProperties = {
  flex: 1,
  borderRadius: 10,
  border: 'none',
  background: '#248a3d',
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
