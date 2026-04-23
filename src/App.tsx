import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { initSupabase, syncContactsFromDB } from './lib/supabase'
import { loadImages } from './lib/imageStore'

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
  const showToast = useStore((s) => s.showToast)

  // Initialize Supabase, sync from DB, then restore images from IndexedDB
  useEffect(() => {
    async function init() {
      let finalContacts = contacts

      // Prefer env vars — persisted Zustand values may be stale/empty
      const effectiveUrl = (import.meta.env.VITE_SUPABASE_URL as string) || sbUrl
      const effectiveKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || sbKey
      if (effectiveUrl && effectiveKey) {
        initSupabase(effectiveUrl, effectiveKey)
        try {
          const dbContacts = await syncContactsFromDB()
          if (dbContacts.length) {
            const dbMap = new Map(dbContacts.map((c) => [c.id, c]))
            const merged = contacts.map((c) => dbMap.get(c.id) ?? c)
            const localIds = new Set(contacts.map((c) => c.id))
            dbContacts.filter((c) => !localIds.has(c.id)).forEach((c) => merged.push(c))
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
