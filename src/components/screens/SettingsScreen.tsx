import { useRef, useState } from 'react'
import {
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudOff,
  Download,
  Moon,
  RefreshCw,
  Sun,
  Undo2,
  Upload,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useTheme } from '../../hooks/useTheme'
import {
  initSupabase,
  syncContactsFromDB,
  syncInvoicesFromDB,
  testSupabaseConnection,
  saveContactsToDB,
  saveInvoiceToDB,
  SUPABASE_SCHEMA_SQL,
} from '../../lib/supabase'
import { backupToJSON, restoreFromJSON } from '../../lib/export'
import { dedupeContacts, normalizeContact } from '../../lib/utils'
import { DEMO_CONTACTS, IS_DEMO_MODE } from '../../lib/demo'
import { Contact } from '../../types/contact'
import {
  enableReminderPush,
  getReminderPushStatus,
  isReminderPushEnabled,
  isStandalonePwa,
  sendTestReminderNotification,
  setReminderPushEnabled,
  supportsReminderPush,
  syncFollowupReminders,
} from '../../lib/reminderNotifications'

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
    invoices, addInvoice,
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
    addInvoice: s.addInvoice,
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
        Promise.allSettled(invoices.map((inv) => saveInvoiceToDB(inv))),
      ])

      const invOk = invoiceResults.filter((r) => r.status === 'fulfilled' && r.value).length
      const invFailed = invoices.length - invOk

      const parts = [`${contactResult.ok} contacts`]
      if (!force && contactResult.merged > 0) parts.push(`${contactResult.merged} merged`)
      if (contactResult.failed > 0) parts.push(`${contactResult.failed} contacts failed`)
      parts.push(`${invOk} invoices`)
      if (invFailed > 0) parts.push(`${invFailed} invoices failed`)
      showToast(parts.join(', ') + (force ? ' (force)' : ''))
    } catch (err) {
      showToast('Backup failed: ' + (err as Error).message)
    }
  }

  const handleClearAll = () => {
    if (!confirm('Clear contacts from this phone/browser only? Supabase backup will stay saved.')) return
    setContacts([]); showToast('Local contacts cleared. Use Restore from Supabase to bring them back.')
  }

  const handleRestoreFromSupabase = async () => {
    if (IS_DEMO_MODE) {
      setContacts(DEMO_CONTACTS)
      showToast('Demo mode: sample contacts restored')
      return
    }

    try {
      initSupabase(ENV_SUPABASE_URL || sbUrl, ENV_SUPABASE_ANON_KEY || sbKey)
      const [cloudContacts, cloudInvoices] = await Promise.all([
        syncContactsFromDB(),
        syncInvoicesFromDB(),
      ])

      if (!cloudContacts.length && !cloudInvoices.length) {
        showToast('No cloud data found')
        return
      }

      if (cloudContacts.length) {
        setContacts(dedupeContacts([...cloudContacts, ...contacts]))
      }

      if (cloudInvoices.length) {
        const localIds = new Set(invoices.map((i) => i.id))
        cloudInvoices.filter((i) => !localIds.has(i.id)).forEach((i) => addInvoice(i))
      }

      showToast(`Restored ${cloudContacts.length} contact(s) + ${cloudInvoices.length} invoice(s)`)
    } catch (err) {
      showToast('Cloud restore failed: ' + (err as Error).message)
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

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: '16px 16px 0', fontSize: 22, fontWeight: 800 }}>Settings</div>

      {/* Supabase */}
      <SectionTitle>Cloud Backup</SectionTitle>
      <SettingsGroup>
        <div onClick={() => handleBackupToSupabase()} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>Backup All to Supabase</div>
          <div style={{ color: 'var(--accent)', display: 'flex' }}><Cloud size={18} strokeWidth={2} aria-hidden /></div>
        </div>
        <Divider />
        <div onClick={handleRestoreFromSupabase} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>Restore from Supabase</div>
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

      {/* Reminder push */}
      <SectionTitle>Reminder Notifications</SectionTitle>
      <SettingsGroup>
        <ReminderNotificationsPanel contacts={contacts} showToast={showToast} />
      </SettingsGroup>

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
          <div style={{ flex: 1, fontSize: 15 }}>Normalize Existing Data Now (ALL CAPS + dedupe)</div>
          <div style={{ color: '#34c759', display: 'flex' }}><Check size={18} strokeWidth={2} aria-hidden /></div>
        </div>
        <Divider />
        <div onClick={handleUndoNormalize} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>Undo Last Normalize (restore backup)</div>
          <div style={{ color: '#ff9500', display: 'flex' }}><Undo2 size={18} strokeWidth={2} aria-hidden /></div>
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
            if (result === 'granted') showToast('Notifications on — try Send test below')
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
        Alerts appear in Notification Center at each follow-up date and time. Overdue reminders alert when you open the app after enabling.
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
