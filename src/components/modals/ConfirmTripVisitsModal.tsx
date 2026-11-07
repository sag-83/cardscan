import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { TripPlan } from '../../lib/tripPlanner'
import { stopAddressText } from '../../lib/tripPlanner'

interface Props {
  plan: TripPlan
  onClose: () => void
  onConfirm: (visitedIds: string[]) => void
}

/**
 * End-of-day checklist. Everything starts checked — uncheck who you missed
 * or skipped. The confirmed set becomes the trip log that tomorrow's plan
 * will omit.
 */
export function ConfirmTripVisitsModal({ plan, onClose, onConfirm }: Props) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(plan.stops.map((s) => s.contact.id)),
  )

  useEffect(() => {
    setChecked(new Set(plan.stops.map((s) => s.contact.id)))
  }, [plan])

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visitedCount = checked.size
  const skippedCount = plan.stops.length - visitedCount

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm today's visits"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520, maxHeight: '88vh',
          background: 'var(--bg)', borderRadius: '18px 18px 0 0',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{
          padding: '16px 18px 12px', borderBottom: '1px solid var(--border2)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>
              Log today's visits
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 4, lineHeight: 1.45 }}>
              Uncheck anyone you didn't make it to. Logged stops won't be suggested again
              when you plan this area tomorrow.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none', background: 'var(--bg3)', borderRadius: 99,
              width: 32, height: 32, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text3)',
            }}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 10px 12px' }}>
          {plan.stops.map((stop, index) => {
            const id = stop.contact.id
            const on = checked.has(id)
            const title = stop.contact.company || stop.contact.name || 'Contact'
            const sub = stop.contact.company && stop.contact.name
              ? stop.contact.name
              : stopAddressText(stop)
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                style={{
                  width: '100%', display: 'flex', gap: 12, alignItems: 'flex-start',
                  padding: '11px 10px', borderRadius: 12, border: 'none',
                  background: on ? 'var(--chip-success-bg)' : 'transparent',
                  textAlign: 'left', cursor: 'pointer', marginBottom: 2,
                }}
              >
                <div style={{
                  width: 26, height: 26, borderRadius: 8, flexShrink: 0, marginTop: 1,
                  border: on ? 'none' : '1.5px solid var(--border)',
                  background: on ? 'var(--chip-success-fg)' : 'var(--bg3)',
                  color: on ? '#fff' : 'var(--text3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800,
                }}>
                  {on ? <Check className="size-3.5" aria-hidden /> : index + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 750,
                    color: on ? 'var(--text)' : 'var(--text3)',
                    textDecoration: on ? 'none' : 'line-through',
                  }}>
                    {title}
                  </div>
                  {sub && (
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                      {sub}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <div style={{
          padding: '12px 16px calc(14px + env(safe-area-inset-bottom))',
          borderTop: '1px solid var(--border2)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 12.5, color: 'var(--text3)', fontWeight: 600 }}>
            {visitedCount} visited
            {skippedCount > 0 ? ` · ${skippedCount} left for another day` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setChecked(new Set(plan.stops.map((s) => s.contact.id)))}
              style={{
                flex: 0, padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                border: '1.5px solid var(--border)', background: 'var(--bg2)',
                color: 'var(--text2)', fontSize: 13, fontWeight: 750,
              }}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setChecked(new Set())}
              style={{
                flex: 0, padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                border: '1.5px solid var(--border)', background: 'var(--bg2)',
                color: 'var(--text2)', fontSize: 13, fontWeight: 750,
              }}
            >
              None
            </button>
            <button
              type="button"
              onClick={() => onConfirm([...checked])}
              style={{
                flex: 1, padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                border: 'none', background: 'var(--accent)',
                color: '#fff', fontSize: 14, fontWeight: 800,
              }}
            >
              Save log
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
