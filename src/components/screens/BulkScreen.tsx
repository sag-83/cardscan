import { useStore } from '../../store/useStore'
import { exportToCSV, sendToGoogleSheets } from '../../lib/export'
import { deleteImages } from '../../lib/imageStore'

export function BulkScreen() {
  const {
    contacts, selectedIds, clearSelected,
    deleteContact, setBulkMessageType, showToast,
  } = useStore((s) => ({
    contacts: s.contacts,
    selectedIds: s.selectedIds,
    clearSelected: s.clearSelected,
    deleteContact: s.deleteContact,
    setBulkMessageType: s.setBulkMessageType,
    showToast: s.showToast,
  }))

  const targetContacts = selectedIds.length
    ? contacts.filter((c) => selectedIds.includes(c.id))
    : contacts

  const handleExportCSV = () => {
    if (!targetContacts.length) { showToast('No contacts'); return }
    exportToCSV(targetContacts)
    showToast('CSV downloaded!')
  }

  const handleSendToSheets = async () => {
    if (!targetContacts.length) { showToast('No contacts to send'); return }
    showToast(`Sending ${targetContacts.length}...`)
    try {
      const sent = await sendToGoogleSheets(targetContacts)
      showToast(`${sent} sent to Sheets!`)
    } catch (err) {
      showToast('Failed: ' + (err as Error).message)
    }
  }

  const handleDeleteSelected = () => {
    if (!selectedIds.length) return
    if (!confirm(`Remove ${selectedIds.length} contact(s) from this app? Supabase backup will stay saved.`)) return

    const imageKeys = selectedIds.flatMap((id) => [`${id}_front`, `${id}_back`])
    selectedIds.forEach((id) => {
      deleteContact(id)
    })
    deleteImages(imageKeys)
    clearSelected()
    showToast('Removed locally. Supabase backup kept.')
  }

  return (
    <div style={{ padding: '20px 16px' }}>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Bulk Actions</div>
      <div style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 20 }}>
        {selectedIds.length
          ? `${selectedIds.length} contact${selectedIds.length !== 1 ? 's' : ''} selected`
          : 'Actions apply to all contacts.'}
      </div>

      <ActionButton emoji="⬇" label="Export CSV" onClick={handleExportCSV} />
      <ActionButton emoji="📊" label="Send to Google Sheets" onClick={handleSendToSheets} />
      <ActionButton emoji="✉" label="Bulk Email (BCC)" onClick={() => setBulkMessageType('email')} />
      <ActionButton emoji="💬" label="Bulk SMS" onClick={() => setBulkMessageType('sms')} />

      {selectedIds.length > 0 && (
        <button
          onClick={handleDeleteSelected}
          style={{
            ...btnBase,
            background: 'var(--danger)', color: '#fff', marginTop: 8,
          }}
        >
          🗑 Delete Selected ({selectedIds.length})
        </button>
      )}
    </div>
  )
}

function ActionButton({ emoji, label, onClick }: {
  emoji: string; label: string; onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{ ...btnBase, marginBottom: 10 }}>
      {emoji} {label}
    </button>
  )
}

const btnBase: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 7, padding: '13px 18px', borderRadius: 10,
  background: 'var(--bg3)', color: 'var(--text)',
  border: '1px solid var(--border)', fontWeight: 700,
  fontSize: 15, cursor: 'pointer', width: '100%',
  transition: '0.18s',
}
