import { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import { normalizeContact } from '../../lib/utils'
import { saveContactToDB } from '../../lib/supabase'
import { deleteImages } from '../../lib/imageStore'
import { IS_DEMO_MODE } from '../../lib/demo'
import { Contact } from '../../types/contact'

const TEXT_FIELDS: { key: keyof Contact; label: string; type?: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'title', label: 'Job Title' },
  { key: 'company', label: 'Company' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone_mobile', label: '📱 Mobile Phone', type: 'tel' },
  { key: 'phone_work', label: '📞 Work Phone', type: 'tel' },
  { key: 'phone_fax', label: '📠 Fax', type: 'tel' },
  { key: 'website', label: 'Website' },
  { key: 'address', label: 'Address' },
]

export function EditModal() {
  const editModal = useStore((s) => s.editModal)
  const setEditModal = useStore((s) => s.setEditModal)
  const addContacts = useStore((s) => s.addContacts)
  const updateContact = useStore((s) => s.updateContact)
  const deleteContact = useStore((s) => s.deleteContact)
  const setDetailContactId = useStore((s) => s.setDetailContactId)
  const showToast = useStore((s) => s.showToast)

  const [form, setForm] = useState<Contact | null>(null)

  useEffect(() => {
    if (editModal) setForm({ ...editModal.contact })
  }, [editModal])

  if (!editModal || !form) return null

  const { isNew } = editModal

  const set = (key: keyof Contact, val: string) =>
    setForm((prev) => prev ? { ...prev, [key]: val } : prev)

  const handleSave = async () => {
    const normalized = normalizeContact(form)

    if (!IS_DEMO_MODE) {
      const saved = await saveContactToDB(normalized)
      if (!saved) {
        showToast('Supabase backup failed — check Settings')
        return
      }
    }

    if (isNew) {
      addContacts([normalized])
    } else {
      updateContact(normalized.id, normalized)
    }
    setEditModal(null)
    showToast(IS_DEMO_MODE ? 'Demo mode: saved locally' : 'Saved!')
    if (!isNew) {
      // Re-open detail with fresh data
      setDetailContactId(normalized.id)
    }
  }

  const handleDelete = () => {
    if (!confirm('Remove this contact from this app? Supabase backup will stay saved.')) return
    deleteContact(form.id)
    deleteImages([`${form.id}_front`, `${form.id}_back`])
    setEditModal(null)
    setDetailContactId(null)
    showToast('Removed locally. Supabase backup kept.')
  }

  return (
    <div
      onClick={() => setEditModal(null)}
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
          width: '100%', maxWidth: 480, maxHeight: '90dvh',
          overflowY: 'auto', padding: '16px 16px 44px',
          animation: 'sheetUp 0.3s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {/* Handle */}
        <div style={{ width: 36, height: 4, borderRadius: 4,
          background: 'var(--bg4)', margin: '0 auto 14px' }} />

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>
            {isNew ? 'Add Contact' : 'Edit Contact'}
          </div>
          <button onClick={() => setEditModal(null)} style={{
            background: 'none', border: 'none', color: 'var(--text3)',
            fontSize: 22, cursor: 'pointer', padding: '2px 6px',
          }}>✕</button>
        </div>

        {/* Simple text fields */}
        {TEXT_FIELDS.map(({ key, label, type }) => (
          <div key={key} style={{ marginBottom: 11 }}>
            <label style={labelStyle}>{label}</label>
            <input
              type={type ?? 'text'}
              value={String(form[key] ?? '')}
              onChange={(e) => set(key, e.target.value)}
              style={inputStyle}
            />
          </div>
        ))}

        {/* City + State row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 11 }}>
          <div>
            <label style={labelStyle}>City</label>
            <input value={form.city} onChange={(e) => set('city', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>State</label>
            <input value={form.state} onChange={(e) => set('state', e.target.value)} style={inputStyle} />
          </div>
        </div>

        {/* ZIP + Country row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 11 }}>
          <div>
            <label style={labelStyle}>ZIP</label>
            <input value={form.zip ?? ''} onChange={(e) => set('zip', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Country</label>
            <input value={form.country} onChange={(e) => set('country', e.target.value)} style={inputStyle} />
          </div>
        </div>

        {/* Area */}
        <div style={{ marginBottom: 11 }}>
          <label style={labelStyle}>Area (e.g. Staten Island, Downtown)</label>
          <input value={form.area ?? ''} onChange={(e) => set('area', e.target.value)} style={inputStyle} placeholder="Custom area / neighborhood" />
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 11 }}>
          <label style={labelStyle}>Notes (from card)</label>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'none' }}
          />
        </div>
        <div style={{ marginBottom: 11 }}>
          <label style={labelStyle}>Your Personal Notes</label>
          <textarea
            value={form.user_notes}
            onChange={(e) => set('user_notes', e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'none' }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button onClick={handleSave} style={{ ...btn('primary'), flex: 2 }}>✓ Save</button>
          {!isNew && (
            <button onClick={handleDelete} style={{ ...btn('danger'), flex: 1 }}>🗑</button>
          )}
        </div>
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

function btn(v: 'primary' | 'danger'): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 7, padding: '13px 18px', borderRadius: 10, border: 'none',
    fontWeight: 700, fontSize: 15, cursor: 'pointer', transition: '0.18s',
    background: v === 'primary' ? 'var(--accent)' : 'var(--danger)',
    color: '#fff',
  }
}
