import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore'
import { initSupabase } from './lib/supabase'
import { startCloudRealtimeSync } from './lib/cloudSync'
import { loadImages } from './lib/imageStore'
import { DEMO_CONTACTS, IS_DEMO_MODE } from './lib/demo'
import {
  registerReminderServiceWorker,
  startFollowupReminderPolling,
  syncFollowupReminders,
} from './lib/reminderNotifications'

import { Header } from './components/Header'
import { NavBar } from './components/NavBar'
import { Sidebar, SIDEBAR_WIDTH } from './components/Sidebar'
import { useIsDesktop } from './hooks/useIsDesktop'
import { Toast } from './components/Toast'
import { ContactDetail, DETAIL_PANEL_WIDTH } from './components/ContactDetail'
import { EditModal } from './components/modals/EditModal'
import { ContactMenuModal } from './components/modals/ContactMenuModal'
import { BulkMessageModal } from './components/modals/BulkMessageModal'
import { FollowupModal } from './components/modals/FollowupModal'
import { InvoiceModal } from './components/modals/InvoiceModal'

import { ScanScreen } from './components/screens/ScanScreen'
import { ContactsScreen } from './components/screens/ContactsScreen'
import { DashboardScreen } from './components/screens/DashboardScreen'
import { BulkScreen } from './components/screens/BulkScreen'
import { SettingsScreen } from './components/screens/SettingsScreen'
import { lockAllRevenueAccess } from './lib/revenueLock'
import { AUTH_PREF_CHANGED_EVENT } from './lib/authenticatorPreference'
import { isAppLoginRequired, isAppSessionUnlocked, lockAppSession } from './lib/appAuth'
import { AppLoginGate } from './components/AppLoginGate'

const INACTIVITY_LOCK_MS = 5 * 60_000 // 5 minutes
const BUILD_CHECK_INTERVAL_MS = 60_000

export default function App() {
  const isDesktop = useIsDesktop()
  const activeScreen = useStore((s) => s.activeScreen)
  const detailContactId = useStore((s) => s.detailContactId)
  const sbUrl = useStore((s) => s.sbUrl)
  const sbKey = useStore((s) => s.sbKey)
  const contacts = useStore((s) => s.contacts)
  const setContacts = useStore((s) => s.setContacts)
  const setInvoices = useStore((s) => s.setInvoices)
  const deleteContact = useStore((s) => s.deleteContact)
  const deleteInvoice = useStore((s) => s.deleteInvoice)
  const showToast = useStore((s) => s.showToast)
  const sheetsWebhook = useStore((s) => s.sheetsWebhook)
  const setSheetsWebhook = useStore((s) => s.setSheetsWebhook)
  const [isUnlocked, setIsUnlocked] = useState(() => {
    if (IS_DEMO_MODE) return true
    if (!isAppLoginRequired()) return false
    return isAppSessionUnlocked()
  })
  const notifiedBuildRef = useRef('')

  useEffect(() => {
    if (!isUnlocked) return

    const currentAsset = document
      .querySelector('script[src*="/assets/index-"]')
      ?.getAttribute('src')
      ?.trim()

    if (!currentAsset) return

    const checkForNewBuild = async () => {
      try {
        const res = await fetch(`/index.html?t=${Date.now()}`, { cache: 'no-store' })
        const html = await res.text()
        const match = html.match(/src="(\/assets\/index-[^"]+\.js)"/)
        const latestAsset = match?.[1]?.trim()
        if (!latestAsset || latestAsset === currentAsset) return
        if (notifiedBuildRef.current === latestAsset) return
        notifiedBuildRef.current = latestAsset
        showToast('New app version available. Open Settings to refresh.')
        const shouldReload = window.confirm('A new version is available. Reload now?')
        if (shouldReload) {
          window.location.replace(`${window.location.pathname}?v=${Date.now()}`)
        }
      } catch {
        // Ignore transient network errors.
      }
    }

    const intervalId = window.setInterval(checkForNewBuild, BUILD_CHECK_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkForNewBuild()
    }
    document.addEventListener('visibilitychange', onVisible)
    void checkForNewBuild()

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isUnlocked, showToast])

  useEffect(() => {
    if (!isAppLoginRequired() || !isUnlocked) return

    let lockTimer: ReturnType<typeof setTimeout>

    const lock = () => {
      lockAppSession()
      lockAllRevenueAccess()
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
    const onAuthPrefChanged = () => {
      lockAppSession()
      lockAllRevenueAccess()
      setIsUnlocked(false)
    }
    window.addEventListener(AUTH_PREF_CHANGED_EVENT, onAuthPrefChanged)
    return () => window.removeEventListener(AUTH_PREF_CHANGED_EVENT, onAuthPrefChanged)
  }, [])

  useEffect(() => {
    if (!isUnlocked) return
    void (async () => {
      await registerReminderServiceWorker()
      await syncFollowupReminders(contacts)
    })()
    return startFollowupReminderPolling(() => useStore.getState().contacts)
  }, [isUnlocked, contacts])

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

  useEffect(() => {
    if (!isUnlocked || IS_DEMO_MODE) return

    const effectiveUrl = (import.meta.env.VITE_SUPABASE_URL as string) || sbUrl
    const effectiveKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || sbKey
    if (!effectiveUrl || !effectiveKey) return

    initSupabase(effectiveUrl, effectiveKey)

    const storeApi = {
      getContacts: () => useStore.getState().contacts,
      setContacts,
      getInvoices: () => useStore.getState().invoices,
      setInvoices,
      deleteContact,
      deleteInvoice,
    }

    return startCloudRealtimeSync(storeApi, (live) => {
      if (live) console.info('CardScan: live cloud sync connected')
    })
  }, [isUnlocked, sbUrl, sbKey, setContacts, setInvoices, deleteContact, deleteInvoice])

  if (!isUnlocked) {
    return <AppLoginGate onUnlock={() => setIsUnlocked(true)} />
  }

  // On desktop the detail panel docks to the right instead of covering the
  // screen. The content column is centered *within the space between the
  // sidebar and the (possibly panel-occupied) right edge* via flexbox, rather
  // than left-anchored against the sidebar — anchoring left off-centers the
  // whole app and leaves a large lopsided gap on wide monitors.
  const detailPanelOpen = isDesktop && !!detailContactId

  return (
    <>
      {isDesktop && <Sidebar />}

      <div
        style={{
          marginLeft: isDesktop ? SIDEBAR_WIDTH : undefined,
          marginRight: detailPanelOpen ? DETAIL_PANEL_WIDTH : 0,
          minHeight: '100dvh',
          display: isDesktop ? 'flex' : undefined,
          justifyContent: isDesktop ? 'center' : undefined,
          transition: 'margin-right 0.2s ease-out',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: isDesktop ? 900 : 480,
            margin: isDesktop ? undefined : '0 auto',
            paddingBottom: isDesktop ? 0 : 86,
          }}
        >
          <Header />

          {/* Screens — all mounted, only active one visible */}
          <div style={{ display: activeScreen === 'scan' ? 'block' : 'none' }}>
            <ScanScreen />
          </div>
          <div style={{ display: activeScreen === 'contacts' ? 'block' : 'none' }}>
            <ContactsScreen />
          </div>
          <div style={{ display: activeScreen === 'dashboard' ? 'block' : 'none' }}>
            <DashboardScreen />
          </div>
          <div style={{ display: activeScreen === 'bulk' ? 'block' : 'none' }}>
            <BulkScreen />
          </div>
          <div style={{ display: activeScreen === 'settings' ? 'block' : 'none' }}>
            <SettingsScreen />
          </div>

          {!isDesktop && <NavBar />}
        </div>
      </div>

      {/* Global overlays — rendered outside the max-width container */}
      <Toast />
      <ContactDetail />
      <EditModal />
      <ContactMenuModal />
      <BulkMessageModal />
      <FollowupModal />
      <InvoiceModal />
    </>
  )
}
