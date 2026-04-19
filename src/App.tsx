import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { initSupabase, syncContactsFromDB } from './lib/supabase'

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
  const sbUrl = useStore((s) => s.sbUrl)
  const sbKey = useStore((s) => s.sbKey)
  const contacts = useStore((s) => s.contacts)
  const setContacts = useStore((s) => s.setContacts)

  // Initialize Supabase and sync on mount
  useEffect(() => {
    if (sbUrl && sbKey) {
      initSupabase(sbUrl, sbKey)
      syncContactsFromDB()
        .then((dbContacts) => {
          if (!dbContacts.length) return
          const dbMap = new Map(dbContacts.map((c) => [c.id, c]))
          const merged = contacts.map((c) => dbMap.get(c.id) ?? c)
          const localIds = new Set(contacts.map((c) => c.id))
          dbContacts.filter((c) => !localIds.has(c.id)).forEach((c) => merged.push(c))
          setContacts(merged)
        })
        .catch((err) => console.error('Supabase sync failed:', err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
