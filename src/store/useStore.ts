import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Contact, Screen } from '../types/contact'
import type { CallLog } from '../types/call'
import { SavedInvoice } from '../types/invoice'
import type { ChargeInvoice, ChargePayment } from '../types/chargeAccount'
import { dedupeContacts, normalizeContact, sortContactsAlphabetically } from '../lib/utils'
import { IS_DEMO_MODE } from '../lib/demo'
import { debouncedPersistStorage } from '../lib/debouncedStorage'

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

  // ─── Cold-call log ───────────────────────────────────────────────
  callLogs: CallLog[]
  addCallLog: (log: CallLog) => void
  /** Union-merges by id; cloud rows win on conflict. */
  mergeCallLogs: (logs: CallLog[]) => void
  markCallLogSynced: (id: string) => void
  deleteCallLog: (id: string) => void

  // ─── Invoices ────────────────────────────────────────────────────
  invoices: SavedInvoice[]
  addInvoice: (invoice: SavedInvoice) => void
  setInvoices: (invoices: SavedInvoice[]) => void
  updateInvoice: (id: string, patch: Partial<SavedInvoice>) => void
  deleteInvoice: (id: string) => void

  // ─── Charge accounts (AR) ─────────────────────────────────────────
  chargeInvoices: ChargeInvoice[]
  chargePayments: ChargePayment[]
  setChargeInvoices: (invoices: ChargeInvoice[]) => void
  setChargePayments: (payments: ChargePayment[]) => void
  addChargeInvoice: (invoice: ChargeInvoice) => void
  addChargePayment: (payment: ChargePayment) => void
  removeChargeInvoice: (id: string) => void
  removeChargePayment: (id: string) => void

  // ─── Settings ────────────────────────────────────────────────────
  apiKey: string
  apiKey2: string
  apiKey3: string
  setApiKey: (key: string) => void
  setApiKey2: (key: string) => void
  setApiKey3: (key: string) => void

  sbUrl: string
  setSbUrl: (url: string) => void
  sbKey: string
  setSbKey: (key: string) => void

  sheetsWebhook: string
  setSheetsWebhook: (url: string) => void

  invoiceSheetsWebhook: string
  setInvoiceSheetsWebhook: (url: string) => void

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

  followupContactId: string | null
  setFollowupContactId: (id: string | null) => void

  invoiceContactId: string | null
  setInvoiceContactId: (id: string | null) => void

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
  showToast: (msg: string, durationMs?: number) => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      // ─── Contacts ──────────────────────────────────────────────
      contacts: [],

      addContacts: (newContacts) =>
        set((s) => ({
          contacts: sortContactsAlphabetically(dedupeContacts([...newContacts, ...s.contacts])),
        })),

      updateContact: (id, updates) =>
        set((s) => ({
          contacts: s.contacts.map((c) =>
            c.id === id
              ? normalizeContact({ ...c, ...updates, updated_at: new Date().toISOString() })
              : c
          ),
        })),

      deleteContact: (id) =>
        set((s) => ({
          contacts: s.contacts.filter((c) => c.id !== id),
          selectedIds: s.selectedIds.filter((x) => x !== id),
        })),

      setContacts: (contacts) =>
        set((s) => {
          if (s.contacts === contacts) return s
          return { contacts: sortContactsAlphabetically(dedupeContacts(contacts)) }
        }),

      callLogs: [],

      addCallLog: (log) => set((s) => ({ callLogs: [log, ...s.callLogs] })),

      mergeCallLogs: (incoming) =>
        set((s) => {
          if (!incoming.length) return s
          // Call rows are never edited after the fact, so a union by id is a
          // complete merge — no field-level conflict to resolve.
          const merged = new Map(s.callLogs.map((log) => [log.id, log]))
          let changed = false
          for (const log of incoming) {
            const prev = merged.get(log.id)
            if (
              prev &&
              prev.synced === log.synced &&
              prev.called_at === log.called_at &&
              prev.outcome === log.outcome &&
              prev.note === log.note &&
              prev.contact_id === log.contact_id &&
              prev.callback_at === log.callback_at
            ) {
              continue
            }
            merged.set(log.id, log)
            changed = true
          }
          if (!changed) return s
          return {
            callLogs: [...merged.values()].sort((a, b) => b.called_at.localeCompare(a.called_at)),
          }
        }),

      markCallLogSynced: (id) =>
        set((s) => {
          const current = s.callLogs.find((log) => log.id === id)
          if (!current || current.synced) return s
          return {
            callLogs: s.callLogs.map((log) => (log.id === id ? { ...log, synced: true } : log)),
          }
        }),

      deleteCallLog: (id) => set((s) => ({ callLogs: s.callLogs.filter((log) => log.id !== id) })),

      // ─── Invoices ──────────────────────────────────────────────
      invoices: [],
      addInvoice: (invoice) =>
        set((s) => ({ invoices: [invoice, ...s.invoices] })),
      setInvoices: (invoices) => set((s) => (s.invoices === invoices ? s : { invoices })),
      updateInvoice: (id, patch) =>
        set((s) => ({ invoices: s.invoices.map((inv) => inv.id === id ? { ...inv, ...patch } : inv) })),
      deleteInvoice: (id) =>
        set((s) => ({ invoices: s.invoices.filter((inv) => inv.id !== id) })),

      // ─── Charge accounts ───────────────────────────────────────
      chargeInvoices: [],
      chargePayments: [],
      setChargeInvoices: (chargeInvoices) => set({ chargeInvoices }),
      setChargePayments: (chargePayments) => set({ chargePayments }),
      addChargeInvoice: (invoice) =>
        set((s) => ({ chargeInvoices: [invoice, ...s.chargeInvoices] })),
      addChargePayment: (payment) =>
        set((s) => ({ chargePayments: [payment, ...s.chargePayments] })),
      removeChargeInvoice: (id) =>
        set((s) => ({ chargeInvoices: s.chargeInvoices.filter((inv) => inv.id !== id) })),
      removeChargePayment: (id) =>
        set((s) => ({ chargePayments: s.chargePayments.filter((p) => p.id !== id) })),

      // ─── Settings ──────────────────────────────────────────────
      apiKey: ((import.meta.env.VITE_GEMINI_KEY as string) || (import.meta.env.VITE_GEMINI_API_KEY as string)) ?? '',
      apiKey2: ((import.meta.env.VITE_GEMINI_KEY2 as string) || (import.meta.env.VITE_GEMINI_API_KEY2 as string)) ?? '',
      apiKey3: ((import.meta.env.VITE_GEMINI_KEY3 as string) || (import.meta.env.VITE_GEMINI_API_KEY3 as string)) ?? '',

      setApiKey: (apiKey) => set({ apiKey }),
      setApiKey2: (apiKey2) => set({ apiKey2 }),
      setApiKey3: (apiKey3) => set({ apiKey3 }),

      sbUrl: (import.meta.env.VITE_SUPABASE_URL as string) ?? '',
      setSbUrl: (sbUrl) => set({ sbUrl }),

      sbKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? '',
      setSbKey: (sbKey) => set({ sbKey }),

      sheetsWebhook: (import.meta.env.VITE_SHEETS_WEBHOOK as string) ?? '',
      setSheetsWebhook: (sheetsWebhook) => set({ sheetsWebhook }),

      invoiceSheetsWebhook: (import.meta.env.VITE_INVOICE_SHEETS_WEBHOOK as string) ?? '',
      setInvoiceSheetsWebhook: (invoiceSheetsWebhook) => set({ invoiceSheetsWebhook }),

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

      followupContactId: null,
      setFollowupContactId: (followupContactId) => set({ followupContactId }),

      invoiceContactId: null,
      setInvoiceContactId: (invoiceContactId) => set({ invoiceContactId }),

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
      showToast: (msg, durationMs = 2700) => {
        if (toastTimer) clearTimeout(toastTimer)
        set({ toastMessage: msg, toastVisible: true })
        toastTimer = setTimeout(() => set({ toastVisible: false }), durationMs)
      },
    }),
    {
      name: IS_DEMO_MODE ? 'cs_store_demo_v2' : 'cs_store_v2',
      version: 1,
      storage: debouncedPersistStorage,
      migrate: (persistedState: unknown) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState as AppState
        const state = persistedState as Partial<AppState>
        if (!Array.isArray(state.contacts)) return state as AppState
        return {
          ...state,
          contacts: sortContactsAlphabetically(dedupeContacts(state.contacts)),
        } as AppState
      },

      // Only persist data that should survive a page refresh
      // Keep array refs so persist can skip toast/nav writes. Images are
      // stripped later, only when a real persist flush runs.
      partialize: (s) => ({
        contacts: s.contacts,
        callLogs: s.callLogs,
        invoices: s.invoices,
        apiKey: s.apiKey,
        apiKey2: s.apiKey2,
        apiKey3: s.apiKey3,
        sbUrl: s.sbUrl,
        sbKey: s.sbKey,
        sheetsWebhook: s.sheetsWebhook,
        invoiceSheetsWebhook: s.invoiceSheetsWebhook,
        theme: s.theme,
      }),
    }
  )
)
