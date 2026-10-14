import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Loader2, MapPin, Search } from 'lucide-react'
import { suggestPlaces } from '../lib/placeSuggest'
import type { PlaceSuggestion } from '../lib/geocode'

// Long enough that a normal typing burst produces one request rather than one
// per keystroke, short enough that the list feels like it keeps up.
const DEBOUNCE_MS = 450

interface Props {
  value: string
  onChange: (text: string) => void
  /**
   * Fires with the picked suggestion, or null as soon as the text is edited
   * again. A non-null value means the coordinates are already known and the
   * caller can skip geocoding the text later.
   */
  onResolve: (suggestion: PlaceSuggestion | null) => void
  placeholder?: string
  /** Called on Enter when no suggestion is highlighted. */
  onSubmit?: () => void
  ariaLabel?: string
}

export function AddressAutocomplete({
  value, onChange, onResolve, placeholder, onSubmit, ariaLabel,
}: Props) {
  const [items, setItems] = useState<PlaceSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const abortRef = useRef<AbortController | null>(null)
  const blurTimer = useRef<number | null>(null)
  // The label just picked. Without this the selection immediately triggers a
  // fresh search for its own text and reopens the list under the user.
  const chosenRef = useRef<string | null>(null)

  useEffect(() => () => {
    abortRef.current?.abort()
    if (blurTimer.current) window.clearTimeout(blurTimer.current)
  }, [])

  useEffect(() => {
    const query = value.trim()
    if (chosenRef.current === query || query.length < 3) {
      setItems([])
      setLoading(false)
      return
    }

    setLoading(true)
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const found = await suggestPlaces(query, controller.signal)
        if (controller.signal.aborted) return
        setItems(found)
        setActiveIndex(-1)
        if (found.length > 0) setOpen(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [value])

  const choose = (suggestion: PlaceSuggestion) => {
    chosenRef.current = suggestion.label
    onChange(suggestion.label)
    onResolve(suggestion)
    setOpen(false)
    setItems([])
    setActiveIndex(-1)
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
        choose(items[activeIndex])
        return
      }
      onSubmit?.()
    }
  }

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
          onFocus={() => { if (items.length > 0) setOpen(true) }}
          onBlur={() => {
            // A click on a suggestion blurs the input first, so closing has to
            // wait for the click to land.
            blurTimer.current = window.setTimeout(() => setOpen(false), 150)
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          style={{
            width: '100%', padding: '10px 34px', borderRadius: 10,
            background: 'var(--bg3)', border: '1.5px solid var(--border)',
            fontSize: 15, color: 'var(--text)',
          }}
        />
        {loading && (
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

      {open && items.length > 0 && (
        <ul
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30,
            margin: 0, padding: 4, listStyle: 'none', maxHeight: 248, overflowY: 'auto',
            background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.28)',
          }}
        >
          {items.map((item, index) => (
            <li key={`${item.label}-${item.point.lat}-${item.point.lng}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(item)}
                style={optionStyle(index === activeIndex)}
              >
                <MapPin
                  className="size-3.5 shrink-0"
                  style={{ marginTop: 2, color: item.exact ? 'var(--accent)' : 'var(--text3)' }}
                  aria-hidden
                />
                <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>{item.label}</span>
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
