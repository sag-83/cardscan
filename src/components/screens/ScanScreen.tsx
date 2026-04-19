import { useRef, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import { callGemini, fileToBase64, resizeImage } from '../../lib/gemini'
import { normalizeContact, uid, blankContact } from '../../lib/utils'
import { saveContactToDB } from '../../lib/supabase'
import { Contact } from '../../types/contact'

export function ScanScreen() {
  const frontInputRef = useRef<HTMLInputElement>(null)
  const backInputRef = useRef<HTMLInputElement>(null)

  const {
    contacts, apiKey, apiKey2,
    isScanning, setIsScanning,
    previewCards, setPreviewCards,
    addContacts, updateContact,
    pendingBackId, setPendingBackId,
    triggerBackScan, setTriggerBackScan,
    setActiveScreen, showToast,
  } = useStore((s) => ({
    contacts: s.contacts,
    apiKey: s.apiKey,
    apiKey2: s.apiKey2,
    isScanning: s.isScanning,
    setIsScanning: s.setIsScanning,
    previewCards: s.previewCards,
    setPreviewCards: s.setPreviewCards,
    addContacts: s.addContacts,
    updateContact: s.updateContact,
    pendingBackId: s.pendingBackId,
    setPendingBackId: s.setPendingBackId,
    triggerBackScan: s.triggerBackScan,
    setTriggerBackScan: s.setTriggerBackScan,
    setActiveScreen: s.setActiveScreen,
    showToast: s.showToast,
  }))

  // Called from ContactMenuModal via store flag
  useEffect(() => {
    if (triggerBackScan) {
      setTriggerBackScan(false)
      backInputRef.current?.click()
    }
  }, [triggerBackScan, setTriggerBackScan])

  const startScan = (side: 'front' | 'back') => {
    if (!apiKey) {
      showToast('Set Gemini API key in Settings ⚙️')
      setActiveScreen('settings')
      return
    }
    if (side === 'back') {
      if (!contacts.length) { showToast('Scan a front side first'); return }
      if (!pendingBackId) setPendingBackId(contacts[0].id)
      backInputRef.current?.click()
    } else {
      setPendingBackId(null)
      frontInputRef.current?.click()
    }
  }

  const handleFile = async (file: File, side: 'front' | 'back') => {
    setPreviewCards([])
    setIsScanning(true)
    try {
      const b64 = await fileToBase64(file)
      const thumb = await resizeImage(b64, file.type, side === 'front' ? 500 : 600)
      const extracted = await callGemini(b64, file.type, apiKey, apiKey2)

      if (side === 'back' && pendingBackId) {
        const target = contacts.find((c) => c.id === pendingBackId)
        if (target) {
          const bd = (extracted[0] ?? {}) as Record<string, string>
          const merged: Contact = { ...target, back_image: thumb }

          // Smart phone field merging
          const newPhones = [bd.phone_mobile, bd.phone_work, bd.phone_fax].filter(Boolean)
          newPhones.forEach((ph) => {
            if (!merged.phone_mobile) merged.phone_mobile = ph
            else if (!merged.phone_work && merged.phone_mobile !== ph) merged.phone_work = ph
            else if (!merged.phone_fax && merged.phone_work !== ph && merged.phone_mobile !== ph) merged.phone_fax = ph
          })

          // Fill empty identity/address fields
          const fillFields = ['address', 'city', 'state', 'zip', 'country'] as const
          fillFields.forEach((f) => {
            if (bd[f] && !merged[f]) merged[f] = bd[f].toUpperCase().trim()
          })
          if (bd.email && !merged.email) merged.email = bd.email.toLowerCase().trim()
          if (bd.website && !merged.website) merged.website = bd.website
          if (bd.name && !merged.name) merged.name = bd.name
          if (bd.title && !merged.title) merged.title = bd.title
          if (bd.company && !merged.company) merged.company = bd.company.toUpperCase().trim()
          if (bd.notes?.trim())
            merged.back_notes = [merged.back_notes, bd.notes].filter(Boolean).join(' | ')

          updateContact(pendingBackId, merged)
          await saveContactToDB(merged)
          showToast('Back side merged into contact!')
        }
        setPendingBackId(null)
        setIsScanning(false)
        return
      }

      const newCards: Contact[] = extracted.map((raw) =>
        normalizeContact({
          ...blankContact(),
          id: uid(),
          name: raw.name ?? '',
          title: raw.title ?? '',
          company: raw.company ?? '',
          email: raw.email ?? '',
          phone_mobile: raw.phone_mobile ?? '',
          phone_work: raw.phone_work ?? '',
          phone_fax: raw.phone_fax ?? '',
          website: raw.website ?? '',
          address: raw.address ?? '',
          city: raw.city ?? '',
          state: raw.state ?? '',
          zip: raw.zip ?? '',
          country: raw.country ?? '',
          notes: raw.notes ?? '',
          front_image: thumb,
        })
      )

      setIsScanning(false)
      setPreviewCards(newCards)
    } catch (err) {
      showToast('Scan failed: ' + (err as Error).message)
      setIsScanning(false)
    }
  }

  const acceptPreview = async () => {
    addContacts(previewCards)
    previewCards.forEach((c) => saveContactToDB(c))
    showToast(`${previewCards.length} contact(s) added!`)
    setPreviewCards([])
    setActiveScreen('contacts')
  }

  const cancelPreview = () => setPreviewCards([])

  // ── Render ────────────────────────────────────────────────────────────────

  if (isScanning) return <ScanningLoader />

  if (previewCards.length) {
    return (
      <PreviewPanel
        cards={previewCards}
        onAccept={acceptPreview}
        onCancel={cancelPreview}
      />
    )
  }

  return (
    <div>
      {/* Hidden file inputs */}
      <input
        ref={frontInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f, 'front')
          e.target.value = ''
        }}
      />
      <input
        ref={backInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f, 'back')
          e.target.value = ''
        }}
      />

      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '44px 24px 32px' }}>
        <div
          style={{
            width: 108, height: 108, borderRadius: 26,
            background: 'rgba(0,122,255,0.07)',
            border: '2px dashed rgba(0,122,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 22px',
            animation: 'pulseGlow 3s ease infinite',
          }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
            stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8, letterSpacing: '-0.3px' }}>
          Scan Business Cards
        </div>
        <div style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 30 }}>
          Point your camera at a card.<br />AI extracts all contacts instantly.
        </div>
        <button onClick={() => startScan('front')} style={btnStyle('primary')}>
          📸 Scan Card (Front)
        </button>
        {contacts.length > 0 && (
          <button onClick={() => startScan('back')} style={{ ...btnStyle('secondary'), marginTop: 10 }}>
            ↩ Scan Back of Last Card
          </button>
        )}
      </div>

      {/* Stats */}
      {contacts.length > 0 && (
        <div style={{
          margin: '0 24px 24px', padding: 16,
          background: 'var(--bg2)', borderRadius: 12,
          border: '1px solid var(--border2)', textAlign: 'center',
        }}>
          <div style={{ fontSize: 38, fontWeight: 800, color: 'var(--accent)' }}>
            {contacts.length}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>
            Total Contacts
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScanningLoader() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 16, padding: '70px 24px',
    }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {[0, 150, 300].map((delay) => (
          <div
            key={delay}
            style={{
              width: 10, height: 10, borderRadius: 99,
              background: 'var(--accent)',
              animation: `bounceDot 1.4s ease ${delay}ms infinite`,
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700 }}>Extracting contacts...</div>
      <div style={{ fontSize: 13, color: 'var(--text3)' }}>Gemini AI is reading your card</div>
    </div>
  )
}

function PreviewPanel({
  cards, onAccept, onCancel,
}: {
  cards: Contact[]
  onAccept: () => void
  onCancel: () => void
}) {
  return (
    <div style={{ paddingBottom: 20 }}>
      <div style={{ padding: '0 16px' }}>
        <div style={{ fontSize: 20, fontWeight: 800, margin: '16px 0 12px' }}>
          Found {cards.length} card{cards.length > 1 ? 's' : ''} ✨
        </div>

        {cards.map((c, i) => (
          <div
            key={c.id}
            style={{
              background: 'var(--bg2)', borderRadius: 12, padding: 14,
              marginBottom: 10, border: '1px solid var(--border2)',
              animation: `cardIn 0.35s ease ${i * 80}ms both`,
            }}
          >
            {c.front_image && (
              <img
                src={`data:image/jpeg;base64,${c.front_image}`}
                style={{ width: '100%', maxHeight: 160, objectFit: 'contain',
                  borderRadius: 8, marginBottom: 10, border: '1px solid var(--border2)',
                  background: 'var(--bg3)' }}
                alt="Card preview"
              />
            )}
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {c.name || <span style={{ color: 'var(--text3)' }}>Unknown</span>}
            </div>
            <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, marginTop: 2 }}>
              {c.title}{c.company ? ' · ' + c.company : ''}
            </div>
            {c.email && <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 3 }}>✉ {c.email}</div>}
            {c.phone_mobile && <div style={{ fontSize: 13, color: 'var(--text2)' }}>📱 {c.phone_mobile}</div>}
            {c.phone_work && <div style={{ fontSize: 13, color: 'var(--text2)' }}>📞 {c.phone_work}</div>}
            {c.city && (
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                📍 {c.city}{c.state ? ', ' + c.state : ''}{c.zip ? ' ' + c.zip : ''}
              </div>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10, margin: '4px 0 16px' }}>
          <button onClick={onCancel} style={{ ...btnStyle('secondary'), flex: 1 }}>
            Rescan
          </button>
          <button onClick={onAccept} style={{ ...btnStyle('primary'), flex: 2 }}>
            ✓ Add {cards.length > 1 ? 'All' : 'Contact'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Shared style helpers ──────────────────────────────────────────────────────

function btnStyle(variant: 'primary' | 'secondary' | 'danger'): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 7, padding: '13px 18px', borderRadius: 10, border: 'none',
    fontWeight: 700, fontSize: 15, cursor: 'pointer', width: '100%',
    transition: '0.18s',
  }
  if (variant === 'primary') return { ...base, background: 'var(--accent)', color: '#fff' }
  if (variant === 'danger') return { ...base, background: 'var(--danger)', color: '#fff' }
  return { ...base, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)' }
}
