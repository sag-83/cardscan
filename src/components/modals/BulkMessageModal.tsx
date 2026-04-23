import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { IS_DEMO_MODE } from '../../lib/demo'

export function BulkMessageModal() {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const bulkMessageType = useStore((s) => s.bulkMessageType)
  const setBulkMessageType = useStore((s) => s.setBulkMessageType)
  const contacts = useStore((s) => s.contacts)
  const selectedIds = useStore((s) => s.selectedIds)
  const showToast = useStore((s) => s.showToast)

  const targetContacts = selectedIds.length
    ? contacts.filter((c) => selectedIds.includes(c.id))
    : contacts

  if (!bulkMessageType) return null

  const close = () => setBulkMessageType(null)

  const handleSend = () => {
    if (IS_DEMO_MODE) {
      showToast(`Demo mode: this would open ${bulkMessageType === 'email' ? 'email' : 'SMS'} for ${targetContacts.length} contact(s)`)
      close()
      return
    }

    if (bulkMessageType === 'email') {
      const emails = targetContacts.map((c) => c.email).filter(Boolean).join(',')
      if (!emails) { showToast('No email addresses found'); return }
      window.location.href = `mailto:?bcc=${encodeURIComponent(emails)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      showToast('Opening email app...')
    } else {
      const phones = targetContacts
        .map((c) => c.phone_mobile || c.phone_work)
        .filter(Boolean)
        .join(',')
      if (!phones) { showToast('No phone numbers found'); return }
      window.open(`sms:${phones}?body=${encodeURIComponent(body)}`)
      showToast('Opening SMS...')
    }
    close()
  }

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, background: 'var(--modal-bg)',
        zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'fadeIn 0.18s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg2)', borderRadius: '22px 22px 0 0',
          width: '100%', maxWidth: 480, padding: '16px 16px 44px',
          animation: 'sheetUp 0.3s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 4,
          background: 'var(--bg4)', margin: '0 auto 14px' }} />

        <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 4 }}>
          Bulk {bulkMessageType === 'email' ? 'Email' : 'SMS'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 14 }}>
          Sending to <strong>{targetContacts.length}</strong> contact
          {targetContacts.length !== 1 ? 's' : ''}
        </div>

        {bulkMessageType === 'email' && (
          <div style={{ marginBottom: 11 }}>
            <label style={labelStyle}>Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Great meeting you..."
              style={inputStyle}
            />
          </div>
        )}

        <div style={{ marginBottom: 11 }}>
          <label style={labelStyle}>Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hi! It was great meeting you..."
            rows={4}
            style={{ ...inputStyle, resize: 'none' }}
          />
        </div>

        <button
          onClick={handleSend}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 7, padding: '13px 18px', borderRadius: 10, border: 'none',
            background: 'var(--accent)', color: '#fff', fontWeight: 700,
            fontSize: 15, cursor: 'pointer', width: '100%',
          }}
        >
          ✈ Send
        </button>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text3)', marginBottom: 5,
  fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', background: 'var(--bg3)',
  border: '1.5px solid var(--border)', borderRadius: 10,
  color: 'var(--text)', fontSize: 15,
}
