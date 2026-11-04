import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Loader2, MapPin, Search, User } from 'lucide-react'
import type { Contact } from '../types/contact'
import type { PlaceSuggestion } from '../lib/geocode'
import {
  resolveTripPlace,
  suggestPlaces,
  type TripPlaceSuggestion,
} from '../lib/placeSuggest'

const DEBOUNCE_MS = 280
const MIN_CHARS = 2

interface Props {
  value: string
  onChange: (text: string) => void
  /**
   * Fires with the picked suggestion, or null as soon as the text is edited
   * again. A non-null value means the coordinates are already known and the
   * caller can skip geocoding the text later.
   */
  onResolve: (suggestion: PlaceSuggestion | null) => void
  /** When set, customer name / company matches appear above map places. */
  contacts?: Contact[]
  placeholder?: string
  /** Called on Enter when no suggestion is highlighted. */
  onSubmit?: () => void
  ariaLabel?: string
}

export function AddressAutocomplete({
  value, onChange, onResolve, contacts = [], placeholder, onSubmit, ariaLabel,
}: Props) {
  const [items, setItems] = useState<TripPlaceSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [searched, setSearched] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const abortRef = useRef<AbortController | null>(null)
  const blurTimer = useRef<number | null>(null)
  // The label just picked. Without this the selection immediately triggers a
  // fresh search for its own text and reopens the list under the user.
  const chosenRef = useRef<string | null>(null)
  const contactsRef = useRef(contacts)
  contactsRef.current = contacts

  useEffect(() => () => {
    abortRef.current?.abort()
    if (blurTimer.current) window.clearTimeout(blurTimer.current)
  }, [])

  useEffect(() => {
    const query = value.trim()
    if (chosenRef.current === query || query.length < MIN_CHARS) {
      setItems([])
      setLoading(false)
      setSearched(false)
      return
    }

    setLoading(true)
    setSearched(false)
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const found = await suggestPlaces(query, controller.signal, contactsRef.current)
        if (controller.signal.aborted) return
        setItems(found)
        setActiveIndex(found.length ? 0 : -1)
        setOpen(true)
        setSearched(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [value])

  const choose = async (suggestion: TripPlaceSuggestion) => {
    setResolving(true)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const resolved = await resolveTripPlace(suggestion, contactsRef.current, controller.signal)
      if (controller.signal.aborted) return
      if (!resolved) {
        // Still fill the text so the user can Plan and let geocodePlace try.
        chosenRef.current = suggestion.label
        onChange(suggestion.subtitle && suggestion.kind === 'contact'
          ? `${suggestion.label}, ${suggestion.subtitle}`
          : suggestion.label)
        onResolve(null)
        setOpen(false)
        setItems([])
        return
      }
      chosenRef.current = resolved.label
      onChange(resolved.label)
      onResolve(resolved)
      setOpen(false)
      setItems([])
      setActiveIndex(-1)
    } finally {
      if (!controller.signal.aborted) setResolving(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && items.length > 0) {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((i) => (i + 1) % items.length)
      return
    }
    if (event.key === 'ArrowUp' && items.length > 0) {
      event.preventDefault()
      setActiveIndex((i) => (i <= 0 ? items.length - 1 : i - 1))
      return
    }
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'Enter') {
      if (open && activeIndex >= 0 && items[activeIndex]) {
        event.preventDefault()
        void choose(items[activeIndex])
        return
      }
      onSubmit?.()
    }
  }

  const showList = open && !resolving && (items.length > 0 || (searched && !loading))

  return (
    <div style={{ position: 'relative', marginTop: 8 }}>
      <div style={{ position: 'relative' }}>
        <Search
          className="size-4"
          style={{
            position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text3)', pointerEvents: 'none',
          }}
          aria-hidden
        />
        <input
          value={value}
          onChange={(event) => {
            chosenRef.current = null
            onChange(event.target.value)
            onResolve(null)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (items.length > 0 || searched) setOpen(true) }}
          onBlur={() => {
            // A click on a suggestion blurs the input first, so closing has to
            // wait for the click to land.
            blurTimer.current = window.setTimeout(() => setOpen(false), 180)
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          disabled={resolving}
          style={{
            width: '100%', padding: '10px 34px', borderRadius: 10,
            background: 'var(--bg3)', border: '1.5px solid var(--border)',
            fontSize: 15, color: 'var(--text)',
            opacity: resolving ? 0.7 : 1,
          }}
        />
        {(loading || resolving) && (
          <Loader2
            className="size-4 animate-spin"
            style={{
              position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--accent)', pointerEvents: 'none',
            }}
            aria-hidden
          />
        )}
      </div>

      {showList && (
        <ul
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30,
            margin: 0, padding: 4, listStyle: 'none', maxHeight: 280, overflowY: 'auto',
            background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.28)',
          }}
        >
          {items.length === 0 ? (
            <li style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text3)', fontWeight: 600 }}>
              No matches — try a fuller address, city + state, or a customer name
            </li>
          ) : items.map((item, index) => (
            <li key={`${item.kind}-${item.contactId || item.placeId || item.label}-${index}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void choose(item)}
                style={optionStyle(index === activeIndex)}
              >
                {item.kind === 'contact' ? (
                  <User
                    className="size-3.5 shrink-0"
                    style={{ marginTop: 2, color: 'var(--accent)' }}
                    aria-hidden
                  />
                ) : (
                  <MapPin
                    className="size-3.5 shrink-0"
                    style={{ marginTop: 2, color: item.exact ? 'var(--accent)' : 'var(--text3)' }}
                    aria-hidden
                  />
                )}
                <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>
                  <span style={{ display: 'block' }}>{item.label}</span>
                  {item.subtitle && (
                    <span style={{
                      display: 'block', marginTop: 2, fontSize: 11.5,
                      fontWeight: 600, color: 'var(--text3)',
                    }}>
                      {item.kind === 'contact' ? `Customer · ${item.subtitle}` : item.subtitle}
                    </span>
                  )}
                  {item.kind === 'contact' && !item.subtitle && (
                    <span style={{
                      display: 'block', marginTop: 2, fontSize: 11.5,
                      fontWeight: 600, color: 'var(--text3)',
                    }}>
                      Customer
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function optionStyle(active: boolean): CSSProperties {
  return {
    width: '100%', display: 'flex', gap: 8, alignItems: 'flex-start',
    padding: '9px 10px', borderRadius: 8, border: 'none', textAlign: 'left',
    background: active ? 'var(--bg4)' : 'transparent',
    color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  }
}
