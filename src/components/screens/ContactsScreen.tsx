import { useRef, useState, useMemo, useEffect, type CSSProperties } from 'react'
import {
  ArrowUpRight,
  Bell,
  Calendar,
  Check,
  CircleAlert,
  ChevronDown,
  Clock,
  ContactRound,
  Handshake,
  History,
  Loader2,
  MapPin,
  MessageSquare,
  Package,
  Phone,
  Search,
  Star,
  X,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { initials, phoneKey, sortContactsAlphabetically } from '../../lib/utils'
import { Contact } from '../../types/contact'
import { getUserPosition, geocodeContacts, formatDistance, LocationError } from '../../lib/geocode'
import { isLocationAccessEnabled } from '../../lib/locationAccess'
import { normalizeStateValue } from '../../lib/usStates'
import { loadImages } from '../../lib/imageStore'

function useFollowups(contacts: Contact[]) {
  return useMemo(() => {
    const now = new Date()
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const overdue = contacts.filter((c) => c.followup_at && new Date(c.followup_at) < now)
    const dueSoon = contacts.filter((c) => {
      if (!c.followup_at) return false
      const d = new Date(c.followup_at)
      return d >= now && d <= weekAhead
    })
    return { overdue, dueSoon }
  }, [contacts])
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
  const detailContactId = useStore((s) => s.detailContactId)
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
    if (!isLocationAccessEnabled()) {
      showToast('Settings → Near Me (Location) → tap Enable, then Allow', 6000)
      return
    }

    setNearMeLoading(true)
    try {
      const pos = await getUserPosition()
      setNearMeActive(true)
      await geocodeContacts(contacts, pos, (d) => setDistances(new Map(d)))
    } catch (err) {
      if (err instanceof LocationError && err.code === 'https') {
        showToast('Location needs HTTPS. Open the live site, not a file preview.', 5000)
      } else if (err instanceof LocationError && err.code === 'denied') {
        showToast('Settings → Near Me (Location) → Enable → Allow', 6000)
      } else if (err instanceof LocationError && err.code === 'timeout') {
        showToast('Location timed out. Try again outdoors or with Wi‑Fi on.', 5000)
      } else {
        showToast(
          `${err instanceof Error ? err.message : 'Could not get location'}. Try again near a window or with Wi‑Fi on.`,
          5000,
        )
      }
    } finally {
      setNearMeLoading(false)
    }
  }

  const states = useMemo(() => [...new Set(contacts.map((c) => normalizeStateValue(c.state)).filter(Boolean))].sort(), [contacts])
  const cities = useMemo(() => {
    const source = filterState ? contacts.filter((c) => normalizeStateValue(c.state) === filterState) : contacts
    return [...new Set(source.map((c) => c.city).filter(Boolean))].sort()
  }, [contacts, filterState])
  const areas = useMemo(() => [...new Set(contacts.map((c) => c.area).filter(Boolean))].sort(), [contacts])
  const starCounts = useMemo(() => {
    const counts = new Map<number, number>([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ])
    contacts.forEach((contact) => {
      if (contact.stars >= 1 && contact.stars <= 4) {
        counts.set(contact.stars, (counts.get(contact.stars) ?? 0) + 1)
      }
    })
    return counts
  }, [contacts])
  const stateCounts = useMemo(() => {
    const counts = new Map<string, number>()
    contacts.forEach((contact) => {
      const state = normalizeStateValue(contact.state)
      if (!state) return
      counts.set(state, (counts.get(state) ?? 0) + 1)
    })
    return counts
  }, [contacts])
  const cityCounts = useMemo(() => {
    const counts = new Map<string, number>()
    const source = filterState ? contacts.filter((c) => normalizeStateValue(c.state) === filterState) : contacts
    source.forEach((contact) => {
      if (!contact.city) return
      counts.set(contact.city, (counts.get(contact.city) ?? 0) + 1)
    })
    return counts
  }, [contacts, filterState])
  const areaCounts = useMemo(() => {
    const counts = new Map<string, number>()
    contacts.forEach((contact) => {
      if (!contact.area) return
      counts.set(contact.area, (counts.get(contact.area) ?? 0) + 1)
    })
    return counts
  }, [contacts])
  const customerCount = useMemo(() => contacts.filter((c) => c.is_customer).length, [contacts])
  const goodsShownCount = useMemo(() => contacts.filter((c) => c.visited).length, [contacts])
  const oldCustomerCount = useMemo(() => contacts.filter((c) => c.is_old_customer).length, [contacts])

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

  const baseFiltered = useMemo(() => contacts.filter((c) => {
    if (filterStars > 0 && c.stars !== filterStars) return false
    if (filterState && normalizeStateValue(c.state) !== filterState) return false
    if (filterCity && c.city !== filterCity) return false
    if (filterArea && c.area !== filterArea) return false
    if (filterType === 'customer' && !c.is_customer) return false
    if (filterType === 'goods_shown' && !c.visited) return false
    if (filterType === 'old_customer' && !c.is_old_customer) return false
    if (query) {
      const q = query.toLowerCase()
      const hay = [c.name, c.company, c.email, c.phone_mobile, c.phone_work, c.city].join(' ').toLowerCase()
      const textMatch = hay.includes(q)

      const qDigits = phoneKey(query)
      const phoneMatch = qDigits.length >= 3
        && [c.phone_mobile, c.phone_work, c.phone_fax].some((p) => phoneKey(p).includes(qDigits))

      if (!textMatch && !phoneMatch) return false
    }
    return true
  }), [contacts, filterStars, filterState, filterCity, filterArea, filterType, query])

  const filtered = useMemo(() => (
    nearMeActive
      ? [...baseFiltered].sort((a, b) => {
          const da = distances.get(a.id) ?? Infinity
          const db = distances.get(b.id) ?? Infinity
          return da - db
        })
      : sortContactsAlphabetically(baseFiltered)
  ), [baseFiltered, nearMeActive, distances])

  const hasFilters = filterStars > 0 || filterState || filterCity || filterArea || filterType

  const onStateChange = (nextState: string) => {
    setFilterState(nextState)
    if (filterCity) {
      const cityStillValid = contacts.some((c) => c.city === filterCity && normalizeStateValue(c.state) === nextState)
      if (!nextState || !cityStillValid) {
        setFilterCity('')
      }
    }
  }

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
            placeholder="Search by name, company, or phone..."
            style={{ width: '100%', padding: '9px 36px 9px 36px',
              background: 'var(--bg3)', border: 'none', borderRadius: 10,
              fontSize: 15, color: 'var(--text)' }} />
          {query && (
            <button type="button" onClick={() => setQuery('')} style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              width: 20, height: 20, borderRadius: '50%',
              background: 'var(--text3)', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--bg)', padding: 0,
            }} aria-label="Clear search">
              <X size={12} strokeWidth={3} />
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={filterStars} onChange={(e) => setFilterStars(Number(e.target.value))}
            style={{ ...dropdownStyle(filterStars > 0), flex: 0.8 }}>
            <option value={0}>Stars</option>
            <option value={1}>1 star ({starCounts.get(1) ?? 0})</option>
            <option value={2}>2 stars ({starCounts.get(2) ?? 0})</option>
            <option value={3}>3 stars ({starCounts.get(3) ?? 0})</option>
            <option value={4}>4 stars ({starCounts.get(4) ?? 0})</option>
          </select>
          <select value={filterState} onChange={(e) => onStateChange(e.target.value)}
            style={{ ...dropdownStyle(!!filterState), flex: 0.6 }}>
            <option value="">ST</option>
            {states.map((s) => <option key={s} value={s}>{s} ({stateCounts.get(s) ?? 0})</option>)}
          </select>
          <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)}
            style={{ ...dropdownStyle(!!filterCity), flex: 1.6, minWidth: 0 }}>
            <option value="">City</option>
            {cities.map((c) => <option key={c} value={c}>{c} ({cityCounts.get(c) ?? 0})</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select value={filterArea} onChange={(e) => setFilterArea(e.target.value)}
            style={{ ...dropdownStyle(!!filterArea), flex: 1 }}>
            <option value="">Area</option>
            {areas.map((a) => <option key={a} value={a}>{a} ({areaCounts.get(a) ?? 0})</option>)}
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
            style={{ ...dropdownStyle(!!filterType), flex: 1 }}>
            <option value="">Type</option>
            <option value="customer">Customer ({customerCount})</option>
            <option value="goods_shown">Goods shown ({goodsShownCount})</option>
            <option value="old_customer">Old customer ({oldCustomerCount})</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={handleNearMe}
            style={{
              flex: 1,
              padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
              fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap',
              border: `1.5px solid ${nearMeActive ? 'var(--chip-success-fg)' : 'var(--border)'}`,
              background: nearMeActive ? 'var(--chip-success-bg)' : 'var(--bg3)',
              color: nearMeActive ? 'var(--chip-success-fg)' : 'var(--text2)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {nearMeLoading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Locating…
              </>
            ) : nearMeActive ? (
              <>
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                Near Me
                <Check className="size-3.5 shrink-0" aria-hidden />
              </>
            ) : (
              <>
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                Near Me
              </>
            )}
          </button>
          {lastAddedId && (
            <button
              type="button"
              onClick={jumpToLastAdded}
              style={{
                flex: 1,
                padding: '7px 12px', borderRadius: 999,
                border: '1.5px solid var(--accent)',
                background: 'var(--chip-accent-bg)',
                color: 'var(--accent)', fontSize: 12, fontWeight: 800,
                cursor: 'pointer', whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Star className="size-3.5 shrink-0 fill-[var(--accent)] text-[var(--accent)]" aria-hidden />
              Last
            </button>
          )}
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={() => { setFilterStars(0); setFilterState(''); setFilterCity(''); setFilterArea(''); setFilterType('') }}
            style={{ alignSelf: 'flex-start', padding: '4px 12px', borderRadius: 99,
              border: '1.5px solid var(--danger)', background: 'transparent',
              color: 'var(--danger)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <X className="size-3.5" aria-hidden />
            Clear filters
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
          <div style={{ fontSize: 44, marginBottom: 12, display: 'flex', justifyContent: 'center', color: 'var(--text3)' }}>
            {contacts.length ? <Search size={44} strokeWidth={1.25} aria-hidden /> : <ContactRound size={44} strokeWidth={1.25} aria-hidden />}
          </div>
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
          {nearMeActive ? 'Nearest first' : 'Contacts A–Z'}
        </div>
      )}

      {filtered.map((c) => (
        <ContactRow key={c.id} contact={c}
          isLastAdded={c.id === lastAddedId}
          selected={c.id === detailContactId}
          distance={nearMeActive ? distances.get(c.id) : undefined}
          onClick={() => setDetailContactId(c.id)}
          onMenu={() => setMenuContactId(c.id)}
          onShareError={(message) => showToast(message)} />
      ))}
    </div>
  )
}

function dropdownStyle(active: boolean): CSSProperties {
  return {
    flex: 1, padding: '8px 6px', borderRadius: 10, fontSize: 11, fontWeight: 600,
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--chip-accent-bg)' : 'var(--bg3)',
    color: active ? 'var(--accent)' : 'var(--text2)',
    cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238e8e93' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center',
    paddingRight: 20,
  }
}

function ContactRow({ contact: c, isLastAdded, selected, distance, onClick, onMenu, onShareError }: {
  contact: Contact
  isLastAdded: boolean
  selected: boolean
  distance?: number
  onClick: () => void
  onMenu: () => void
  onShareError: (message: string) => void
}) {
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [openSide, setOpenSide] = useState<'none' | 'left' | 'right'>('none')
  const startRef = useRef<{ x: number; y: number; swiping: boolean; baseOffset: number } | null>(null)
  const swipeOffsetRef = useRef(0)
  const didSwipeRef = useRef(false)

  // If the hosted photo URL fails (e.g. Supabase Storage temporarily
  // unreachable), fall back to the original scan still cached on this device
  // in IndexedDB — it's saved there at scan time and never deleted, so it
  // often still exists locally even when the cloud copy can't be reached.
  const [imgLoadFailed, setImgLoadFailed] = useState(false)
  const [localFallbackSrc, setLocalFallbackSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!imgLoadFailed || localFallbackSrc) return
    let cancelled = false
    loadImages([`${c.id}_front`]).then((images) => {
      if (cancelled) return
      const cached = images[`${c.id}_front`]
      if (cached) setLocalFallbackSrc(`data:image/jpeg;base64,${cached}`)
    })
    return () => { cancelled = true }
  }, [imgLoadFailed, localFallbackSrc, c.id])

  const shareBusinessCard = async () => {
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

  const sendColdMessage = async () => {
    const recipient = c.phone_mobile || c.phone_work
    if (!recipient) {
      onShareError('No phone number found for this contact')
      return
    }
    const text = contactColdMessageText(c)

    try {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      const separator = isIOS ? '&' : '?'
      const smsUrl = `sms:${recipient}${separator}body=${encodeURIComponent(`${text}\nBrochure: https://drive.google.com/file/d/1ssgiICnmXnYdDsV5VRzgh47hr7Ab4T0u/view?usp=sharing`)}`
      window.location.href = smsUrl
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      onShareError('Could not open Messages')
    }
  }

  const closeSwipe = () => {
    swipeOffsetRef.current = 0
    setOpenSide('none')
    setSwipeOffset(0)
  }

  return (
    <div
      id={`contact-row-${c.id}`}
      style={{
        scrollMarginTop: 170,
        position: 'relative',
        overflow: 'hidden',
        background: selected ? 'var(--chip-accent-bg)' : 'var(--bg2)',
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
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void shareBusinessCard(); closeSwipe() }}
          style={{
            minWidth: 66, height: 54, borderRadius: 16,
            border: 'none', background: 'var(--swipe-btn-bg)',
            color: 'var(--swipe-btn-share-fg)', fontSize: 12, fontWeight: 800, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '0 12px',
          }}
          title="Share"
          aria-label="Share contact card"
        >
          <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
          Share
        </button>
      </div>
      <div
        style={{
          position: 'absolute',
          inset: '0 0 0 auto',
          width: 90,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--swipe-panel-message)',
        }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void sendColdMessage(); closeSwipe() }}
          style={{
            minWidth: 70, height: 54, borderRadius: 16,
            border: 'none', background: 'var(--swipe-btn-bg)',
            color: 'var(--swipe-btn-message-fg)', fontSize: 12, fontWeight: 800, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '0 12px',
          }}
          title="Cold message"
          aria-label="Send cold message"
        >
          <MessageSquare className="size-3.5 shrink-0" aria-hidden />
          Msg
        </button>
      </div>
      <div
        onClick={() => {
          if (didSwipeRef.current || openSide !== 'none') {
            didSwipeRef.current = false
            if (openSide !== 'none') closeSwipe()
            return
          }
          onClick()
        }}
        onPointerDown={(e) => {
          const baseOffset = openSide === 'left' ? 82 : openSide === 'right' ? -90 : 0
          startRef.current = { x: e.clientX, y: e.clientY, swiping: false, baseOffset }
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
          const raw = start.baseOffset + dx
          const overshootDamped = raw > 82 ? 82 + (raw - 82) * 0.2 : raw < -90 ? -90 + (raw + 90) * 0.2 : raw
          const nextOffset = Math.max(-96, Math.min(88, overshootDamped))
          swipeOffsetRef.current = nextOffset
          setSwipeOffset(nextOffset)
        }}
        onPointerUp={() => {
          const current = swipeOffsetRef.current
          const shouldOpenLeft = current > 44
          const shouldOpenRight = current < -44

          // If one side is already open, a swipe toward the opposite side closes first.
          if (openSide === 'left' && shouldOpenRight) {
            swipeOffsetRef.current = 0
            setOpenSide('none')
            setSwipeOffset(0)
          } else if (openSide === 'right' && shouldOpenLeft) {
            swipeOffsetRef.current = 0
            setOpenSide('none')
            setSwipeOffset(0)
          } else if (shouldOpenLeft) {
            swipeOffsetRef.current = 82
            setOpenSide('left')
            setSwipeOffset(82)
          } else if (shouldOpenRight) {
            swipeOffsetRef.current = -90
            setOpenSide('right')
            setSwipeOffset(-90)
          } else {
            swipeOffsetRef.current = 0
            setOpenSide('none')
            setSwipeOffset(0)
          }
          startRef.current = null
        }}
        onPointerCancel={() => {
          if (openSide === 'left') {
            swipeOffsetRef.current = 82
            setSwipeOffset(82)
          } else if (openSide === 'right') {
            swipeOffsetRef.current = -90
            setSwipeOffset(-90)
          } else {
            swipeOffsetRef.current = 0
            setSwipeOffset(0)
          }
          startRef.current = null
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '10px 16px', background: 'var(--bg2)',
          cursor: 'pointer',
          borderLeft: isLastAdded ? '4px solid #ff3b30' : '4px solid transparent',
          transform: `translateX(${openSide === 'left' ? 82 : openSide === 'right' ? -90 : swipeOffset}px)`,
          transition: startRef.current?.swiping ? 'none' : 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)',
          position: 'relative',
          zIndex: 1,
        }}
      >
      {(c.front_image || c.front_thumb_url || c.front_image_url || localFallbackSrc) ? (
        <img
          src={localFallbackSrc || (c.front_image ? `data:image/jpeg;base64,${c.front_image}` : (c.front_thumb_url || c.front_image_url))}
          onError={() => setImgLoadFailed(true)}
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
            <Star
              key={n}
              size={11}
              className="shrink-0"
              fill={c.stars >= n ? 'var(--star)' : 'none'}
              stroke={c.stars >= n ? 'var(--star)' : 'var(--star-empty)'}
              aria-hidden
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
          {distance !== undefined && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '3px 8px', borderRadius: 999,
              background: 'var(--chip-success-bg)', color: 'var(--chip-success-fg)',
              fontSize: 11, fontWeight: 800,
            }}>
              <MapPin className="size-3 shrink-0" aria-hidden />
              {formatDistance(distance)}
            </div>
          )}
          {isLastAdded && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '3px 8px', borderRadius: 999,
              background: 'var(--chip-danger-bg)', color: 'var(--chip-danger-fg)',
              fontSize: 11, fontWeight: 800,
            }}>
              <Star className="size-3 shrink-0 fill-current" aria-hidden />
              Last added
            </div>
          )}
          {c.visited && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '3px 8px', borderRadius: 999,
              background: 'var(--chip-success-bg)', color: 'var(--chip-success-fg)',
              fontSize: 11, fontWeight: 700,
            }}>
              <Package className="size-3 shrink-0" aria-hidden />
              Goods shown
            </div>
          )}
          {c.is_customer && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '3px 8px', borderRadius: 999,
              background: 'var(--chip-accent-bg)', color: 'var(--chip-accent-fg)',
              fontSize: 11, fontWeight: 700,
            }}>
              <Handshake className="size-3 shrink-0" aria-hidden />
              Customer
            </div>
          )}
          {c.is_old_customer && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '3px 8px', borderRadius: 999,
              background: 'var(--chip-warning-bg)', color: 'var(--chip-warning-fg)',
              fontSize: 11, fontWeight: 700,
            }}>
              <History className="size-3 shrink-0" aria-hidden />
              Old customer
            </div>
          )}
          {c.followup_at && (() => {
            const isOverdue = new Date(c.followup_at!) < new Date()
            return (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '3px 8px', borderRadius: 999,
                background: isOverdue ? 'var(--chip-danger-bg)' : 'var(--chip-warning-bg)',
                color: isOverdue ? 'var(--chip-danger-fg)' : 'var(--chip-warning-fg)',
                fontSize: 11, fontWeight: 700,
              }}>
                <Calendar className="size-3 shrink-0" aria-hidden />
                {isOverdue ? 'Overdue' : 'Follow-up'}
              </div>
            )
          })()}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0, paddingLeft: 8 }}>
        {(c.phone_mobile || c.phone_work) && (
          <>
            <button
              type="button"
              className="contact-quick-btn contact-quick-btn--call"
              onClick={(e) => { e.stopPropagation(); window.location.href = `tel:${c.phone_mobile || c.phone_work}` }}
              style={quickBtnStyle('call')}
              title="Call"
            ><Phone size={16} strokeWidth={2.25} aria-hidden /></button>
            <button
              type="button"
              className="contact-quick-btn contact-quick-btn--message"
              onClick={(e) => { e.stopPropagation(); window.location.href = `sms:${c.phone_mobile || c.phone_work}` }}
              style={quickBtnStyle('message')}
              title="Message"
            ><MessageSquare size={16} strokeWidth={2.25} aria-hidden /></button>
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

function contactColdMessageText(contact: Contact): string {
  const company = contact.company || contact.name || 'your company'
  return `Hi ${company},\n\nThis is Amit from Delta Diamonds — we met before.\nWe provide matching pairs, layouts, and single stones across key shapes with quick support for your daily needs.\nHappy to assist with any requirements.`
}

function quickBtnStyle(kind: 'call' | 'message'): CSSProperties {
  const isCall = kind === 'call'
  return {
    width: 34, height: 34, borderRadius: '50%',
    background: isCall ? 'var(--action-call-bg)' : 'var(--action-message-bg)',
    color: isCall ? 'var(--action-call-fg)' : 'var(--action-message-fg)',
    border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, WebkitTapHighlightColor: 'transparent',
  }
}

function FollowupBanner({ overdue, dueSoon, onOpenContact, onEditFollowup }: {
  overdue: Contact[]
  dueSoon: Contact[]
  onOpenContact: (id: string) => void
  onEditFollowup: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const total = overdue.length + dueSoon.length

  const groups = [
    {
      label: 'Overdue',
      labelIcon: <CircleAlert className="size-3 shrink-0" aria-hidden />,
      items: overdue,
      color: 'var(--chip-danger-fg)',
      bg: 'var(--chip-danger-bg)',
    },
    {
      label: 'Due this week',
      labelIcon: <Clock className="size-3 shrink-0" aria-hidden />,
      items: dueSoon,
      color: 'var(--chip-warning-fg)',
      bg: 'var(--chip-warning-bg)',
    },
  ].filter((g) => g.items.length > 0)

  const headerColor = overdue.length > 0 ? 'var(--chip-danger-fg)' : 'var(--chip-warning-fg)'
  const headerBg = overdue.length > 0 ? 'var(--chip-danger-bg)' : 'var(--chip-warning-bg)'

  return (
    <div style={{ borderBottom: '1px solid var(--border2)' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '11px 16px',
          border: 'none',
          background: headerBg,
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Bell className="size-4 shrink-0" style={{ color: headerColor }} aria-hidden />
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: headerColor }}>
              Reminders · {total}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
              {overdue.length > 0 ? `${overdue.length} overdue` : ''}
              {overdue.length > 0 && dueSoon.length > 0 ? ' · ' : ''}
              {dueSoon.length > 0 ? `${dueSoon.length} due this week` : ''}
            </div>
          </div>
        </div>
        <ChevronDown
          className="size-5 shrink-0"
          style={{ color: headerColor, transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
          aria-hidden
        />
      </button>

      {expanded && groups.map((group) => (
        <div key={group.label} style={{ background: group.bg, padding: '8px 16px 6px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: group.color, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            {group.labelIcon}
            {group.label} · {group.items.length}
          </div>
          {group.items.map((c) => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 0', borderTop: '1px solid var(--border2)',
            }}>
              <div onClick={() => onEditFollowup(c.id)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name || c.company || 'Unknown'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>
                  {new Date(c.followup_at!).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  {c.followup_note ? ` · ${c.followup_note}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenContact(c.id)}
                style={{ fontSize: 11, fontWeight: 700, color: group.color, background: 'none', border: `1px solid ${group.color}`, borderRadius: 99, padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                More Info
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
