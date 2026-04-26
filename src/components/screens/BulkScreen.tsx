import { useState } from 'react'
import { useStore } from '../../store/useStore'
import {
  exportToCSV,
  sendToGoogleSheets,
  filterUnsentContactsForSheets,
  markContactsSentToSheets,
} from '../../lib/export'
import { deleteImages } from '../../lib/imageStore'
import { IS_DEMO_MODE } from '../../lib/demo'

export function BulkScreen() {
  const [isSendingSheets, setIsSendingSheets] = useState(false)
  const {
    contacts, selectedIds, clearSelected,
    deleteContact, setContacts, setBulkMessageType, showToast,
  } = useStore((s) => ({
    contacts: s.contacts,
    selectedIds: s.selectedIds,
    clearSelected: s.clearSelected,
    deleteContact: s.deleteContact,
    setContacts: s.setContacts,
    setBulkMessageType: s.setBulkMessageType,
    showToast: s.showToast,
  }))

  const targetContacts = selectedIds.length
    ? contacts.filter((c) => selectedIds.includes(c.id))
    : contacts
  const unsentTargetContacts = filterUnsentContactsForSheets(targetContacts)

  const handleExportCSV = () => {
    if (!targetContacts.length) { showToast('No contacts'); return }
    exportToCSV(targetContacts)
    showToast('CSV downloaded!')
  }

  const handleSendToSheets = async () => {
    if (isSendingSheets) return
    if (!targetContacts.length) { showToast('No contacts to send'); return }
    if (!unsentTargetContacts.length) {
      showToast('All selected contacts are already in Google Sheets')
      return
    }
    if (IS_DEMO_MODE) {
      showToast(`Demo mode: ${unsentTargetContacts.length} unsent contact(s) would sync to Sheets`)
      return
    }

    showToast(`Sending ${unsentTargetContacts.length} unsent contact(s)...`)
    setIsSendingSheets(true)
    try {
      const sent = await sendToGoogleSheets(unsentTargetContacts)
      const sentIds = new Set(unsentTargetContacts.map((contact) => contact.id))
      markContactsSentToSheets(Array.from(sentIds))
      setContacts(
        contacts.map((contact) => (
          sentIds.has(contact.id)
            ? { ...contact, sent_to_sheets: true }
            : contact
        ))
      )
      showToast(`${sent} new contact(s) sent to Sheets`)
    } catch (err) {
      showToast('Failed: ' + (err as Error).message)
    } finally {
      setIsSendingSheets(false)
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
      <ActionButton
        emoji={isSendingSheets ? '⏳' : '📊'}
        label={isSendingSheets ? 'Sending to Google Sheets...' : 'Send to Google Sheets'}
        onClick={handleSendToSheets}
        disabled={isSendingSheets}
      />
      <ActionButton emoji="✉" label="Bulk Email (BCC)" onClick={() => setBulkMessageType('email')} />
      <ActionButton emoji="💬" label="Bulk SMS" onClick={() => setBulkMessageType('sms')} />

      {IS_DEMO_MODE && <SheetsPreview contacts={targetContacts} />}

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

function SheetsPreview({ contacts }: { contacts: Array<{
  name: string
  title: string
  company: string
  email: string
  phone_mobile: string
  city: string
  state: string
}> }) {
  const previewRows = contacts.slice(0, 4)

  return (
    <div style={{
      marginTop: 14,
      border: '1px solid var(--border)',
      background: 'var(--bg2)',
      borderRadius: 14,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border2)',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Google Sheets Preview</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Demo-only view of synced rows
          </div>
        </div>
        <div style={{ color: '#188038', fontSize: 24 }}>▦</div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg3)', color: 'var(--text3)', textAlign: 'left' }}>
              {['Name', 'Title', 'Company', 'Email', 'Phone', 'Location'].map((header) => (
                <th key={header} style={{ padding: '9px 10px', borderBottom: '1px solid var(--border2)' }}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((contact) => (
              <tr key={`${contact.email}-${contact.phone_mobile}`}>
                <td style={cellStyle}>{contact.name || 'Unknown'}</td>
                <td style={cellStyle}>{contact.title}</td>
                <td style={cellStyle}>{contact.company}</td>
                <td style={{ ...cellStyle, color: 'var(--accent)', textDecoration: 'underline' }}>
                  {contact.email}
                </td>
                <td style={cellStyle}>{contact.phone_mobile}</td>
                <td style={cellStyle}>{[contact.city, contact.state].filter(Boolean).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ActionButton({ emoji, label, onClick, disabled }: {
  emoji: string; label: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...btnBase, marginBottom: 10, opacity: disabled ? 0.65 : 1 }}>
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

const cellStyle: React.CSSProperties = {
  padding: '9px 10px',
  borderBottom: '1px solid var(--border2)',
  whiteSpace: 'nowrap',
}
