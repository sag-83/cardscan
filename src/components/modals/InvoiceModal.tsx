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
const COMPANY_ADDRESS = '61 Hackensack St, Flr 2, East Rutherford NJ 07073'
const COMPANY_PHONE = '8622359224'

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
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${docTitle}</title>
  <style>@page { margin: 0; }</style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 48px 40px; color: #111827; text-transform: uppercase;">
  <div style="text-align:left;">
    <img src="${COMPANY_LOGO}" alt="AK" style="display:inline-block;height:60px;width:auto;vertical-align:bottom;" />
    <span style="display:inline-block;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:400;letter-spacing:6px;margin-left:10px;vertical-align:bottom;">GEMS INC</span>
  </div>
  <div style="text-align:left;color:#374151;margin:22px 0 26px;">
    <div>${COMPANY_ADDRESS} &nbsp; | &nbsp; Tel: ${formatPhone(COMPANY_PHONE)}</div>
  </div>
  <h1 style="margin: 0 0 8px;">${docTitle}</h1>
  <div style="margin-bottom: 6px; color: #374151;">Date: ${formatUsDate(record.date)}</div>
  ${record.docKind === 'invoice' ? `<div style="margin-bottom: 6px; color: #374151;">Terms: ${escapeHtml(upper(termsLabel(record.termsDays ?? 0)))}</div>` : ''}
  ${record.docKind === 'invoice' && dueDateLabel(record) ? `<div style="margin-bottom: 14px; color: #374151;">Payment due: ${escapeHtml(dueDateLabel(record))}</div>` : ''}
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
    Total: ${money(record.total)}
  </div>
  <div style="margin-top: 22px; color: #4b5563; white-space: pre-wrap;">${escapeHtml(upper(record.notes || ''))}</div>
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
              <div style={{ textAlign: 'left' }}>
                <img src={COMPANY_LOGO} alt="AK" style={{ display: 'inline-block', height: 50, width: 'auto', verticalAlign: 'bottom' }} />
                <span style={{ display: 'inline-block', fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 16, fontWeight: 400, letterSpacing: 5, marginLeft: 8, verticalAlign: 'bottom' }}>GEMS INC</span>
              </div>
              <div style={{ textAlign: 'left', fontSize: 12, color: '#374151', marginTop: 16 }}>
                <div>{COMPANY_ADDRESS} | Tel: {formatPhone(COMPANY_PHONE)}</div>
              </div>
              <div style={{ marginTop: 12, fontWeight: 800, fontSize: 16 }}>{draft.docKind === 'invoice' ? 'INVOICE' : 'MEMO'}</div>
              <div style={{ fontSize: 12, color: '#374151' }}>Date: {formatUsDate(draft.date)}</div>
              {draft.docKind === 'invoice' && (
                <div style={{ fontSize: 12, color: '#374151' }}>
                  Terms: {upper(termsLabel(draft.termsDays ?? 0))}
                </div>
              )}
              {draft.docKind === 'invoice' && dueDateLabel(draft) && (
                <div style={{ fontSize: 12, color: '#374151' }}>Payment due: {dueDateLabel(draft)}</div>
              )}
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
              <div style={{ marginTop: 10, textAlign: 'right', fontWeight: 800 }}>Total: {money(draft.total)}</div>
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
