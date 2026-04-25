import { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import { saveContactToDB } from '../../lib/supabase'
import { IS_DEMO_MODE } from '../../lib/demo'

function toDatetimeLocal(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const offset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - offset).toISOString().slice(0, 16)
}

export function FollowupModal() {
  const followupContactId = useStore((s) => s.followupContactId)
  const setFollowupContactId = useStore((s) => s.setFollowupContactId)
  const contacts = useStore((s) => s.contacts)
  const updateContact = useStore((s) => s.updateContact)
  const showToast = useStore((s) => s.showToast)

  const [dateValue, setDateValue] = useState('')
  const [noteValue, setNoteValue] = useState('')

  const contact = contacts.find((c) => c.id === followupContactId)

  useEffect(() => {
    if (contact) {
      setDateValue(toDatetimeLocal(contact.followup_at || ''))
      setNoteValue(contact.followup_note || '')
    }
  }, [contact?.id])

  if (!contact) return null

  const close = () => setFollowupContactId(null)

  const handleSave = async () => {
    if (!dateValue) { showToast('Pick a date and time first'); return }
    const followup_at = new Date(dateValue).toISOString()
    const followup_note = noteValue.trim()
    if (!IS_DEMO_MODE) {
      const saved = await saveContactToDB({ ...contact, followup_at, followup_note })
      if (!saved) { showToast('Supabase backup failed'); return }
    }
    updateContact(contact.id, { followup_at, followup_note })
    showToast('Follow-up set!')
    close()
  }

  const handleClear = async () => {
    if (!IS_DEMO_MODE) {
      await saveContactToDB({ ...contact, followup_at: '', followup_note: '' })
    }
    updateContact(contact.id, { followup_at: '', followup_note: '' })
    showToast('Follow-up cleared')
    close()
  }

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, background: 'var(--modal-bg)',
        zIndex: 400, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'fadeIn 0.18s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg2)', borderRadius: '22px 22px 0 0',
          width: '100%', maxWidth: 480, padding: '16px 16px 48px',
          animation: 'sheetUp 0.3s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {/* Handle */}
        <div style={{ width: 36, height: 4, borderRadius: 4, background: 'var(--bg4)', margin: '0 auto 14px' }} />

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800 }}>Set Follow-up</div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 3 }}>
              {contact.name || contact.company || 'Contact'}
            </div>
          </div>
          <button onClick={close} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 22, cursor: 'pointer', padding: '2px 6px' }}>✕</button>
        </div>

        {/* Date & Time */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Date &amp; Time</label>
          <input
            type="datetime-local"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Note */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Reminder Note <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(optional)</span></label>
          <textarea
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            rows={3}
            placeholder="e.g. Ask about gold rings order, bring new catalogue..."
            style={{ ...inputStyle, resize: 'none' }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleSave} style={{ ...btnStyle, flex: 2, background: 'var(--accent)' }}>
            📅 Set Reminder
          </button>
          {contact.followup_at && (
            <button onClick={handleClear} style={{ ...btnStyle, flex: 1, background: 'var(--danger)' }}>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text3)', marginBottom: 6,
  fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', background: 'var(--bg3)',
  border: '1.5px solid var(--border)', borderRadius: 10,
  color: 'var(--text)', fontSize: 15,
}

const btnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 7, padding: '13px 18px', borderRadius: 10, border: 'none',
  color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
}
