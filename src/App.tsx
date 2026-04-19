import { useEffect } from 'react'
import { useStore } from './store/useStore'
import {
  initSupabase,
  isSupabaseConfigured,
  getCurrentUser,
  onAuthStateChange,
  syncContactsFromDB,
} from './lib/supabase'

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

export default function App() {
  const activeScreen = useStore((s) => s.activeScreen)
  const setContacts = useStore((s) => s.setContacts)
  const showToast = useStore((s) => s.showToast)
  const setAuthState = useStore((s) => s.setAuthState)

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setAuthState(null, false)
      return
    }

    initSupabase()

    let cancelled = false

    const syncForUser = async () => {
      try {
        const user = await getCurrentUser()
        if (cancelled) return

        setAuthState(user?.id ?? null, false)

        if (!user) {
          setContacts([])
          return
        }

        const dbContacts = await syncContactsFromDB()
        if (cancelled) return
        setContacts(dbContacts)
      } catch (err) {
        console.error('Supabase sync failed:', err)
        if (!cancelled) {
          setAuthState(null, false)
          setContacts([])
          showToast('Cloud sync failed')
        }
      }
    }

    void syncForUser()

    const unsubscribe = onAuthStateChange(() => {
      setAuthState(null, true)
      void syncForUser()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [setAuthState, setContacts, showToast])

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
