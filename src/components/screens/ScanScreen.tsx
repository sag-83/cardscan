import { useRef, useEffect, useState, type CSSProperties, type ChangeEvent } from 'react'
import { useStore } from '../../store/useStore'
import { callGemini, fileToBase64, resizeImage } from '../../lib/gemini'
import { findDuplicateContact, normalizeContact, uid, blankContact } from '../../lib/utils'
import {
  findDuplicateContactInDB,
  getLastSupabaseError,
  saveContactToDB,
  saveContactsToDB,
  uploadCardPhoto,
} from '../../lib/supabase'
import { saveImage } from '../../lib/imageStore'
import type { Contact } from '../../types/contact'

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_PDF_BYTES = 6 * 1024 * 1024
const SUPPORTED_SCAN_TYPES = ['application/pdf']

function isSupportedScanFile(file: File): boolean {
  return file.type.startsWith('image/') || SUPPORTED_SCAN_TYPES.includes(file.type)
}

async function filterUniqueAgainstLocalAndCloud(
  cards: Contact[],
  contacts: Contact[]
): Promise<{ unique: Contact[]; localDuplicates: Contact[]; restoredFromCloud: Contact[] }> {
  const unique: Contact[] = []
  const localDuplicates: Contact[] = []
  const restoredFromCloud: Contact[] = []

  for (const card of cards) {
    const localDuplicate = findDuplicateContact(card, contacts)
    if (localDuplicate) {
      localDuplicates.push(localDuplicate)
      continue
    }

    if (findDuplicateContact(card, unique) || findDuplicateContact(card, restoredFromCloud)) {
      continue
    }

    const cloudDuplicate = await findDuplicateContactInDB(card)
    if (cloudDuplicate) {
      restoredFromCloud.push(normalizeContact(cloudDuplicate))
      continue
    }

    unique.push(card)
  }

  return { unique, localDuplicates, restoredFromCloud }
}

export function ScanScreen() {
  const frontInputRef = useRef<HTMLInputElement | null>(null)
  const frontFileInputRef = useRef<HTMLInputElement | null>(null)
  const backInputRef = useRef<HTMLInputElement | null>(null)
  const backFileInputRef = useRef<HTMLInputElement | null>(null)
  const [isSavingPreview, setIsSavingPreview] = useState(false)

  const {
    contacts,
    apiKey,
    apiKey2,
    apiKey3,
    isScanning,
    setIsScanning,
    previewCards,
    setPreviewCards,
    addContacts,
    updateContact,
    pendingBackId,
    setPendingBackId,
    triggerBackScan,
    setTriggerBackScan,
    setActiveScreen,
    setDetailContactId,
    showToast,
  } = useStore((s) => ({
    contacts: s.contacts,
    apiKey: s.apiKey,
    apiKey2: s.apiKey2,
    apiKey3: s.apiKey3,
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
    setDetailContactId: s.setDetailContactId,
    showToast: s.showToast,
  }))

  useEffect(() => {
    if (triggerBackScan) {
      setTriggerBackScan(false)
      backInputRef.current?.click()
    }
  }, [triggerBackScan, setTriggerBackScan])

  const startScan = (side: 'front' | 'back', source: 'camera' | 'files' = 'camera') => {
    if (!apiKey) {
      showToast('Set Gemini API key in Settings ⚙️')
      setActiveScreen('settings')
      return
    }

    if (side === 'back') {
      if (!contacts.length) {
        showToast('Scan a front side first')
        return
      }

      if (!pendingBackId) {
        setPendingBackId(contacts[0].id)
      }

      ;(source === 'files' ? backFileInputRef : backInputRef).current?.click()
    } else {
      setPendingBackId(null)
      ;(source === 'files' ? frontFileInputRef : frontInputRef).current?.click()
    }
  }

  const handleFile = async (file: File, side: 'front' | 'back') => {
    if (!isSupportedScanFile(file)) {
      showToast('Please choose an image or PDF scan')
      return
    }

    if (file.type === 'application/pdf' && file.size > MAX_PDF_BYTES) {
      showToast('PDF scan is too large — save/export one card as an image instead')
      return
    }

    if (file.size > MAX_IMAGE_BYTES) {
      showToast('Image is too large — use a smaller photo')
      return
    }

    setPreviewCards([])
    setIsScanning(true)

    try {
      const b64 = await fileToBase64(file)

      const isPdf = file.type === 'application/pdf'

      // Small preview image for UI. PDFs can be OCR'd directly, but cannot be shown in <img>.
      const thumb = isPdf ? '' : await resizeImage(b64, file.type, side === 'front' ? 500 : 600)

      // Medium-size image for OCR/API call to reduce request size
      const scanB64 = isPdf ? b64 : await resizeImage(b64, file.type, 1600)

      const extracted = await callGemini(scanB64, isPdf ? 'application/pdf' : 'image/jpeg', [apiKey, apiKey2, apiKey3])

      if (!extracted.length) {
        showToast('No card detected — try a clearer photo')
        setIsScanning(false)
        return
      }

      if (side === 'back' && pendingBackId) {
        const target = contacts.find((c) => c.id === pendingBackId)

        if (!target) {
          showToast('Original contact not found — try again')
          setPendingBackId(null)
          setIsScanning(false)
          return
        }

        if (target) {
          const bd = (extracted[0] ?? {}) as Record<string, string>

          await saveImage(`${pendingBackId}_back`, thumb).catch(() => {})
          const backUrl = await uploadCardPhoto(pendingBackId, 'back', thumb)

          const merged: Contact = {
            ...target,
            back_image: thumb,
            ...(backUrl ? { back_image_url: backUrl } : {}),
          }

          const newPhones = [bd.phone_mobile, bd.phone_work, bd.phone_fax].filter(Boolean)

          newPhones.forEach((ph) => {
            if (!merged.phone_mobile) {
              merged.phone_mobile = ph
            } else if (!merged.phone_work && merged.phone_mobile !== ph) {
              merged.phone_work = ph
            } else if (
              !merged.phone_fax &&
              merged.phone_mobile !== ph &&
              merged.phone_work !== ph
            ) {
              merged.phone_fax = ph
            }
          })

          const fillFields: Array<keyof Contact> = ['address', 'city', 'state', 'zip', 'country']

          fillFields.forEach((f) => {
            const value = bd[f as string]
            if (value && !merged[f]) {
              merged[f] = value.toUpperCase().trim() as never
            }
          })

          if (bd.email && !merged.email) merged.email = bd.email.toLowerCase().trim()
          if (bd.website && !merged.website) merged.website = bd.website
          if (bd.name && !merged.name) merged.name = bd.name
          if (bd.title && !merged.title) merged.title = bd.title
          if (bd.company && !merged.company) merged.company = bd.company.toUpperCase().trim()

          if (bd.notes?.trim()) {
            merged.back_notes = [merged.back_notes, bd.notes].filter(Boolean).join(' | ')
          }

          const saved = await saveContactToDB(merged)
          if (!saved) {
            showToast(getLastSupabaseError() || 'Back scanned locally, but Supabase backup failed')
            setIsScanning(false)
            return
          }

          updateContact(pendingBackId, merged)
          showToast('Back side merged into contact!')
        }

        setPendingBackId(null)
        setIsScanning(false)
        return
      }

      const newCards: Contact[] = extracted.map((raw: Record<string, string>) =>
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

      const {
        unique: uniqueCards,
        localDuplicates,
        restoredFromCloud,
      } = await filterUniqueAgainstLocalAndCloud(
        newCards,
        contacts
      )

      setIsScanning(false)

      if (restoredFromCloud.length) {
        addContacts(restoredFromCloud)
      }

      if (!uniqueCards.length) {
        if (restoredFromCloud.length) {
          showToast('Already in Supabase — restored to app')
          setActiveScreen('contacts')
          setDetailContactId(restoredFromCloud[0].id)
        } else if (localDuplicates.length) {
          showToast('Already saved — opening existing contact')
          setActiveScreen('contacts')
          setDetailContactId(localDuplicates[0].id)
        } else {
          showToast('Already saved — duplicate card skipped')
        }
        return
      }

      if (localDuplicates.length) {
        showToast(`${localDuplicates.length} duplicate card(s) skipped`)
      }

      setPreviewCards(uniqueCards)
    } catch (err) {
      showToast('Scan failed: ' + (err as Error).message)
      setIsScanning(false)
    }
  }

  const acceptPreview = async () => {
    if (!previewCards.length || isSavingPreview) return

    setIsSavingPreview(true)

    try {
      const {
        unique: uniquePreviewCards,
        localDuplicates,
        restoredFromCloud,
      } = await filterUniqueAgainstLocalAndCloud(
        previewCards,
        contacts
      )

      if (restoredFromCloud.length) {
        addContacts(restoredFromCloud)
      }

      if (!uniquePreviewCards.length) {
        if (restoredFromCloud.length) {
          showToast('Already in Supabase — restored to app')
          setActiveScreen('contacts')
          setDetailContactId(restoredFromCloud[0].id)
        } else if (localDuplicates.length) {
          showToast('Already saved — opening existing contact')
          setActiveScreen('contacts')
          setDetailContactId(localDuplicates[0].id)
        } else {
          showToast('Already saved — duplicate card skipped')
        }
        setPreviewCards([])
        return
      }

      if (localDuplicates.length) {
        showToast(`${localDuplicates.length} duplicate card(s) skipped`)
      }

      const enriched = await Promise.all(
        uniquePreviewCards.map(async (c) => {
          if (c.front_image) {
            await saveImage(`${c.id}_front`, c.front_image).catch(() => {})
            const url = await uploadCardPhoto(c.id, 'front', c.front_image)
            if (url) return { ...c, front_image_url: url }
          }
          return c
        })
      )

      const saved = await saveContactsToDB(enriched)
      if (saved.failed > 0) {
        showToast(saved.error || `${saved.failed} contact backup(s) failed — check Supabase settings`)
        return
      }

      addContacts(enriched)
      showToast(`${enriched.length} contact(s) added!`)
      setPreviewCards([])
      setActiveScreen('contacts')
    } catch (err) {
      showToast('Cloud save failed: ' + (err as Error).message)
    } finally {
      setIsSavingPreview(false)
    }
  }

  const cancelPreview = () => setPreviewCards([])

  if (isScanning) {
    return <ScanningLoader />
  }

  if (previewCards.length) {
    return (
      <PreviewPanel
        cards={previewCards}
        onAccept={acceptPreview}
        onCancel={cancelPreview}
        isSaving={isSavingPreview}
      />
    )
  }

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <input
        ref={frontInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f, 'front')
          e.target.value = ''
        }}
      />

      <input
        ref={frontFileInputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
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
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f, 'back')
          e.target.value = ''
        }}
      />

      <input
        ref={backFileInputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f, 'back')
          e.target.value = ''
        }}
      />

      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          padding: 22,
          boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 52, lineHeight: 1, marginBottom: 10 }}>📇</div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>Scan Business Cards</h1>
          <p
            style={{
              margin: '10px 0 0',
              color: 'var(--muted)',
              fontSize: 15,
              lineHeight: 1.5,
            }}
          >
            Point your camera at a card.
            <br />
            AI extracts all contacts instantly.
          </p>
        </div>

        <button onClick={() => startScan('front')} style={btnStyle('primary')}>
          Scan Card (Front)
        </button>

        <button onClick={() => startScan('front', 'files')} style={{ ...btnStyle('secondary'), marginTop: 10 }}>
          Choose Better Scan / Files
        </button>

        {contacts.length > 0 && (
          <button
            onClick={() => startScan('back')}
            style={{ ...btnStyle('secondary'), marginTop: 10 }}
          >
            ↩ Scan Back of Last Card
          </button>
        )}

        {contacts.length > 0 && (
          <button
            onClick={() => startScan('back', 'files')}
            style={{ ...btnStyle('secondary'), marginTop: 10 }}
          >
            Choose Back from Files
          </button>
        )}

        <div style={{ marginTop: 12, color: 'var(--muted)', fontSize: 12, lineHeight: 1.45, textAlign: 'center' }}>
          Tip: for iPhone document scan quality, scan in Files first, then use “Choose Better Scan / Files.”
        </div>

        {contacts.length > 0 && (
          <div
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 12,
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 800 }}>{contacts.length}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Total Contacts</div>
          </div>
        )}
      </div>
    </div>
  )
}

function ScanningLoader() {
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 340,
          textAlign: 'center',
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          padding: 24,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 8,
            marginBottom: 16,
          }}
        >
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: 'var(--accent)',
                animation: `cardscan-bounce 0.9s ${delay}ms infinite ease-in-out`,
                display: 'inline-block',
              }}
            />
          ))}
        </div>

        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
          Extracting contacts...
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>
          Gemini AI is reading your card
        </div>

        <style>{`
          @keyframes cardscan-bounce {
            0%, 80%, 100% { transform: scale(0.7); opacity: 0.6; }
            40% { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  )
}

function PreviewPanel({
  cards,
  onAccept,
  onCancel,
  isSaving,
}: {
  cards: Contact[]
  onAccept: () => void
  onCancel: () => void
  isSaving: boolean
}) {
  return (
    <div
      style={{
        minHeight: '100%',
        padding: 18,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 680,
          margin: '0 auto',
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          padding: 18,
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 14 }}>
          Found {cards.length} card{cards.length > 1 ? 's' : ''} ✨
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {cards.map((c, i) => (
            <div
              key={c.id || i}
              style={{
                display: 'grid',
                gridTemplateColumns: c.front_image ? '92px 1fr' : '1fr',
                gap: 12,
                alignItems: 'start',
                padding: 12,
                borderRadius: 14,
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
              }}
            >
              {c.front_image && (
                <img
                  src={`data:image/jpeg;base64,${c.front_image}`}
                  alt={c.name || `Scanned card ${i + 1}`}
                  style={{
                    width: 92,
                    height: 68,
                    objectFit: 'cover',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                  }}
                />
              )}

              <div>
                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
                  {c.name || 'Unknown'}
                </div>

                {(c.title || c.company) && (
                  <div style={{ color: 'var(--muted)', marginBottom: 8 }}>
                    {c.title}
                    {c.company ? (c.title ? ' · ' : '') + c.company : ''}
                  </div>
                )}

                {c.email && <div style={{ marginBottom: 4 }}>✉ {c.email}</div>}
                {c.phone_mobile && <div style={{ marginBottom: 4 }}>{c.phone_mobile}</div>}
                {c.phone_work && <div style={{ marginBottom: 4 }}>{c.phone_work}</div>}

                {c.city && (
                  <div style={{ color: 'var(--muted)' }}>
                    {c.city}
                    {c.state ? ', ' + c.state : ''}
                    {c.zip ? ' ' + c.zip : ''}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            marginTop: 16,
          }}
        >
          <button onClick={onCancel} style={btnStyle('secondary')}>
            Rescan
          </button>

          <button
            onClick={onAccept}
            disabled={isSaving}
            style={{
              ...btnStyle('primary'),
              opacity: isSaving ? 0.65 : 1,
              pointerEvents: isSaving ? 'none' : 'auto',
            }}
          >
            {isSaving ? 'Saving...' : `✓ Add ${cards.length > 1 ? 'All' : 'Contact'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function btnStyle(variant: 'primary' | 'secondary' | 'danger'): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: '13px 18px',
    borderRadius: 10,
    border: 'none',
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer',
    width: '100%',
    transition: '0.18s',
  }

  if (variant === 'primary') {
    return {
      ...base,
      background: 'var(--accent)',
      color: '#fff',
    }
  }

  if (variant === 'danger') {
    return {
      ...base,
      background: 'var(--danger)',
      color: '#fff',
    }
  }

  return {
    ...base,
    background: 'var(--bg3)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
  }
}
