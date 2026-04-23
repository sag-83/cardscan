import { useEffect, useState } from 'react'
import { useStore } from './store/useStore'
import { initSupabase, syncContactsFromDB } from './lib/supabase'
import { loadImages } from './lib/imageStore'
import { dedupeContacts } from './lib/utils'
import { DEMO_CONTACTS, IS_DEMO_MODE } from './lib/demo'

import { Header } from './components/Header'
import { NavBar } from './components/NavBar'
import { Toast } from './components/Toast'
import { ContactDetail } from './components/ContactDetail'
import { EditModal } from './components/modals/EditModal'
import { ContactMenuModal } from './components/modals/ContactMenuModal'
import { BulkMessageModal } from './components/modals/BulkMessageModal'

import { ScanScreen } from './components/screens/ScanScreen'
import { ContactsScreen } from './components/screens/ContactsScreen'
import { BulkScreen } from './components/screens/BulkScreen'
import { SettingsScreen } from './components/screens/SettingsScreen'

const APP_PASSWORD = IS_DEMO_MODE ? '' : ((import.meta.env.VITE_APP_PASSWORD as string) ?? '')
const APP_UNLOCK_KEY = 'cardscan_app_unlocked'
const INACTIVITY_LOCK_MS = 60_000

export default function App() {
  const activeScreen = useStore((s) => s.activeScreen)
  const sbUrl = useStore((s) => s.sbUrl)
  const sbKey = useStore((s) => s.sbKey)
  const contacts = useStore((s) => s.contacts)
  const setContacts = useStore((s) => s.setContacts)
  const showToast = useStore((s) => s.showToast)
  const sheetsWebhook = useStore((s) => s.sheetsWebhook)
  const setSheetsWebhook = useStore((s) => s.setSheetsWebhook)
  const [isUnlocked, setIsUnlocked] = useState(() => {
    return !APP_PASSWORD || localStorage.getItem(APP_UNLOCK_KEY) === APP_PASSWORD
  })

  useEffect(() => {
    if (!APP_PASSWORD || !isUnlocked) return

    let lockTimer: ReturnType<typeof setTimeout>

    const lock = () => {
      localStorage.removeItem(APP_UNLOCK_KEY)
      setIsUnlocked(false)
    }

    const resetTimer = () => {
      clearTimeout(lockTimer)
      lockTimer = setTimeout(lock, INACTIVITY_LOCK_MS)
    }

    const activityEvents = ['click', 'keydown', 'touchstart', 'pointermove', 'scroll']

    resetTimer()
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetTimer, { passive: true })
    })

    return () => {
      clearTimeout(lockTimer)
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetTimer)
      })
    }
  }, [isUnlocked])

  useEffect(() => {
    if (!isUnlocked) return

    async function init() {
      if (IS_DEMO_MODE) {
        if (contacts.length === 0) setContacts(DEMO_CONTACTS)
        return
      }

      // If env var is set but localStorage has stale empty string, fix it
      const envWebhook = import.meta.env.VITE_SHEETS_WEBHOOK as string
      if (envWebhook && !sheetsWebhook) setSheetsWebhook(envWebhook)

      let finalContacts = contacts

      // Prefer env vars — persisted Zustand values may be stale/empty
      const effectiveUrl = (import.meta.env.VITE_SUPABASE_URL as string) || sbUrl
      const effectiveKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || sbKey
      if (effectiveUrl && effectiveKey) {
        initSupabase(effectiveUrl, effectiveKey)
        try {
          const dbContacts = await syncContactsFromDB()
          if (dbContacts.length && contacts.length === 0) {
            const merged = dedupeContacts([...dbContacts, ...contacts])
            finalContacts = merged
            setContacts(merged)
          }
        } catch (err) {
          console.error('Supabase sync failed:', err)
          showToast('Cloud sync failed — using local data')
        }
      }

      // Restore card images from IndexedDB for contacts that lost their base64 on refresh
      const keys: string[] = []
      finalContacts.forEach((c) => {
        if (!c.front_image && !c.front_image_url) keys.push(`${c.id}_front`)
        if (!c.back_image && !c.back_image_url) keys.push(`${c.id}_back`)
      })
      if (keys.length) {
        try {
          const images = await loadImages(keys)
          if (Object.keys(images).length) {
            setContacts(
              finalContacts.map((c) => ({
                ...c,
                front_image: images[`${c.id}_front`] ?? c.front_image,
                back_image: images[`${c.id}_back`] ?? c.back_image,
              }))
            )
          }
        } catch (err) {
          console.warn('IndexedDB image restore failed:', err)
        }
      }
    }

    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnlocked])

  if (!isUnlocked) {
    return <PasswordGate onUnlock={() => setIsUnlocked(true)} />
  }

  return (
    <>
      <div style={{ width: '100%', maxWidth: 480, margin: '0 auto', minHeight: '100dvh', paddingBottom: 86 }}>
        <Header />

        {/* Screens — all mounted, only active one visible */}
        <div style={{ display: activeScreen === 'scan' ? 'block' : 'none' }}>
          <ScanScreen />
        </div>
        <div style={{ display: activeScreen === 'contacts' ? 'block' : 'none' }}>
          <ContactsScreen />
        </div>
        <div style={{ display: activeScreen === 'bulk' ? 'block' : 'none' }}>
          <BulkScreen />
        </div>
        <div style={{ display: activeScreen === 'settings' ? 'block' : 'none' }}>
          <SettingsScreen />
        </div>

        <NavBar />
      </div>

      {/* Global overlays — rendered outside the max-width container */}
      <Toast />
      <ContactDetail />
      <EditModal />
      <ContactMenuModal />
      <BulkMessageModal />
    </>
  )
}

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()

    if (password === APP_PASSWORD) {
      localStorage.setItem(APP_UNLOCK_KEY, APP_PASSWORD)
      onUnlock()
      return
    }

    setError('Incorrect password')
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background:
          'radial-gradient(circle at top, rgba(0,122,255,0.18), transparent 34%), var(--bg)',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: 390,
          background: 'var(--bg2)',
          border: '1px solid var(--border2)',
          borderRadius: 22,
          padding: 24,
          boxShadow: '0 18px 50px rgba(0,0,0,0.12)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>
          Private Access
        </div>
        <h1 style={{ fontSize: 28, lineHeight: 1.1, marginBottom: 10 }}>CardHolder</h1>
        <p style={{ color: 'var(--text3)', fontSize: 14, lineHeight: 1.5, marginBottom: 18 }}>
          Enter the access password to open the scanner.
        </p>
        <input
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setError('')
          }}
          placeholder="Access password"
          autoFocus
          style={{
            width: '100%',
            padding: '14px 15px',
            borderRadius: 12,
            border: '1.5px solid var(--border)',
            background: 'var(--bg3)',
            fontSize: 16,
            marginBottom: 10,
          }}
        />
        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
            {error}
          </div>
        )}
        <button
          type="submit"
          style={{
            width: '100%',
            border: 'none',
            borderRadius: 12,
            padding: '14px 18px',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 16,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          Unlock
        </button>
      </form>
    </div>
  )
}
