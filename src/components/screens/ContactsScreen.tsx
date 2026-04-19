import { useState, useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { formatDate, initials, groupByDate } from '../../lib/utils'
import { Contact } from '../../types/contact'
import { StoredCardImage } from '../StoredCardImage'

export function ContactsScreen() {
  const [query, setQuery] = useState('')
  const [filterStars, setFilterStars] = useState(0)
  const [filterState, setFilterState] = useState('')
  const [filterCity, setFilterCity] = useState('')

  const contacts = useStore((s) => s.contacts)
  const setDetailContactId = useStore((s) => s.setDetailContactId)
  const setMenuContactId = useStore((s) => s.setMenuContactId)

  const states = useMemo(() => [...new Set(contacts.map((c) => c.state).filter(Boolean))].sort(), [contacts])
  const cities = useMemo(() => [...new Set(contacts.map((c) => c.city).filter(Boolean))].sort(), [contacts])

  const filtered = contacts.filter((c) => {
    if (filterStars > 0 && c.stars !== filterStars) return false
    if (filterState && c.state !== filterState) return false
    if (filterCity && c.city !== filterCity) return false
    if (query) {
      const q = query.toLowerCase()
      const hay = [c.name, c.company, c.email, c.phone_mobile, c.phone_work, c.city].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const hasFilters = filterStars > 0 || filterState || filterCity
  const groups = groupByDate(filtered)
  const sortedDates = Object.keys(groups).sort((a, b) => (b > a ? 1 : -1))

  return (
    <div>
      <div style={{
        padding: '10px 16px', background: 'var(--bg2)',
        position: 'sticky', top: 53, zIndex: 10,
        borderBottom: '1px solid var(--border2)',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="var(--text3)" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts..."
            style={{ width: '100%', padding: '9px 14px 9px 36px',
              background: 'var(--bg3)', border: 'none', borderRadius: 10,
              fontSize: 15, color: 'var(--text)' }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={filterStars} onChange={(e) => setFilterStars(Number(e.target.value))}
            style={dropdownStyle(filterStars > 0)}>
            <option value={0}>⭐ Any Stars</option>
            <option value={1}>★ 1 Star</option>
            <option value={2}>★★ 2 Stars</option>
            <option value={3}>★★★ 3 Stars</option>
            <option value={4}>★★★★ 4 Stars</option>
          </select>
          <select value={filterState} onChange={(e) => setFilterState(e.target.value)}
            style={dropdownStyle(!!filterState)}>
            <option value="">📍 State</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)}
            style={dropdownStyle(!!filterCity)}>
            <option value="">🏙 City</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {hasFilters && (
          <button onClick={() => { setFilterStars(0); setFilterState(''); setFilterCity('') }}
            style={{ alignSelf: 'flex-start', padding: '4px 12px', borderRadius: 99,
              border: '1.5px solid var(--danger)', background: 'transparent',
              color: 'var(--danger)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            ✕ Clear filters
          </button>
        )}
      </div>

      {!filtered.length && (
        <div style={{ textAlign: 'center', padding: '70px 24px', color: 'var(--text3)' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>{contacts.length ? '🔍' : '📇'}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>
            {contacts.length ? 'No matches' : 'No contacts yet'}
          </div>
          <div>{contacts.length ? 'Try a different search or filter' : 'Tap Scan to add your first card'}</div>
        </div>
      )}

      {sortedDates.map((date) => (
        <div key={date}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)',
            padding: '14px 16px 5px', textTransform: 'uppercase',
            letterSpacing: '0.6px', background: 'var(--bg)' }}>
            {formatDate(date)}
          </div>
          {groups[date].map((c) => (
            <ContactRow key={c.id} contact={c}
              onClick={() => setDetailContactId(c.id)}
              onMenu={() => setMenuContactId(c.id)} />
          ))}
        </div>
      ))}
    </div>
  )
}

function dropdownStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '8px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600,
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'rgba(0,122,255,0.08)' : 'var(--bg3)',
    color: active ? 'var(--accent)' : 'var(--text2)',
    cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238e8e93' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
    paddingRight: 24,
  }
}

function ContactRow({ contact: c, onClick, onMenu }: {
  contact: Contact; onClick: () => void; onMenu: () => void
}) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '10px 16px', background: 'var(--bg2)',
      borderBottom: '1px solid var(--border2)', cursor: 'pointer',
    }}>
      {(c.front_image || c.front_image_url) ? (
        <StoredCardImage
          base64={c.front_image}
          storagePath={c.front_image_url}
          alt=""
          style={{ width: 90, height: 64, borderRadius: 8, objectFit: 'cover',
            flexShrink: 0, border: '1px solid var(--border2)', background: 'var(--bg3)' }}
        />
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
      </div>
      <div onClick={(e) => { e.stopPropagation(); onMenu() }}
        style={{ color: 'var(--text3)', fontSize: 22, padding: '8px 2px 8px 10px', lineHeight: 1, flexShrink: 0 }}>
        ···
      </div>
    </div>
  )
}
