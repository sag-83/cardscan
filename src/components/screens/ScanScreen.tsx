import { useRef, useEffect, useState, lazy, Suspense, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  ContactRound,
  CornerDownLeft,
  Loader2,
  Mail,
  Sparkles,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { AmbientShadowOverlay } from '@/components/ui/ambient-shadow-overlay'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
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
import { demoScannedContact, IS_DEMO_MODE } from '../../lib/demo'
import type { Contact } from '../../types/contact'

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_PDF_BYTES = 6 * 1024 * 1024
const SUPPORTED_SCAN_TYPES = ['application/pdf']

const ENV_GEMINI_KEYS = [
  (import.meta.env.VITE_GEMINI_KEY as string) || (import.meta.env.VITE_GEMINI_API_KEY as string),
  (import.meta.env.VITE_GEMINI_KEY2 as string) || (import.meta.env.VITE_GEMINI_API_KEY2 as string),
  (import.meta.env.VITE_GEMINI_KEY3 as string) || (import.meta.env.VITE_GEMINI_API_KEY3 as string),
].filter(Boolean)

const ScannerCardStreamLazy = lazy(() =>
  import('@/components/ui/scanner-card-stream').then((m) => ({ default: m.ScannerCardStream }))
)

function isSupportedScanFile(file: File): boolean {
  return file.type.startsWith('image/') || SUPPORTED_SCAN_TYPES.includes(file.type)
}

function mostRecentlyAddedContact(contacts: Contact[]): Contact | undefined {
  return contacts.reduce<Contact | undefined>((newest, contact) => {
    if (!newest) return contact
    const contactTime = Date.parse(contact.created_at || contact.scanned_at || '')
    const newestTime = Date.parse(newest.created_at || newest.scanned_at || '')
    return (Number.isFinite(contactTime) ? contactTime : 0) >
      (Number.isFinite(newestTime) ? newestTime : 0)
      ? contact
      : newest
  }, undefined)
}

function scanText(value: string | undefined): string {
  return (value ?? '').toUpperCase().trim()
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
    theme,
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
    theme: s.theme,
  }))

  const geminiKeys = [apiKey, apiKey2, apiKey3, ...ENV_GEMINI_KEYS]
    .map((key) => key?.trim())
    .filter((key, index, allKeys): key is string => Boolean(key) && allKeys.indexOf(key) === index)

  useEffect(() => {
    if (triggerBackScan) {
      setTriggerBackScan(false)
      backInputRef.current?.click()
    }
  }, [triggerBackScan, setTriggerBackScan])

  const startScan = (side: 'front' | 'back', source: 'camera' | 'files' = 'camera') => {
    if (IS_DEMO_MODE) {
      if (side === 'back' && contacts.length) {
        const lastContact = mostRecentlyAddedContact(contacts)
        if (lastContact) {
          updateContact(lastContact.id, {
            back_notes: 'Demo back-side scan: booth number, extra phone, and follow-up notes.',
          })
          showToast('Demo mode: back side notes added')
        }
        return
      }

      setPreviewCards([demoScannedContact()])
      showToast('Demo mode: fake AI scan generated')
      return
    }

    if (!geminiKeys.length) {
      showToast('Set Gemini API key in Settings')
      setActiveScreen('settings')
      return
    }

    if (side === 'back') {
      if (!contacts.length) {
        showToast('Scan a front side first')
        return
      }

      if (!pendingBackId) {
        const lastContact = mostRecentlyAddedContact(contacts)
        if (!lastContact) {
          showToast('Scan a front side first')
          return
        }

        setPendingBackId(lastContact.id)
      }

      ;(source === 'files' ? backFileInputRef : backInputRef).current?.click()
    } else {
      setPendingBackId(null)
      ;(source === 'files' ? frontFileInputRef : frontInputRef).current?.click()
    }
  }

  const handleFile = async (file: File, side: 'front' | 'back') => {
    if (IS_DEMO_MODE) {
      setPreviewCards([demoScannedContact()])
      showToast('Demo mode: file upload simulated')
      return
    }

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

      // Full-quality image stored on the contact (1600px) — also used for OCR
      const scanB64 = isPdf ? b64 : await resizeImage(b64, file.type, 1600)

      // Small thumbnail only for PDF placeholder (PDFs can't render as <img>)
      const thumb = isPdf ? '' : scanB64

      const extracted = await callGemini(scanB64, isPdf ? 'application/pdf' : 'image/jpeg', geminiKeys)

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

          await saveImage(`${pendingBackId}_back`, scanB64).catch(() => {})
          const backUrl = await uploadCardPhoto(pendingBackId, 'back', scanB64)

          const merged: Contact = {
            ...target,
            back_image: scanB64,
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
              merged[f] = scanText(value) as never
            }
          })

          if (bd.email && !merged.email) merged.email = bd.email.toLowerCase().trim()
          if (bd.website && !merged.website) merged.website = bd.website
          if (bd.name && !merged.name) merged.name = scanText(bd.name)
          if (bd.title && !merged.title) merged.title = scanText(bd.title)
          if (bd.company && !merged.company) merged.company = scanText(bd.company)

          if (bd.notes?.trim()) {
            merged.back_notes = [merged.back_notes, scanText(bd.notes)].filter(Boolean).join(' | ')
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
          name: scanText(raw.name),
          title: scanText(raw.title),
          company: scanText(raw.company),
          email: raw.email ?? '',
          phone_mobile: raw.phone_mobile ?? '',
          phone_work: raw.phone_work ?? '',
          phone_fax: raw.phone_fax ?? '',
          website: raw.website ?? '',
          address: scanText(raw.address),
          city: scanText(raw.city),
          state: scanText(raw.state),
          zip: scanText(raw.zip),
          country: scanText(raw.country),
          notes: scanText(raw.notes),
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
      if (IS_DEMO_MODE) {
        addContacts(previewCards)
        showToast(`${previewCards.length} demo contact(s) added locally`)
        setPreviewCards([])
        setActiveScreen('contacts')
        return
      }

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

      let photoUploadFailed = false
      const enriched = await Promise.all(
        uniquePreviewCards.map(async (c) => {
          if (c.front_image) {
            await saveImage(`${c.id}_front`, c.front_image).catch(() => {})
            const url = await uploadCardPhoto(c.id, 'front', c.front_image)
            if (url) return { ...c, front_image_url: url }
            photoUploadFailed = true
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
      showToast(photoUploadFailed
        ? `${enriched.length} contact(s) added! (photo stored locally only — check Supabase storage bucket)`
        : `${enriched.length} contact(s) added!`)
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
    return createPortal(
      <div
        className="fixed inset-0 z-[300] flex flex-col bg-[#050508]"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full min-h-[40vh] flex-1 items-center justify-center bg-[#050508]">
                <Loader2 className="h-10 w-10 animate-spin text-violet-400" aria-hidden />
              </div>
            }
          >
            <ScannerCardStreamLazy repeat={5} initialSpeed={120} friction={0.97} />
          </Suspense>
        </div>
        <div
          className="pointer-events-none shrink-0 px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 text-center"
          style={{ paddingBottom: 'calc(88px + env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto max-w-sm rounded-2xl border border-white/10 bg-black/45 px-5 py-4 text-white shadow-lg backdrop-blur-md">
            <div className="text-lg font-extrabold tracking-tight">Extracting contacts…</div>
            <div className="mt-1 text-sm text-white/70">Gemini AI is reading your card</div>
          </div>
        </div>
      </div>,
      document.body
    )
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
      className="relative"
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 -z-0 overflow-hidden rounded-[20px] opacity-[0.92] sm:rounded-[24px]"
        aria-hidden
      >
        <AmbientShadowOverlay
          color={
            theme === 'dark' ? 'rgba(10, 132, 255, 0.14)' : 'rgba(0, 122, 255, 0.11)'
          }
          animation={{ scale: 42, speed: 58 }}
          noise={{ opacity: 0.22, scale: 1 }}
        />
      </div>

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

      <Card className="relative z-10 w-full max-w-[460px] border-b1 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <CardHeader className="pb-2 text-center">
          <div className="mx-auto mb-2 flex h-[52px] items-center justify-center text-[var(--accent)]">
            <ContactRound className="h-12 w-12" strokeWidth={1.75} aria-hidden />
          </div>
          <CardTitle className="text-[28px] font-extrabold leading-tight">Scan Business Cards</CardTitle>
          <CardDescription className="text-base leading-relaxed text-tx3">
            Point your camera at a card.
            <br />
            AI extracts all contacts instantly.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5 px-[22px] pb-2 pt-0">
          <Button
            type="button"
            className="h-12 w-full rounded-[10px] border-0 bg-[var(--accent)] text-[15px] font-bold text-white shadow-none hover:bg-[var(--accent)]/90"
            onClick={() => startScan('front')}
          >
            Scan Card (Front)
          </Button>

          <Button
            type="button"
            variant="outline"
            className="h-12 w-full rounded-[10px] border-b1 bg-bg3 text-[15px] font-bold text-tx1 shadow-none hover:bg-bg4"
            onClick={() => startScan('front', 'files')}
          >
            Choose Better Scan / Files
          </Button>

          {contacts.length > 0 && (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-[10px] border-b1 bg-bg3 text-[15px] font-bold text-tx1 shadow-none hover:bg-bg4"
              onClick={() => startScan('back')}
            >
              <CornerDownLeft className="size-4 shrink-0" aria-hidden />
              Scan Back of Last Card
            </Button>
          )}

          {contacts.length > 0 && (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-[10px] border-b1 bg-bg3 text-[15px] font-bold text-tx1 shadow-none hover:bg-bg4"
              onClick={() => startScan('back', 'files')}
            >
              Choose Back from Files
            </Button>
          )}

          <p className="mt-1 text-center text-xs leading-snug text-tx3">
            Tip: for iPhone document scan quality, scan in Files first, then use “Choose Better Scan / Files.”
          </p>
        </CardContent>

        {contacts.length > 0 && (
          <CardFooter className="flex flex-col gap-0 border-t-0 bg-transparent px-[22px] pb-[22px] pt-0">
            <div className="w-full rounded-xl border border-b1 bg-bg3 py-3.5 text-center">
              <div className="text-2xl font-extrabold">{contacts.length}</div>
              <div className="text-[13px] text-tx3">Total Contacts</div>
            </div>
          </CardFooter>
        )}
      </Card>
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
    <div className="min-h-full p-[18px]">
      <Card className="mx-auto w-full max-w-[680px] border-b1">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-[22px] font-extrabold">
            <Sparkles className="size-6 shrink-0 text-[var(--star)]" aria-hidden />
            Found {cards.length} card{cards.length > 1 ? 's' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 px-[18px]">
          {cards.map((c, i) => (
            <div
              key={c.id || i}
              className="grid items-start gap-3 rounded-[14px] border border-b1 bg-bg3 p-3"
              style={{
                gridTemplateColumns: c.front_image ? '92px 1fr' : '1fr',
              }}
            >
              {c.front_image && (
                <img
                  src={`data:image/jpeg;base64,${c.front_image}`}
                  alt={c.name || `Scanned card ${i + 1}`}
                  className="h-[68px] w-[92px] rounded-[10px] border border-b1 object-cover"
                />
              )}

              <div>
                <div className="mb-1 text-lg font-extrabold">{c.name || 'Unknown'}</div>

                {(c.title || c.company) && (
                  <div className="mb-2 text-tx3">
                    {c.title}
                    {c.company ? (c.title ? ' · ' : '') + c.company : ''}
                  </div>
                )}

                {c.email && (
                  <div className="mb-1 flex items-center gap-2">
                    <Mail className="size-3.5 shrink-0 text-[var(--accent)]" aria-hidden />
                    {c.email}
                  </div>
                )}
                {c.phone_mobile && <div className="mb-1">{c.phone_mobile}</div>}
                {c.phone_work && <div className="mb-1">{c.phone_work}</div>}

                {c.city && (
                  <div className="text-tx3">
                    {c.city}
                    {c.state ? ', ' + c.state : ''}
                    {c.zip ? ' ' + c.zip : ''}
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
        <CardFooter className="grid grid-cols-2 gap-2.5 border-t-0 px-[18px] pb-[18px] pt-2">
          <Button
            type="button"
            variant="outline"
            className="h-12 rounded-[10px] border-b1 bg-bg3 text-[15px] font-bold"
            onClick={onCancel}
          >
            Rescan
          </Button>

          <Button
            type="button"
            disabled={isSaving}
            className="h-12 rounded-[10px] border-0 bg-[var(--accent)] text-[15px] font-bold text-white hover:bg-[var(--accent)]/90 disabled:opacity-65"
            onClick={onAccept}
          >
            {isSaving ? (
              'Saving...'
            ) : (
              <>
                <Check className="size-4 shrink-0" aria-hidden />
                Add {cards.length > 1 ? 'All' : 'Contact'}
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
