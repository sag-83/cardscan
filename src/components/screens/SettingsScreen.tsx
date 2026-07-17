import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  Camera,
  Check,
  MapPin,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudOff,
  Download,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Moon,
  RefreshCw,
  Shield,
  Sun,
  Undo2,
  Upload,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useTheme } from '../../hooks/useTheme'
import {
  initSupabase,
  testSupabaseConnection,
  saveContactsToDB,
  SUPABASE_SCHEMA_SQL,
  syncInvoicesFromDB,
  uploadCardPhoto,
} from '../../lib/supabase'
import { resizeImage } from '../../lib/gemini'
import { loadImages, saveImage } from '../../lib/imageStore'
import {
  pruneOrphanInvoicesFromDB,
  reconcileInvoiceDeletions,
  saveInvoiceSynced,
} from '../../lib/invoiceSync'
import { pullAndMergeFromCloud } from '../../lib/cloudSync'
import { backupToJSON, restoreFromJSON } from '../../lib/export'
import { dedupeContacts, normalizeContact, deriveInstagramFromNotes } from '../../lib/utils'
import { deriveSocialMediaFromNotes } from '../../lib/socialPlatforms'
import { DEMO_CONTACTS, IS_DEMO_MODE } from '../../lib/demo'
import { Contact } from '../../types/contact'
import {
  enableReminderPush,
  getReminderPushStatus,
  isReminderPushEnabled,
  sendTestReminderNotification,
  setReminderPushEnabled,
  supportsReminderPush,
  syncFollowupReminders,
} from '../../lib/reminderNotifications'
import {
  enableLocationAccess,
  isLocationAccessEnabled,
  queryGeolocationPermission,
  setLocationAccessEnabled,
  supportsLocationAccess,
} from '../../lib/locationAccess'
import { getLocationBlockedHelp, isStandalonePwa } from '../../lib/pwa'
import { canToggleAuthenticator, isAppPinConfigured } from '../../lib/appAuth'
import { isAuthenticatorEnabled, setAuthenticatorEnabled } from '../../lib/authenticatorPreference'
import { isTotpRequired } from '../../lib/totp'

const NORMALIZE_BACKUP_KEY = 'cs_normalize_backup_v1'

type NormalizeBackup = {
  createdAt: string
  contacts: Contact[]
}

const ENV_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const ENV_SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export function SettingsScreen() {
  const restoreInputRef = useRef<HTMLInputElement>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [isBackfillingThumbs, setIsBackfillingThumbs] = useState(false)
  const [isBackingUpPhotos, setIsBackingUpPhotos] = useState(false)
  const { theme, setTheme } = useTheme()

  const {
    apiKey, setApiKey,
    apiKey2, setApiKey2,
    apiKey3, setApiKey3,
    sbUrl, setSbUrl,
    sbKey, setSbKey,
    sheetsWebhook, setSheetsWebhook,
    invoiceSheetsWebhook, setInvoiceSheetsWebhook,
    contacts, setContacts,
    invoices, setInvoices,
    deleteContact, deleteInvoice,
    showToast,
  } = useStore((s) => ({
    apiKey: s.apiKey,
    setApiKey: s.setApiKey,
    apiKey2: s.apiKey2,
    setApiKey2: s.setApiKey2,
    apiKey3: s.apiKey3,
    setApiKey3: s.setApiKey3,
    sbUrl: s.sbUrl,
    setSbUrl: s.setSbUrl,
    sbKey: s.sbKey,
    setSbKey: s.setSbKey,
    sheetsWebhook: s.sheetsWebhook,
    setSheetsWebhook: s.setSheetsWebhook,
    invoiceSheetsWebhook: s.invoiceSheetsWebhook,
    setInvoiceSheetsWebhook: s.setInvoiceSheetsWebhook,
    contacts: s.contacts,
    setContacts: s.setContacts,
    invoices: s.invoices,
    setInvoices: s.setInvoices,
    deleteContact: s.deleteContact,
    deleteInvoice: s.deleteInvoice,
    showToast: s.showToast,
  }))

  const handleSBChange = (url: string, key: string) => {
    setSbUrl(url); setSbKey(key); initSupabase(url, key)
  }

  const handleTestSB = async () => {
    if (IS_DEMO_MODE) {
      showToast('Demo mode: Supabase is disabled')
      return
    }

    try {
      initSupabase(ENV_SUPABASE_URL || sbUrl, ENV_SUPABASE_ANON_KEY || sbKey)
      await testSupabaseConnection()
      showToast('Supabase connected!')
    }
    catch (err) { showToast('Error: ' + (err as Error).message) }
  }

  const handleBackupToSupabase = async (force = false) => {
    if (IS_DEMO_MODE) {
      showToast('Demo mode: Supabase is disabled')
      return
    }
    if (!contacts.length && !invoices.length) {
      showToast('Nothing to back up')
      return
    }
    initSupabase(ENV_SUPABASE_URL || sbUrl, ENV_SUPABASE_ANON_KEY || sbKey)
    showToast(`Backing up ${contacts.length} contacts + ${invoices.length} invoices…`)
    try {
      const [contactResult, invoiceResults] = await Promise.all([
        contacts.length
          ? saveContactsToDB(contacts, { skipDedupe: force })
          : Promise.resolve({ ok: 0, merged: 0, failed: 0 }),
        Promise.allSettled(invoices.map((inv) => saveInvoiceSynced(inv))),
      ])

      const invOk = invoiceResults.filter((r) => r.status === 'fulfilled' && r.value).length
      const invFailed = invoices.length - invOk

      const pruned = await pruneOrphanInvoicesFromDB(invoices.map((i) => i.id))
      const cloudAfter = await syncInvoicesFromDB()
      const reconciled = await reconcileInvoiceDeletions(cloudAfter.map((i) => i.id))

      const parts = [`${contactResult.ok} contacts`]
      if (!force && contactResult.merged > 0) parts.push(`${contactResult.merged} merged`)
      if (contactResult.failed > 0) parts.push(`${contactResult.failed} contacts failed`)
      parts.push(`${invOk} invoices`)
      if (invFailed > 0) parts.push(`${invFailed} invoices failed`)
      if (reconciled > 0) parts.push(`${reconciled} pending deletes cleared`)
      if (pruned > 0) parts.push(`${pruned} removed from cloud`)
      showToast(parts.join(', ') + (force ? ' (force)' : ''))
    } catch (err) {
      showToast('Backup failed: ' + (err as Error).message)
    }
  }

  const handleClearAll = () => {
    if (!confirm('Clear contacts from this phone/browser only? Supabase backup will stay saved.')) return
    setContacts([]); showToast('Local contacts cleared. Use Sync now from Supabase to bring them back.')
  }

  const handleRestoreFromSupabase = async () => {
    if (IS_DEMO_MODE) {
      setContacts(DEMO_CONTACTS)
      showToast('Demo mode: sample contacts restored')
      return
    }

    try {
      initSupabase(ENV_SUPABASE_URL || sbUrl, ENV_SUPABASE_ANON_KEY || sbKey)
      const { contacts: n, invoices: inv } = await pullAndMergeFromCloud({
        getContacts: () => contacts,
        setContacts,
        getInvoices: () => invoices,
        setInvoices,
        deleteContact,
        deleteInvoice,
      })

      if (!n && !inv) {
        showToast('No cloud data found')
        return
      }

      showToast(`Synced ${n} contact(s) + ${inv} invoice(s) from cloud`)
    } catch (err) {
      showToast('Cloud sync failed: ' + (err as Error).message)
    }
  }

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const { contacts: restored, count } = restoreFromJSON(reader.result as string)
        const merged = dedupeContacts([...restored, ...contacts])
        const added = Math.max(0, merged.length - contacts.length)
        setContacts(merged)
        showToast(`Restored ${added} of ${count} contacts`)
      } catch { showToast('Invalid backup file') }
    }
    reader.readAsText(file); e.target.value = ''
  }

  const handleNormalizeNow = () => {
    if (!contacts.length) {
      showToast('No contacts to normalize')
      return
    }
    // Safety net: keep exact pre-normalized data for one-tap restore.
    const backup: NormalizeBackup = {
      createdAt: new Date().toISOString(),
      contacts,
    }
    localStorage.setItem(NORMALIZE_BACKUP_KEY, JSON.stringify(backup))

    const normalized = dedupeContacts(contacts.map((contact) => normalizeContact(contact)))
    const removed = contacts.length - normalized.length
    setContacts(normalized)
    showToast(
      removed > 0
        ? `Normalized to ALL CAPS and removed ${removed} duplicate entr${removed === 1 ? 'y' : 'ies'}`
        : 'Normalized to ALL CAPS (no duplicates removed)'
    )
  }

  const handleUndoNormalize = () => {
    const raw = localStorage.getItem(NORMALIZE_BACKUP_KEY)
    if (!raw) {
      showToast('No normalize backup found')
      return
    }
    try {
      const parsed = JSON.parse(raw) as NormalizeBackup
      if (!parsed || !Array.isArray(parsed.contacts)) {
        showToast('Normalize backup is invalid')
        return
      }
      setContacts(parsed.contacts)
      showToast(`Restored pre-normalize backup (${parsed.contacts.length} contacts)`)
    } catch {
      showToast('Could not restore normalize backup')
    }
  }

  const handleRefreshApp = () => {
    window.location.replace(`${window.location.pathname}?v=${Date.now()}`)
  }

  const handleBackfillSocialMedia = async () => {
    if (!contacts.length) {
      showToast('No contacts to scan')
      return
    }

    const updated = contacts.map((contact) => {
      const instagram = contact.instagram || deriveInstagramFromNotes(contact)
      const foundSocial = deriveSocialMediaFromNotes(contact)
      const social_media = { ...foundSocial, ...contact.social_media }
      return { ...contact, instagram, social_media }
    })

    const changed = updated.filter((contact, i) => (
      contact.instagram !== contacts[i].instagram ||
      JSON.stringify(contact.social_media) !== JSON.stringify(contacts[i].social_media)
    ))
    if (!changed.length) {
      showToast('No social media handles found in existing notes')
      return
    }

    setContacts(updated)

    if (IS_DEMO_MODE) {
      showToast(`Found social media for ${changed.length} contact(s) (demo mode: not saved to cloud)`)
      return
    }

    showToast(`Found social media for ${changed.length} contact(s), saving to cloud…`)
    const result = await saveContactsToDB(changed, { skipDedupe: true })
    showToast(`Social media backfill: ${result.ok + result.merged} saved${result.failed ? `, ${result.failed} failed` : ''}`)
  }

  const handleBackfillThumbnails = async () => {
    if (isBackfillingThumbs) return
    if (IS_DEMO_MODE) {
      showToast('Demo mode: thumbnails are not generated')
      return
    }

    const missing = contacts.filter((c) => c.front_image_url && !c.front_thumb_url)
    if (!missing.length) {
      showToast('Every contact already has a thumbnail')
      return
    }

    setIsBackfillingThumbs(true)
    showToast(`Generating thumbnails for ${missing.length} contact(s)… this can take a while`)

    let succeeded = 0
    let fromCache = 0
    let failed = 0
    const thumbUrls: Record<string, string> = {}
    const BATCH_SIZE = 6

    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE)
      await Promise.all(batch.map(async (contact) => {
        try {
          // Try this device's local IndexedDB cache first — it's saved at
          // scan time and never deleted, so it's often still there even when
          // Supabase Storage can't be reached, and skips a network fetch too.
          const cacheKey = `${contact.id}_front`
          const cached = (await loadImages([cacheKey]))[cacheKey]
          let fullB64 = cached
          if (fullB64) {
            fromCache += 1
          } else {
            const res = await fetch(contact.front_image_url)
            if (!res.ok) throw new Error('fetch failed')
            const blob = await res.blob()
            fullB64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve((reader.result as string).split(',')[1])
              reader.onerror = () => reject(new Error('read failed'))
              reader.readAsDataURL(blob)
            })
          }
          const thumbB64 = await resizeImage(fullB64, 'image/jpeg', 280, 0.6)
          const thumbUrl = await uploadCardPhoto(contact.id, 'front', thumbB64, 'image/jpeg', 'thumb')
          if (!thumbUrl) throw new Error('upload failed')
          thumbUrls[contact.id] = thumbUrl
          succeeded += 1
        } catch {
          failed += 1
        }
      }))
    }

    if (succeeded > 0) {
      const nextContacts = contacts.map((c) => (thumbUrls[c.id] ? { ...c, front_thumb_url: thumbUrls[c.id] } : c))
      setContacts(nextContacts)
      await saveContactsToDB(nextContacts.filter((c) => thumbUrls[c.id]), { skipDedupe: true })
    }

    setIsBackfillingThumbs(false)
    showToast(
      `Thumbnails: ${succeeded} generated` +
      (fromCache ? ` (${fromCache} from this device's local cache)` : '') +
      (failed ? `, ${failed} failed (Supabase Storage may still be restricted — try again later)` : '')
    )
  }

  // One-time sweep that pulls every contact's photos onto this device's
  // IndexedDB cache, independent of Supabase. Ongoing per-scan caching
  // already happens automatically (saveImage is called at scan time) — this
  // only needs to run to catch up contacts scanned before that existed, or
  // to re-check after Supabase Storage access comes back.
  const handleBackupAllPhotosLocally = async () => {
    if (isBackingUpPhotos) return
    if (IS_DEMO_MODE) {
      showToast('Demo mode: nothing to back up locally')
      return
    }

    setIsBackingUpPhotos(true)
    showToast("Checking this device's local photo cache…")

    const allKeys: string[] = []
    contacts.forEach((c) => {
      if (c.front_image_url) allKeys.push(`${c.id}_front`)
      if (c.back_image_url) allKeys.push(`${c.id}_back`)
    })
    const alreadyCached = await loadImages(allKeys)

    const jobs: { key: string; url: string }[] = []
    contacts.forEach((c) => {
      if (c.front_image_url && !alreadyCached[`${c.id}_front`]) {
        jobs.push({ key: `${c.id}_front`, url: c.front_image_url })
      }
      if (c.back_image_url && !alreadyCached[`${c.id}_back`]) {
        jobs.push({ key: `${c.id}_back`, url: c.back_image_url })
      }
    })

    const alreadyCount = allKeys.length - jobs.length

    if (!jobs.length) {
      setIsBackingUpPhotos(false)
      showToast(`All ${alreadyCount} photo(s) already backed up on this device`)
      return
    }

    showToast(`Backing up ${jobs.length} photo(s) to this device… this can take a while`)

    let succeeded = 0
    let failed = 0
    const BATCH_SIZE = 8

    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
      const batch = jobs.slice(i, i + BATCH_SIZE)
      await Promise.all(batch.map(async (job) => {
        try {
          const res = await fetch(job.url)
          if (!res.ok) throw new Error('fetch failed')
          const blob = await res.blob()
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve((reader.result as string).split(',')[1])
            reader.onerror = () => reject(new Error('read failed'))
            reader.readAsDataURL(blob)
          })
          await saveImage(job.key, base64)
          succeeded += 1
        } catch {
          failed += 1
        }
      }))
    }

    setIsBackingUpPhotos(false)
    showToast(
      `Local backup: ${succeeded} photo(s) saved to this device` +
      (alreadyCount ? `, ${alreadyCount} already had a copy` : '') +
      (failed ? `, ${failed} failed (Supabase Storage may still be restricted — try again later)` : '')
    )
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: '16px 16px 0', fontSize: 22, fontWeight: 800 }}>Settings</div>

      {/* Supabase */}
      <SectionTitle>Cloud Sync</SectionTitle>
      <div style={{ padding: '0 16px 8px', fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
        Syncs automatically across devices (~30s). Use buttons below only if data looks missing.
      </div>
      <SettingsGroup>
        <div onClick={() => handleBackupToSupabase()} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>Force backup to Supabase</div>
          <div style={{ color: 'var(--accent)', display: 'flex' }}><Cloud size={18} strokeWidth={2} aria-hidden /></div>
        </div>
        <Divider />
        <div onClick={handleRestoreFromSupabase} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>Sync now from Supabase</div>
          <div style={{ color: 'var(--accent)', display: 'flex' }}><Cloud size={18} strokeWidth={2} aria-hidden /></div>
        </div>
      </SettingsGroup>

      {/* Google Sheets */}
      <SectionTitle>Google Sheets Webhook</SectionTitle>
      <SettingsGroup>
        <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          <label style={labelStyle}>Apps Script Web App URL</label>
          <input
            type="url"
            value={sheetsWebhook}
            onChange={(e) => setSheetsWebhook(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
            style={inputStyle}
          />
          <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
            Deploy a Google Apps Script as a web app and paste its URL here.
            The script receives a JSON array of contacts via POST.
          </div>
        </div>
      </SettingsGroup>

      {/* Invoice Sheets */}
      <SectionTitle>Invoice Sheets Webhook</SectionTitle>
      <SettingsGroup>
        <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          <label style={labelStyle}>Invoice Apps Script Web App URL</label>
          <input
            type="url"
            value={invoiceSheetsWebhook}
            onChange={(e) => setInvoiceSheetsWebhook(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
            style={inputStyle}
          />
          <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
            Separate Google Sheet for invoice ledger. Every PDF you generate is logged here automatically.
          </div>
        </div>
      </SettingsGroup>

      {/* Location for Near Me */}
      <SectionTitle>Near Me (Location)</SectionTitle>
      <SettingsGroup>
        <LocationAccessPanel showToast={showToast} />
      </SettingsGroup>

      {/* Reminder push */}
      <SectionTitle>Reminder Notifications</SectionTitle>
      <SettingsGroup>
        <ReminderNotificationsPanel contacts={contacts} showToast={showToast} />
      </SettingsGroup>

      {/* Security */}
      {canToggleAuthenticator() && (
        <>
          <SectionTitle>Security</SectionTitle>
          <SettingsGroup>
            <AuthenticatorTogglePanel showToast={showToast} />
          </SettingsGroup>
        </>
      )}

      {/* Theme */}
      <SectionTitle>Appearance</SectionTitle>
      <SettingsGroup>
        <div style={rowStyle}>
          <div style={{ flex: 1, fontSize: 15 }}>Theme</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                style={{
                  padding: '5px 13px', borderRadius: 99, cursor: 'pointer',
                  fontSize: 12, fontWeight: 700, transition: '0.18s',
                  border: `1.5px solid ${theme === t ? 'var(--accent)' : 'var(--border)'}`,
                  background: theme === t ? 'rgba(0,122,255,0.1)' : 'var(--bg3)',
                  color: theme === t ? 'var(--accent)' : 'var(--text3)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {t === 'light' ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
                {t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
      </SettingsGroup>

      {/* Data */}
      <SectionTitle>Data</SectionTitle>
      <SettingsGroup>
        <div onClick={() => backupToJSON(contacts)} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>Backup Contacts (JSON)</div>
          <div style={{ color: 'var(--accent)', display: 'flex' }}><Download size={18} strokeWidth={2} aria-hidden /></div>
        </div>
        <Divider />
        <div onClick={handleRefreshApp} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>Refresh to Latest Version</div>
          <div style={{ color: 'var(--accent)', display: 'flex' }}><RefreshCw size={18} strokeWidth={2} aria-hidden /></div>
        </div>
        <Divider />
        <div onClick={handleNormalizeNow} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>Normalize Existing Data Now (ALL CAPS + dedupe + fix state names)</div>
          <div style={{ color: '#34c759', display: 'flex' }}><Check size={18} strokeWidth={2} aria-hidden /></div>
        </div>
        <Divider />
        <div onClick={handleUndoNormalize} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>Undo Last Normalize (restore backup)</div>
          <div style={{ color: '#ff9500', display: 'flex' }}><Undo2 size={18} strokeWidth={2} aria-hidden /></div>
        </div>
        <Divider />
        <div onClick={handleBackfillSocialMedia} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>
            Find Social Media in Existing Notes
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              One-time: scans old contacts' notes for Instagram, Facebook, TikTok, and Pinterest handles. Safe to run more than once.
            </div>
          </div>
          <div style={{ color: 'var(--action-instagram-fg)', display: 'flex' }}><Camera size={18} strokeWidth={2} aria-hidden /></div>
        </div>
        <Divider />
        <div onClick={handleBackfillThumbnails} style={{ ...rowStyle, cursor: isBackfillingThumbs ? 'default' : 'pointer', opacity: isBackfillingThumbs ? 0.65 : 1 }}>
          <div style={{ flex: 1, fontSize: 15 }}>
            {isBackfillingThumbs ? 'Generating Thumbnails…' : 'Generate Photo Thumbnails'}
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              One-time: creates a small, fast-loading copy of each card photo so the contact list uses far less data. Safe to run more than once — needs Supabase Storage to be reachable.
            </div>
          </div>
          <div style={{ color: 'var(--accent)', display: 'flex' }}>
            {isBackfillingThumbs ? <Loader2 size={18} strokeWidth={2} className="animate-spin" aria-hidden /> : <ImageIcon size={18} strokeWidth={2} aria-hidden />}
          </div>
        </div>
        <Divider />
        <div onClick={handleBackupAllPhotosLocally} style={{ ...rowStyle, cursor: isBackingUpPhotos ? 'default' : 'pointer', opacity: isBackingUpPhotos ? 0.65 : 1 }}>
          <div style={{ flex: 1, fontSize: 15 }}>
            {isBackingUpPhotos ? 'Backing Up Photos to This Device…' : 'Backup All Photos to This Device'}
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              Saves every contact's photos to this phone's storage, independent of Supabase. New scans are cached here automatically — run this to catch up older contacts. Safe to run more than once.
            </div>
          </div>
          <div style={{ color: '#34c759', display: 'flex' }}>
            {isBackingUpPhotos ? <Loader2 size={18} strokeWidth={2} className="animate-spin" aria-hidden /> : <HardDrive size={18} strokeWidth={2} aria-hidden />}
          </div>
        </div>
        <Divider />
        <div onClick={() => restoreInputRef.current?.click()} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>Restore from File</div>
          <div style={{ color: 'var(--accent)', display: 'flex' }}><Upload size={18} strokeWidth={2} aria-hidden /></div>
        </div>
      </SettingsGroup>

      <SectionTitle>Advanced</SectionTitle>
      <SettingsGroup>
        <div onClick={() => setShowAdvanced((v) => !v)} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>{showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}</div>
          <div style={{ color: 'var(--text3)', display: 'flex' }}>{showAdvanced ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}</div>
        </div>
      </SettingsGroup>

      {showAdvanced && (
        <>
          <SectionTitle>Advanced Setup</SectionTitle>
          <SettingsGroup>
            <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              <label style={labelStyle}>Supabase Project URL</label>
              <input type="url" value={sbUrl} onChange={(e) => handleSBChange(e.target.value, sbKey)}
                placeholder="https://xxxx.supabase.co" style={inputStyle} />
            </div>
            <Divider />
            <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              <label style={labelStyle}>Supabase Anon Key</label>
              <input type="password" value={sbKey} onChange={(e) => handleSBChange(sbUrl, e.target.value)}
                placeholder="eyJ..." style={inputStyle} />
            </div>
            <Divider />
            <div onClick={handleTestSB} style={{ ...rowStyle, cursor: 'pointer' }}>
              <div style={{ flex: 1, color: 'var(--accent)', fontWeight: 600, fontSize: 15 }}>Test Supabase Connection</div>
            </div>
            <Divider />
            <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              <label style={labelStyle}>Primary Gemini API Key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIza..." style={inputStyle} />
            </div>
            <Divider />
            <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              <label style={labelStyle}>Backup Gemini Key 2</label>
              <input type="password" value={apiKey2} onChange={(e) => setApiKey2(e.target.value)}
                placeholder="AIza... (second key)" style={inputStyle} />
            </div>
            <Divider />
            <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              <label style={labelStyle}>Backup Gemini Key 3</label>
              <input type="password" value={apiKey3} onChange={(e) => setApiKey3(e.target.value)}
                placeholder="AIza... (third key)" style={inputStyle} />
            </div>
            <Divider />
            <div onClick={() => handleBackupToSupabase(true)} style={{ ...rowStyle, cursor: 'pointer' }}>
              <div style={{ flex: 1, fontSize: 15 }}>Force Backup (save all, skip dedup)</div>
              <div style={{ color: '#ff9500', display: 'flex' }}><CloudOff size={18} strokeWidth={2} aria-hidden /></div>
            </div>
            <Divider />
            <div onClick={handleClearAll} style={{ ...rowStyle, cursor: 'pointer' }}>
              <div style={{ flex: 1, fontSize: 15, color: 'var(--danger)' }}>Clear Local Data</div>
            </div>
            <Divider />
            <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <label style={labelStyle}>Supabase SQL (run once)</label>
              <pre style={{ fontSize: 10, background: 'var(--bg3)', padding: 10, borderRadius: 8,
                width: '100%', fontFamily: 'monospace', lineHeight: 1.75,
                color: 'var(--text2)', overflowX: 'auto', whiteSpace: 'pre' }}>
                {SUPABASE_SCHEMA_SQL}
              </pre>
            </div>
          </SettingsGroup>
        </>
      )}

      <input ref={restoreInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleRestore} />
    </div>
  )
}

function AuthenticatorTogglePanel({ showToast }: { showToast: (msg: string, durationMs?: number) => void }) {
  const [enabled, setEnabled] = useState(() => isAuthenticatorEnabled())
  const revenueAlsoUsesPin = isTotpRequired('revenue')

  const statusLine = enabled
    ? 'Sign-in uses Microsoft Authenticator + Face ID'
    : 'Sign-in uses PIN + Face ID'

  return (
    <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <Shield size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} aria-hidden />
        <div style={{ flex: 1, fontSize: 15 }}>Microsoft Authenticator</div>
        <button
          type="button"
          onClick={() => {
            const next = !enabled
            if (!next && !isAppPinConfigured()) {
              showToast('Add VITE_APP_PIN in Vercel to enable PIN mode', 6000)
              return
            }
            setAuthenticatorEnabled(next)
            setEnabled(next)
            showToast(
              next
                ? 'Authenticator on — sign in again with your 6-digit code'
                : 'Authenticator off — sign in again with your PIN',
              6000,
            )
          }}
          style={{
            padding: '5px 13px',
            borderRadius: 99,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
            border: `1.5px solid ${enabled ? 'var(--accent)' : 'var(--border)'}`,
            background: enabled ? 'rgba(0,122,255,0.1)' : 'var(--bg3)',
            color: enabled ? 'var(--accent)' : 'var(--text3)',
          }}
        >
          {enabled ? 'On' : 'Off'}
        </button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>
        {statusLine}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
        Toggle off to use your PIN instead of the authenticator app.
        {revenueAlsoUsesPin ? ' Revenue unlock follows the same setting.' : ''}
        {!isAppPinConfigured() ? ' Add VITE_APP_PIN in Vercel to enable PIN mode.' : ''}
        {' '}You will be signed out when you change this.
      </div>
    </div>
  )
}

function LocationAccessPanel({ showToast }: { showToast: (msg: string, durationMs?: number) => void }) {
  const [enabled, setEnabled] = useState(() => isLocationAccessEnabled())
  const [permission, setPermission] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown')
  const needsHomeScreen = !isStandalonePwa() && /iPad|iPhone|iPod/i.test(navigator.userAgent)
  const blocked = permission === 'denied'
  const ready = enabled && !blocked

  useEffect(() => {
    void queryGeolocationPermission().then(setPermission)
  }, [enabled])

  const statusLine = !supportsLocationAccess()
    ? 'Not supported in this browser'
    : needsHomeScreen
      ? 'Add to Home Screen first — Enable will not show a popup in Safari'
      : blocked
        ? 'Blocked — follow reset steps below (no popup until reset)'
        : ready
          ? 'Location allowed — Near Me is ready'
          : 'Tap Enable — iPhone should ask Allow (once)'

  return (
    <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <MapPin size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} aria-hidden />
        <div style={{ flex: 1, fontSize: 15 }}>Location access</div>
        <button
          type="button"
          onClick={async () => {
            if (!supportsLocationAccess()) {
              showToast('Location not supported on this device')
              return
            }
            if (ready) {
              setLocationAccessEnabled(false)
              setEnabled(false)
              showToast('Location access off')
              return
            }
            const result = await enableLocationAccess()
            const perm = await queryGeolocationPermission()
            setPermission(perm)
            if (result === 'granted') {
              setEnabled(true)
              showToast('Location on — use Near Me on Contacts')
            } else if (result === 'need-standalone') {
              showToast('Safari → Share → Add to Home Screen, then open that icon and tap Enable', 10_000)
            } else if (result === 'blocked' || result === 'denied') {
              showToast(getLocationBlockedHelp(), 16_000)
            } else if (result === 'timeout') {
              showToast('Timed out — try outdoors or with Wi‑Fi, then Enable again', 6000)
            } else {
              showToast('Location not supported')
            }
          }}
          style={{
            padding: '5px 13px',
            borderRadius: 99,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
            border: `1.5px solid ${ready ? 'var(--accent)' : 'var(--border)'}`,
            background: ready ? 'rgba(0,122,255,0.1)' : 'var(--bg3)',
            color: ready ? 'var(--accent)' : 'var(--text3)',
          }}
        >
          {ready ? 'On' : 'Enable'}
        </button>
      </div>

      <div style={{ fontSize: 12, color: blocked ? '#ff9500' : ready ? 'var(--accent)' : 'var(--text3)', fontWeight: 600 }}>
        {statusLine}
      </div>

      {needsHomeScreen && (
        <div style={{ fontSize: 11, color: '#ff9500', lineHeight: 1.5, fontWeight: 600 }}>
          Open from your Home Screen icon, not the Safari tab. Location Enable does not show a popup inside Safari.
        </div>
      )}

      {blocked && (
        <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
          {getLocationBlockedHelp()}
        </div>
      )}

      {!blocked && !needsHomeScreen && (
        <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
          Tap Enable once. If iPhone asks, tap Allow. If nothing appears, location was blocked earlier — reset steps show above.
        </div>
      )}
    </div>
  )
}

function ReminderNotificationsPanel({ contacts, showToast }: {
  contacts: Contact[]
  showToast: (msg: string) => void
}) {
  const status = getReminderPushStatus(contacts)
  const ready = status.enabled && status.permission === 'granted'

  const statusLine = !status.supported
    ? 'Not supported in this browser'
    : status.permission === 'denied'
      ? 'Blocked — allow in iPhone Settings → Notifications → CardScan'
      : status.permission === 'default'
        ? 'Tap Enable and choose Allow'
        : ready
          ? `${status.scheduledCount} upcoming reminder(s) scheduled`
          : 'Enabled but waiting for permission'

  return (
    <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <Bell size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} aria-hidden />
        <div style={{ flex: 1, fontSize: 15 }}>Push reminders</div>
        <button
          type="button"
          onClick={async () => {
            if (!supportsReminderPush()) {
              showToast('Notifications not supported in this browser')
              return
            }
            if (ready) {
              setReminderPushEnabled(false)
              showToast('Reminder notifications off')
              return
            }
            const result = await enableReminderPush(contacts)
            if (result === 'granted') showToast('On — you’ll get one alert per follow-up at its due time')
            else if (result === 'denied') showToast('Allow notifications in iPhone Settings')
            else showToast('Notifications not supported')
          }}
          style={{
            padding: '5px 13px', borderRadius: 99, cursor: 'pointer',
            fontSize: 12, fontWeight: 700,
            border: `1.5px solid ${ready ? 'var(--accent)' : 'var(--border)'}`,
            background: ready ? 'rgba(0,122,255,0.1)' : 'var(--bg3)',
            color: ready ? 'var(--accent)' : 'var(--text3)',
          }}
        >
          {ready ? 'On' : 'Enable'}
        </button>
      </div>

      <div style={{ fontSize: 12, color: ready ? 'var(--accent)' : 'var(--text3)', fontWeight: 600 }}>
        {statusLine}
      </div>

      {!status.isStandalone && status.supported && (
        <div style={{ fontSize: 11, color: '#ff9500', lineHeight: 1.5, fontWeight: 600 }}>
          iPhone: Safari → Share → Add to Home Screen, then open the app from your home screen. Notifications do not work reliably in a normal Safari tab.
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
        {status.serverPushConfigured
          ? 'One push per follow-up at its scheduled date and time (not all at once). Server checks every few minutes when the app is closed.'
          : 'Add VAPID keys in Vercel for reminders when the app is closed (see .env.example).'}
        {' '}Alerts fire when each follow-up is due — old overdue items are not blasted on enable.
      </div>

      {ready && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button
            type="button"
            onClick={async () => {
              const r = await sendTestReminderNotification()
              if (r === 'ok') showToast('Test sent — check Notification Center')
              else if (r === 'denied') showToast('Permission denied')
              else showToast('Could not send test — use home screen app on iPhone')
            }}
            style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            Send test notification
          </button>
          <button
            type="button"
            onClick={() => void syncFollowupReminders(contacts).then(() => showToast('Reminders rescheduled'))}
            style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            Reschedule all
          </button>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600,
      padding: '14px 16px 5px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {children}
    </div>
  )
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg2)', borderTop: '1px solid var(--border2)', borderBottom: '1px solid var(--border2)' }}>
      {children}
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border2)', marginLeft: 16 }} />
}

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }
const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '12px 14px', background: 'var(--bg3)', border: '1.5px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 15 }
