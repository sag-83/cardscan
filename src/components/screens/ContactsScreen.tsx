import { useEffect, useRef, useState, useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { initials, sortContactsAlphabetically } from '../../lib/utils'
import { Contact } from '../../types/contact'
import { getUserPosition, geocodeContacts, formatDistance } from '../../lib/geocode'
import { getStoreOpenStatus, StoreOpenStatus } from '../../lib/storeHours'

function useFollowups(contacts: Contact[]) {
  const now = new Date()
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const overdue = contacts.filter((c) => c.followup_at && new Date(c.followup_at) < now)
  const dueSoon = contacts.filter((c) => {
    if (!c.followup_at) return false
    const d = new Date(c.followup_at)
    return d >= now && d <= weekAhead
  })
  return { overdue, dueSoon }
}

function useStoreOpenStatuses(contacts: Contact[]) {
  const [statuses, setStatuses] = useState<Map<string, StoreOpenStatus>>(new Map())
  const statusesRef = useRef<Map<string, StoreOpenStatus>>(new Map())
  const refreshingRef = useRef(false)
  const openableContacts = useMemo(
    () => contacts.filter((c) => Boolean(c.company || c.name) && Boolean(c.city || c.address)),
    [contacts]
  )
  const contactIds = useMemo(() => openableContacts.map((c) => c.id).join('|'), [openableContacts])

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      if (refreshingRef.current) return
      refreshingRef.current = true
      const nextStatuses = new Map(statusesRef.current)

      try {
        for (const contact of openableContacts) {
          if (cancelled) return
          const status = await getStoreOpenStatus(contact)
          nextStatuses.set(contact.id, status)
          statusesRef.current = new Map(nextStatuses)
          setStatuses(new Map(nextStatuses))
        }
      } finally {
        refreshingRef.current = false
      }
    }

    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 60_000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [contactIds, openableContacts])

  return statuses
}

export function ContactsScreen() {
  const [query, setQuery] = useState('')
  const [filterStars, setFilterStars] = useState(0)
  const [filterState, setFilterState] = useState('')
  const [filterCity, setFilterCity] = useState('')
  const [filterArea, setFilterArea] = useState('')
  const [filterType, setFilterType] = useState('')

  const [nearMeActive, setNearMeActive] = useState(false)
  const [nearMeLoading, setNearMeLoading] = useState(false)
  const [distances, setDistances] = useState<Map<string, number>>(new Map())

  const contacts = useStore((s) => s.contacts)
  const setDetailContactId = useStore((s) => s.setDetailContactId)
  const setMenuContactId = useStore((s) => s.setMenuContactId)
  const setFollowupContactId = useStore((s) => s.setFollowupContactId)
  const showToast = useStore((s) => s.showToast)

  const { overdue, dueSoon } = useFollowups(contacts)

  const handleNearMe = async () => {
    if (nearMeActive) {
      setNearMeActive(false)
      setDistances(new Map())
      return
    }
    setNearMeLoading(true)
    try {
      const pos = await getUserPosition()
      setNearMeActive(true)
      await geocodeContacts(contacts, pos, (d) => setDistances(new Map(d)))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not get location'
      if (message.includes('HTTPS')) {
        showToast('Location needs HTTPS on iPhone Safari')
      } else if (message.includes('blocked') || message.includes('denied')) {
        showToast('iPhone: Settings > Safari > Location > Allow, then reload')
      } else {
        showToast(`${message}. Try again near a window or turn Wi-Fi on`)
      }
    } finally {
      setNearMeLoading(false)
    }
  }

  const states = useMemo(() => [...new Set(contacts.map((c) => c.state).filter(Boolean))].sort(), [contacts])
  const cities = useMemo(() => [...new Set(contacts.map((c) => c.city).filter(Boolean))].sort(), [contacts])
  const areas = useMemo(() => [...new Set(contacts.map((c) => c.area).filter(Boolean))].sort(), [contacts])

  const lastAddedId = useMemo(() => {
    let newestId: string | null = null
    let newestTime = 0

    contacts.forEach((contact) => {
      const contactTime = Date.parse(contact.created_at || contact.scanned_at || '')
      const safeContactTime = Number.isFinite(contactTime) ? contactTime : 0
      if (!newestId || safeContactTime > newestTime) {
        newestId = contact.id
        newestTime = safeContactTime
      }
    })

    return newestId
  }, [contacts])

  const baseFiltered = contacts.filter((c) => {
    if (filterStars > 0 && c.stars !== filterStars) return false
    if (filterState && c.state !== filterState) return false
    if (filterCity && c.city !== filterCity) return false
    if (filterArea && c.area !== filterArea) return false
    if (filterType === 'customer' && !c.is_customer) return false
    if (filterType === 'goods_shown' && !c.visited) return false
    if (query) {
      const q = query.toLowerCase()
      const hay = [c.name, c.company, c.email, c.phone_mobile, c.phone_work, c.city].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const filtered = nearMeActive
    ? [...baseFiltered].sort((a, b) => {
        const da = distances.get(a.id) ?? Infinity
        const db = distances.get(b.id) ?? Infinity
        return da - db
      })
    : sortContactsAlphabetically(baseFiltered)
  const openStatuses = useStoreOpenStatuses(filtered)

  const hasFilters = filterStars > 0 || filterState || filterCity || filterArea || filterType

  const jumpToLastAdded = () => {
    if (!lastAddedId) return

    setQuery('')
    setFilterStars(0)
    setFilterState('')
    setFilterCity('')
    setFilterArea('')
    setFilterType('')

    window.setTimeout(() => {
      document.getElementById(`contact-row-${lastAddedId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 50)
  }

  return (
    <div>
      <div style={{
        padding: '10px 16px', background: 'var(--bg2)',
        position: 'sticky', top: 53, zIndex: 10,
        borderBottom: '1px solid var(--border2)',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="var(--text3)" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts..."
            style={{ width: '100%', padding: '9px 36px 9px 36px',
              background: 'var(--bg3)', border: 'none', borderRadius: 10,
              fontSize: 15, color: 'var(--text)' }} />
          {query && (
            <button onClick={() => setQuery('')} style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              width: 20, height: 20, borderRadius: '50%',
              background: 'var(--text3)', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--bg)', fontSize: 12, fontWeight: 800, lineHeight: 1,
              padding: 0,
            }}>✕</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={filterStars} onChange={(e) => setFilterStars(Number(e.target.value))}
            style={dropdownStyle(filterStars > 0)}>
            <option value={0}>⭐</option>
            <option value={1}>★ 1</option>
            <option value={2}>★★ 2</option>
            <option value={3}>★★★ 3</option>
            <option value={4}>★★★★ 4</option>
          </select>
          <select value={filterState} onChange={(e) => setFilterState(e.target.value)}
            style={dropdownStyle(!!filterState)}>
            <option value="">📍 ST</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)}
            style={dropdownStyle(!!filterCity)}>
            <option value="">🏙 City</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select value={filterArea} onChange={(e) => setFilterArea(e.target.value)}
            style={{ ...dropdownStyle(!!filterArea), flex: 1 }}>
            <option value="">🗺 Area</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
            style={{ ...dropdownStyle(!!filterType), flex: 1 }}>
            <option value="">🏷 Type</option>
            <option value="customer">🤝 Customer</option>
            <option value="goods_shown">📦 Goods Shown</option>
          </select>
          <button
            onClick={handleNearMe}
            style={{
              padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
              fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap',
              border: `1.5px solid ${nearMeActive ? '#34c759' : 'var(--border)'}`,
              background: nearMeActive ? 'rgba(52,199,89,0.12)' : 'var(--bg3)',
              color: nearMeActive ? '#34c759' : 'var(--text2)',
            }}
          >
            {nearMeLoading ? '⏳ Locating…' : nearMeActive ? '📍 Near Me ✓' : '📍 Near Me'}
          </button>
          {lastAddedId && (
            <button
              onClick={jumpToLastAdded}
              style={{
                padding: '7px 12px', borderRadius: 999,
                border: '1.5px solid var(--accent)',
                background: 'rgba(0,122,255,0.1)',
                color: 'var(--accent)', fontSize: 12, fontWeight: 800,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              ★ Last
            </button>
          )}
        </div>
        {hasFilters && (
          <button onClick={() => { setFilterStars(0); setFilterState(''); setFilterCity(''); setFilterArea(''); setFilterType('') }}
            style={{ alignSelf: 'flex-start', padding: '4px 12px', borderRadius: 99,
              border: '1.5px solid var(--danger)', background: 'transparent',
              color: 'var(--danger)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            ✕ Clear filters
          </button>
        )}
      </div>

      {(overdue.length > 0 || dueSoon.length > 0) && (
        <FollowupBanner
          overdue={overdue}
          dueSoon={dueSoon}
          onOpenContact={setDetailContactId}
          onEditFollowup={setFollowupContactId}
        />
      )}

      {!filtered.length && (
        <div style={{ textAlign: 'center', padding: '70px 24px', color: 'var(--text3)' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>{contacts.length ? '🔍' : '📇'}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>
            {contacts.length ? 'No matches' : 'No contacts yet'}
          </div>
          <div>{contacts.length ? 'Try a different search or filter' : 'Tap Scan to add your first card'}</div>
        </div>
      )}

      {!!filtered.length && (
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)',
          padding: '14px 16px 5px', textTransform: 'uppercase',
          letterSpacing: '0.6px', background: 'var(--bg)' }}>
          {nearMeActive ? '📍 Nearest First' : 'Contacts A-Z'}
        </div>
      )}

      {filtered.map((c) => (
        <ContactRow key={c.id} contact={c}
          isLastAdded={c.id === lastAddedId}
          distance={nearMeActive ? distances.get(c.id) : undefined}
          openStatus={openStatuses.get(c.id)}
          onClick={() => setDetailContactId(c.id)}
          onMenu={() => setMenuContactId(c.id)}
          onShareError={(message) => showToast(message)} />
      ))}
    </div>
  )
}

function dropdownStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '8px 6px', borderRadius: 10, fontSize: 11, fontWeight: 600,
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'rgba(0,122,255,0.08)' : 'var(--bg3)',
    color: active ? 'var(--accent)' : 'var(--text2)',
    cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238e8e93' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center',
    paddingRight: 20,
  }
}

function ContactRow({ contact: c, isLastAdded, distance, openStatus, onClick, onMenu, onShareError }: {
  contact: Contact
  isLastAdded: boolean
  distance?: number
  openStatus?: StoreOpenStatus
  onClick: () => void
  onMenu: () => void
  onShareError: (message: string) => void
}) {
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [shareVisible, setShareVisible] = useState(false)
  const startRef = useRef<{ x: number; y: number; swiping: boolean } | null>(null)
  const swipeOffsetRef = useRef(0)
  const didSwipeRef = useRef(false)

  const shareContact = async () => {
    const text = contactShareText(c)
    const title = c.name || c.company || 'Contact'

    try {
      if (navigator.share) {
        await navigator.share({ title, text })
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        onShareError('Contact copied. Paste it into Messages or WhatsApp')
      } else {
        onShareError('Sharing is not available in this browser')
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      onShareError('Could not open share sheet')
    }
  }

  const closeShare = () => {
    swipeOffsetRef.current = 0
    setShareVisible(false)
    setSwipeOffset(0)
  }

  return (
    <div
      id={`contact-row-${c.id}`}
      style={{
        scrollMarginTop: 170,
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--bg2)',
        borderBottom: '1px solid var(--border2)',
        touchAction: 'pan-y',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '0 auto 0 0',
          width: 82,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--accent)',
        }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); void shareContact(); closeShare() }}
          style={{
            width: 54, height: 54, borderRadius: '50%',
            border: 'none', background: 'rgba(255,255,255,0.95)',
            color: 'var(--accent)', fontSize: 22, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Share"
          aria-label="Share contact"
        >
          ↗
        </button>
      </div>
      <div
        onClick={() => {
          if (didSwipeRef.current || shareVisible) {
            didSwipeRef.current = false
            if (shareVisible) closeShare()
            return
          }
          onClick()
        }}
        onPointerDown={(e) => {
          startRef.current = { x: e.clientX, y: e.clientY, swiping: false }
          didSwipeRef.current = false
        }}
        onPointerMove={(e) => {
          const start = startRef.current
          if (!start) return
          const dx = e.clientX - start.x
          const dy = e.clientY - start.y
          if (!start.swiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) start.swiping = true
          if (!start.swiping) return
          didSwipeRef.current = true
          const nextOffset = Math.max(0, Math.min(82, dx))
          swipeOffsetRef.current = nextOffset
          setSwipeOffset(nextOffset)
        }}
        onPointerUp={() => {
          const shouldOpen = swipeOffsetRef.current > 44
          swipeOffsetRef.current = shouldOpen ? 82 : 0
          setShareVisible(shouldOpen)
          setSwipeOffset(shouldOpen ? 82 : 0)
          startRef.current = null
        }}
        onPointerCancel={() => {
          swipeOffsetRef.current = shareVisible ? 82 : 0
          setSwipeOffset(shareVisible ? 82 : 0)
          startRef.current = null
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '10px 16px', background: 'var(--bg2)',
          cursor: 'pointer',
          borderLeft: isLastAdded ? '4px solid #ff3b30' : '4px solid transparent',
          transform: `translateX(${shareVisible ? 82 : swipeOffset}px)`,
          transition: startRef.current?.swiping ? 'none' : 'transform 160ms ease',
          position: 'relative',
          zIndex: 1,
        }}
      >
      {(c.front_image || c.front_image_url) ? (
        <img src={c.front_image ? `data:image/jpeg;base64,${c.front_image}` : c.front_image_url}
          style={{ width: 90, height: 64, borderRadius: 8, objectFit: 'cover',
            flexShrink: 0, border: '1px solid var(--border2)', background: 'var(--bg3)' }} alt="" />
      ) : (
        <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--hdr)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, fontSize: 16, fontWeight: 800, color: 'rgba(255,255,255,0.9)' }}>
          {initials(c)}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
          {c.name || c.company || 'Unknown'}
        </div>
        {c.title && (
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.title}
          </div>
        )}
        {c.company && c.name && (
          <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.company}
          </div>
        )}
        <div style={{ display: 'flex', gap: 1, marginTop: 3 }}>
          {[1, 2, 3, 4].map((n) => (
            <span key={n} style={{ fontSize: 11, color: c.stars >= n ? 'var(--star)' : 'var(--bg4)' }}>★</span>
          ))}
        </div>
        {openStatus && openStatus.state !== 'unknown' && (
          <StoreOpenPill status={openStatus} />
        )}
        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
          {distance !== undefined && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '3px 8px', borderRadius: 999,
              background: 'rgba(52,199,89,0.12)', color: '#34c759',
              fontSize: 11, fontWeight: 800,
            }}>
              📍 {formatDistance(distance)}
            </div>
          )}
          {isLastAdded && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '3px 8px', borderRadius: 999,
              background: 'rgba(255,59,48,0.12)', color: '#ff3b30',
              fontSize: 11, fontWeight: 800,
            }}>
              ★ Last added
            </div>
          )}
          {c.visited && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '3px 8px', borderRadius: 999,
              background: 'rgba(52,199,89,0.12)', color: '#34c759',
              fontSize: 11, fontWeight: 700,
            }}>
              📦 Goods Shown
            </div>
          )}
          {c.is_customer && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '3px 8px', borderRadius: 999,
              background: 'rgba(0,122,255,0.12)', color: 'var(--accent)',
              fontSize: 11, fontWeight: 700,
            }}>
              🤝 Customer
            </div>
          )}
          {c.followup_at && (() => {
            const isOverdue = new Date(c.followup_at!) < new Date()
            return (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '3px 8px', borderRadius: 999,
                background: isOverdue ? 'rgba(255,59,48,0.12)' : 'rgba(255,149,0,0.12)',
                color: isOverdue ? '#ff3b30' : '#ff9500',
                fontSize: 11, fontWeight: 700,
              }}>
                📅 {isOverdue ? 'Overdue' : 'Follow-up'}
              </div>
            )
          })()}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0, paddingLeft: 8 }}>
        {(c.phone_mobile || c.phone_work) && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); window.location.href = `tel:${c.phone_mobile || c.phone_work}` }}
              style={quickBtnStyle('#e1f0ff')}
              title="Call"
            >📞</button>
            <button
              onClick={(e) => { e.stopPropagation(); window.open(`https://wa.me/${(c.phone_mobile || c.phone_work)!.replace(/[^\d]/g, '')}`, '_blank') }}
              style={quickBtnStyle('#e8f5e9')}
              title="WhatsApp"
            >💬</button>
          </>
        )}
        <div onClick={(e) => { e.stopPropagation(); onMenu() }}
          style={{ color: 'var(--text3)', fontSize: 20, padding: '4px 2px', lineHeight: 1, cursor: 'pointer' }}>
          ···
        </div>
      </div>
      </div>
    </div>
  )
}

function contactShareText(contact: Contact): string {
  const address = [contact.address, contact.city, contact.state, contact.zip, contact.country].filter(Boolean).join(', ')
  const lines = [
    contact.company || contact.name || 'Company',
    contact.phone_mobile || contact.phone_work ? `Number: ${contact.phone_mobile || contact.phone_work}` : '',
    address ? `Address: ${address}` : '',
  ].filter(Boolean)

  return lines.join('\n')
}

function StoreOpenPill({ status }: { status: StoreOpenStatus }) {
  const styles = {
    open: { bg: 'rgba(52,199,89,0.13)', color: '#22a447', dot: '#34c759' },
    closed: { bg: 'rgba(255,59,48,0.12)', color: '#d8342a', dot: '#ff3b30' },
  }[status.state === 'open' || status.state === 'closed' ? status.state : 'closed']

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      marginTop: 5, padding: '4px 9px', borderRadius: 999,
      background: styles.bg, color: styles.color,
      fontSize: 11, fontWeight: 800, lineHeight: 1,
      maxWidth: '100%',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: styles.dot, flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{status.label}</span>
    </div>
  )
}

function quickBtnStyle(bg: string): React.CSSProperties {
  return {
    width: 34, height: 34, borderRadius: '50%',
    background: bg, border: 'none', cursor: 'pointer',
    fontSize: 15, display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexShrink: 0,
    WebkitTapHighlightColor: 'transparent',
  }
}

function FollowupBanner({ overdue, dueSoon, onOpenContact, onEditFollowup }: {
  overdue: Contact[]
  dueSoon: Contact[]
  onOpenContact: (id: string) => void
  onEditFollowup: (id: string) => void
}) {
  const groups = [
    { label: '🔴 Overdue', items: overdue, color: '#ff3b30', bg: 'rgba(255,59,48,0.08)' },
    { label: '🟠 Due this week', items: dueSoon, color: '#ff9500', bg: 'rgba(255,149,0,0.08)' },
  ].filter((g) => g.items.length > 0)

  return (
    <div style={{ borderBottom: '1px solid var(--border2)' }}>
      {groups.map((group) => (
        <div key={group.label} style={{ background: group.bg, padding: '10px 16px 6px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: group.color, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
            {group.label} · {group.items.length}
          </div>
          {group.items.map((c) => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 0', borderTop: '1px solid var(--border2)',
            }}>
              <div onClick={() => onOpenContact(c.id)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name || c.company || 'Unknown'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>
                  {new Date(c.followup_at!).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  {c.followup_note ? ` · ${c.followup_note}` : ''}
                </div>
              </div>
              <button
                onClick={() => onEditFollowup(c.id)}
                style={{ fontSize: 11, fontWeight: 700, color: group.color, background: 'none', border: `1px solid ${group.color}`, borderRadius: 99, padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
