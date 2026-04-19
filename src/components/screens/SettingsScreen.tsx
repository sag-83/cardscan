import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { useTheme } from '../../hooks/useTheme'
import {
  SUPABASE_SCHEMA_SQL,
  endDemoSession,
  getAccessToken,
  isSupabaseConfigured,
  startDemoSession,
  testSupabaseConnection,
} from '../../lib/supabase'
import { backupToJSON, restoreFromJSON } from '../../lib/export'

interface HealthState {
  loading: boolean
  error: string
  server: {
    supabaseConfigured: boolean
    geminiConfigured: boolean
    sheetsConfigured: boolean
  } | null
  auth: {
    authenticated: boolean
    userId: string | null
  } | null
}

export function SettingsScreen() {
  const restoreInputRef = useRef<HTMLInputElement>(null)
  const { theme, setTheme } = useTheme()
  const [isStartingSession, setIsStartingSession] = useState(false)
  const [health, setHealth] = useState<HealthState>({
    loading: true,
    error: '',
    server: null,
    auth: null,
  })

  const { authUserId, authLoading, contacts, setContacts, showToast } = useStore((s) => ({
    authUserId: s.authUserId,
    authLoading: s.authLoading,
    contacts: s.contacts,
    setContacts: s.setContacts,
    showToast: s.showToast,
  }))

  const handleTestSB = async () => {
    try {
      await testSupabaseConnection()
      showToast('Supabase connection looks good')
    } catch (err) {
      showToast((err as Error).message || 'Supabase test failed')
    }
  }

  const loadHealth = async () => {
    setHealth((prev) => ({ ...prev, loading: true, error: '' }))

    try {
      const accessToken = await getAccessToken()
      const res = await fetch('/api/health', {
        method: 'GET',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      })

      const payload = (await res.json()) as {
        ok?: boolean
        error?: string
        server?: HealthState['server']
        auth?: HealthState['auth']
      }

      if (!res.ok) {
        throw new Error(payload.error || `Health check failed with status ${res.status}`)
      }

      setHealth({
        loading: false,
        error: '',
        server: payload.server ?? null,
        auth: payload.auth ?? null,
      })
    } catch (err) {
      setHealth({
        loading: false,
        error: (err as Error).message || 'Unable to load readiness checks',
        server: null,
        auth: null,
      })
    }
  }

  useEffect(() => {
    void loadHealth()
  }, [authUserId])

  const handleStartSession = async () => {
    setIsStartingSession(true)
    try {
      await startDemoSession()
      showToast('Secure demo session started')
    } catch (err) {
      showToast((err as Error).message || 'Unable to start secure session')
    } finally {
      setIsStartingSession(false)
    }
  }

  const handleEndSession = async () => {
    try {
      await endDemoSession()
      setContacts([])
      showToast('Signed out')
    } catch (err) {
      showToast((err as Error).message || 'Unable to sign out')
    }
  }

  const handleClearAll = () => {
    if (!confirm('Delete local contacts currently loaded in this browser?')) return
    setContacts([])
    showToast('Local contacts cleared.')
  }

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const { contacts: restored, count } = restoreFromJSON(reader.result as string)
        const existingIds = new Set(contacts.map((c) => c.id))
        const newOnes = restored.filter((c) => !existingIds.has(c.id))
        setContacts([...contacts, ...newOnes])
        showToast(`Restored ${newOnes.length} of ${count} contacts locally`)
      } catch {
        showToast('Invalid backup file')
      }
    }

    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: '16px 16px 0', fontSize: 22, fontWeight: 800 }}>Settings</div>

      <SectionTitle>Security</SectionTitle>
      <SettingsGroup>
        <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Secure Demo Session</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.5 }}>
            Scanning and cloud sync are locked behind an authenticated Supabase session. OCR and
            Google Sheets export now run server-side only.
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            {authLoading
              ? 'Checking session...'
              : authUserId
              ? `Signed in as ${authUserId}`
              : 'No active session'}
          </div>
        </div>
        <Divider />
        {!authUserId ? (
          <button
            onClick={handleStartSession}
            disabled={isStartingSession || !isSupabaseConfigured()}
            style={{ ...actionButtonStyle, margin: 16, opacity: isStartingSession ? 0.7 : 1 }}
          >
            {isStartingSession ? 'Starting...' : 'Start Secure Demo Session'}
          </button>
        ) : (
          <button onClick={handleEndSession} style={{ ...dangerButtonStyle, margin: 16 }}>
            End Session
          </button>
        )}
      </SettingsGroup>

      <SectionTitle>Deployment Readiness</SectionTitle>
      <SettingsGroup>
        <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Pre-Deploy Checklist</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.5 }}>
            Use this before pushing to Vercel. These checks confirm the client config, server env,
            and auth session are all behaving the way the public demo expects.
          </div>
          {health.error && (
            <div style={{ fontSize: 12, color: 'var(--danger)' }}>{health.error}</div>
          )}
          <ChecklistItem
            label="Client Supabase env is present"
            ok={isSupabaseConfigured()}
            pending={false}
          />
          <ChecklistItem
            label="Server can read Supabase env"
            ok={health.server?.supabaseConfigured ?? false}
            pending={health.loading}
          />
          <ChecklistItem
            label="Server OCR key is configured"
            ok={health.server?.geminiConfigured ?? false}
            pending={health.loading}
          />
          <ChecklistItem
            label="Server Sheets webhook is configured"
            ok={health.server?.sheetsConfigured ?? false}
            pending={health.loading}
            optional
          />
          <ChecklistItem
            label="Secure demo session is active"
            ok={Boolean(authUserId && health.auth?.authenticated)}
            pending={authLoading || health.loading}
          />
          <ChecklistItem
            label="Secure SQL has been applied in Supabase"
            ok={false}
            pending={false}
            manual="Manual check"
          />
          <button onClick={() => void loadHealth()} style={actionButtonStyle}>
            {health.loading ? 'Refreshing...' : 'Refresh Readiness Checks'}
          </button>
        </div>
      </SettingsGroup>

      <SectionTitle>Environment</SectionTitle>
      <SettingsGroup>
        <div style={rowStyle}>
          <div style={{ flex: 1, fontSize: 15 }}>Supabase client config</div>
          <div style={{ color: isSupabaseConfigured() ? 'var(--ok, #2e7d32)' : 'var(--danger)' }}>
            {isSupabaseConfigured() ? 'Configured' : 'Missing'}
          </div>
        </div>
        <Divider />
        <div onClick={handleTestSB} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, color: 'var(--accent)', fontWeight: 600, fontSize: 15 }}>
            Test Supabase Connection
          </div>
        </div>
      </SettingsGroup>

      <SectionTitle>Secure SQL</SectionTitle>
      <SettingsGroup>
        <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
            Apply this in the Supabase SQL Editor before making the demo public. It enforces
            per-user ownership and private storage access.
          </div>
          <pre
            style={{
              fontSize: 10,
              background: 'var(--bg3)',
              padding: 10,
              borderRadius: 8,
              width: '100%',
              fontFamily: 'monospace',
              lineHeight: 1.75,
              color: 'var(--text2)',
              overflowX: 'auto',
              whiteSpace: 'pre',
            }}
          >
            {SUPABASE_SCHEMA_SQL}
          </pre>
        </div>
      </SettingsGroup>

      <SectionTitle>Appearance</SectionTitle>
      <SettingsGroup>
        <div style={rowStyle}>
          <div style={{ flex: 1, fontSize: 15 }}>Theme</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                style={{
                  padding: '5px 13px',
                  borderRadius: 99,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                  transition: '0.18s',
                  border: `1.5px solid ${theme === t ? 'var(--accent)' : 'var(--border)'}`,
                  background: theme === t ? 'rgba(0,122,255,0.1)' : 'var(--bg3)',
                  color: theme === t ? 'var(--accent)' : 'var(--text3)',
                }}
              >
                {t === 'light' ? '☀️ Light' : '🌙 Dark'}
              </button>
            ))}
          </div>
        </div>
      </SettingsGroup>

      <SectionTitle>Data</SectionTitle>
      <SettingsGroup>
        <div onClick={() => backupToJSON(contacts)} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>Backup Contacts</div>
          <div style={{ color: 'var(--accent)' }}>⬇</div>
        </div>
        <Divider />
        <div onClick={() => restoreInputRef.current?.click()} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15 }}>Restore from File</div>
          <div style={{ color: 'var(--accent)' }}>⬆</div>
        </div>
        <Divider />
        <div onClick={handleClearAll} style={{ ...rowStyle, cursor: 'pointer' }}>
          <div style={{ flex: 1, fontSize: 15, color: 'var(--danger)' }}>Clear Local Data</div>
        </div>
      </SettingsGroup>

      <input
        ref={restoreInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleRestore}
      />
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: 'var(--text3)',
        fontWeight: 600,
        padding: '14px 16px 5px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}
    >
      {children}
    </div>
  )
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--bg2)',
        borderTop: '1px solid var(--border2)',
        borderBottom: '1px solid var(--border2)',
      }}
    >
      {children}
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border2)', marginLeft: 16 }} />
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '13px 16px',
}

const actionButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  padding: '13px 18px',
  borderRadius: 10,
  border: 'none',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
  background: 'var(--accent)',
  color: '#fff',
}

const dangerButtonStyle: React.CSSProperties = {
  ...actionButtonStyle,
  background: 'var(--danger)',
}

function ChecklistItem({
  label,
  ok,
  pending,
  optional = false,
  manual,
}: {
  label: string
  ok: boolean
  pending: boolean
  optional?: boolean
  manual?: string
}) {
  const statusText = manual
    ? manual
    : pending
    ? 'Checking...'
    : ok
    ? 'Ready'
    : optional
    ? 'Optional'
    : 'Needs attention'

  const statusColor = manual
    ? 'var(--text3)'
    : pending
    ? 'var(--text3)'
    : ok
    ? 'var(--ok, #2e7d32)'
    : optional
    ? 'var(--text3)'
    : 'var(--danger)'

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 10,
        background: 'var(--bg3)',
      }}
    >
      <div style={{ fontSize: 14, color: 'var(--text2)' }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: statusColor }}>{statusText}</div>
    </div>
  )
}
