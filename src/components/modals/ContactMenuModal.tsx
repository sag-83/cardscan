import { useStore } from '../../store/useStore'
import { deleteImages } from '../../lib/imageStore'

export function ContactMenuModal() {
  const menuContactId = useStore((s) => s.menuContactId)
  const contacts = useStore((s) => s.contacts)
  const setMenuContactId = useStore((s) => s.setMenuContactId)
  const setDetailContactId = useStore((s) => s.setDetailContactId)
  const setEditModal = useStore((s) => s.setEditModal)
  const deleteContact = useStore((s) => s.deleteContact)
  const setPendingBackId = useStore((s) => s.setPendingBackId)
  const setTriggerBackScan = useStore((s) => s.setTriggerBackScan)
  const setActiveScreen = useStore((s) => s.setActiveScreen)
  const showToast = useStore((s) => s.showToast)

  const contact = contacts.find((c) => c.id === menuContactId)
  if (!contact) return null

  const close = () => setMenuContactId(null)

  const handleView = () => {
    close()
    setDetailContactId(contact.id)
  }

  const handleEdit = () => {
    close()
    setEditModal({ contact, isNew: false })
  }

  const handleScanBack = () => {
    close()
    setPendingBackId(contact.id)
    setActiveScreen('scan')
    // Small delay so ScanScreen mounts before trigger fires
    setTimeout(() => setTriggerBackScan(true), 80)
  }

  const handleDelete = () => {
    if (!confirm(`Remove ${contact.name || contact.company || 'this contact'} from this app? Supabase backup will stay saved.`)) return
    deleteContact(contact.id)
    deleteImages([`${contact.id}_front`, `${contact.id}_back`])
    close()
    setDetailContactId(null)
    showToast('Removed locally. Supabase backup kept.')
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

        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>
          {contact.name || contact.company || 'Contact'}
        </div>

        <MenuBtn onClick={handleView}>👁 View</MenuBtn>
        <MenuBtn onClick={handleEdit}>✏️ Edit</MenuBtn>
        <MenuBtn onClick={handleScanBack}>📸 Scan Back Side</MenuBtn>
        <MenuBtn onClick={handleDelete} danger>🗑 Delete</MenuBtn>
      </div>
    </div>
  )
}

function MenuBtn({ children, onClick, danger }: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 7, padding: '13px 18px', borderRadius: 10, marginBottom: 8,
        background: danger ? 'var(--danger)' : 'var(--bg3)',
        color: danger ? '#fff' : 'var(--text)',
        border: danger ? 'none' : '1px solid var(--border)',
        fontWeight: 700, fontSize: 15, cursor: 'pointer', width: '100%',
      }}
    >
      {children}
    </button>
  )
}
