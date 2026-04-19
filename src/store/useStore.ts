import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Contact, Screen } from '../types/contact'
import { normalizeContact } from '../lib/utils'

interface EditModalState {
  contact: Contact
  isNew: boolean
}

interface AppState {
  // ─── Contacts ────────────────────────────────────────────────────
  contacts: Contact[]
  addContacts: (contacts: Contact[]) => void
  updateContact: (id: string, updates: Partial<Contact>) => void
  deleteContact: (id: string) => void
  setContacts: (contacts: Contact[]) => void

  // ─── Settings ────────────────────────────────────────────────────
  apiKey: string
  apiKey2: string
  setApiKey: (key: string) => void
  setApiKey2: (key: string) => void
  sbUrl: string
  setSbUrl: (url: string) => void
  sbKey: string
  setSbKey: (key: string) => void
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void

  // ─── Navigation ──────────────────────────────────────────────────
  activeScreen: Screen
  setActiveScreen: (screen: Screen) => void

  // ─── Overlays ────────────────────────────────────────────────────
  detailContactId: string | null
  setDetailContactId: (id: string | null) => void

  editModal: EditModalState | null
  setEditModal: (modal: EditModalState | null) => void

  menuContactId: string | null
  setMenuContactId: (id: string | null) => void

  bulkMessageType: 'email' | 'sms' | null
  setBulkMessageType: (type: 'email' | 'sms' | null) => void

  // ─── Scan state ──────────────────────────────────────────────────
  isScanning: boolean
  setIsScanning: (v: boolean) => void

  previewCards: Contact[]
  setPreviewCards: (cards: Contact[]) => void

  /** ID of front-scanned contact whose back we're about to scan */
  pendingBackId: string | null
  setPendingBackId: (id: string | null) => void

  /** Signal ScanScreen to open the back-of-card file picker */
  triggerBackScan: boolean
  setTriggerBackScan: (v: boolean) => void

  // ─── Bulk selection ──────────────────────────────────────────────
  selectedIds: string[]
  toggleSelected: (id: string) => void
  clearSelected: () => void

  // ─── Toast ───────────────────────────────────────────────────────
  toastMessage: string
  toastVisible: boolean
  showToast: (msg: string) => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      // ─── Contacts ──────────────────────────────────────────────
      contacts: [],
      addContacts: (newContacts) =>
        set((s) => ({ contacts: [...newContacts, ...s.contacts] })),
      updateContact: (id, updates) =>
        set((s) => ({
          contacts: s.contacts.map((c) =>
            c.id === id ? normalizeContact({ ...c, ...updates }) : c
          ),
        })),
      deleteContact: (id) =>
        set((s) => ({
          contacts: s.contacts.filter((c) => c.id !== id),
          selectedIds: s.selectedIds.filter((x) => x !== id),
        })),
      setContacts: (contacts) => set({ contacts }),

      // ─── Settings ──────────────────────────────────────────────
      apiKey: (import.meta.env.VITE_GEMINI_KEY as string) ?? '',
      apiKey2: (import.meta.env.VITE_GEMINI_KEY2 as string) ?? '',
      setApiKey: (apiKey) => set({ apiKey }),
      setApiKey2: (apiKey2) => set({ apiKey2 }),
      sbUrl: (import.meta.env.VITE_SUPABASE_URL as string) ?? '',
      setSbUrl: (sbUrl) => set({ sbUrl }),
      sbKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? '',
      setSbKey: (sbKey) => set({ sbKey }),
      theme: 'light',
      setTheme: (theme) => set({ theme }),

      // ─── Navigation ────────────────────────────────────────────
      activeScreen: 'scan',
      setActiveScreen: (activeScreen) => set({ activeScreen }),

      // ─── Overlays ──────────────────────────────────────────────
      detailContactId: null,
      setDetailContactId: (detailContactId) => set({ detailContactId }),
      editModal: null,
      setEditModal: (editModal) => set({ editModal }),
      menuContactId: null,
      setMenuContactId: (menuContactId) => set({ menuContactId }),
      bulkMessageType: null,
      setBulkMessageType: (bulkMessageType) => set({ bulkMessageType }),

      // ─── Scan ──────────────────────────────────────────────────
      isScanning: false,
      setIsScanning: (isScanning) => set({ isScanning }),
      previewCards: [],
      setPreviewCards: (previewCards) => set({ previewCards }),
      pendingBackId: null,
      setPendingBackId: (pendingBackId) => set({ pendingBackId }),
      triggerBackScan: false,
      setTriggerBackScan: (triggerBackScan) => set({ triggerBackScan }),

      // ─── Bulk selection ────────────────────────────────────────
      selectedIds: [],
      toggleSelected: (id) =>
        set((s) => ({
          selectedIds: s.selectedIds.includes(id)
            ? s.selectedIds.filter((x) => x !== id)
            : [...s.selectedIds, id],
        })),
      clearSelected: () => set({ selectedIds: [] }),

      // ─── Toast ─────────────────────────────────────────────────
      toastMessage: '',
      toastVisible: false,
      showToast: (msg) => {
        if (toastTimer) clearTimeout(toastTimer)
        set({ toastMessage: msg, toastVisible: true })
        toastTimer = setTimeout(() => set({ toastVisible: false }), 2700)
      },
    }),
    {
      name: 'cs_store_v2',
      storage: createJSONStorage(() => localStorage),
      // Only persist data that should survive a page refresh
      partialize: (s) => ({
        contacts: s.contacts,
        apiKey: s.apiKey,
        apiKey2: s.apiKey2,
        sbUrl: s.sbUrl,
        sbKey: s.sbKey,
        theme: s.theme,
      }),
    }
  )
)
