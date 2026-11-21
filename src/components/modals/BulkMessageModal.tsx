import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Check, Copy, Mail, MessageSquare, X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { normalizeStateValue } from '../../lib/usStates'
import { buildContactFilterFacets } from '../../lib/contactFilterFacets'
import {
  loadBulkEmailBody,
  loadBulkEmailSubject,
  loadBulkSmsBody,
  saveBulkEmailBody,
  saveBulkEmailSubject,
  saveBulkSmsBody,
} from '../../lib/outreachTemplates'
import type { Contact } from '../../types/contact'

type FilterType = '' | 'customer' | 'goods_shown' | 'old_customer'

export function BulkMessageModal() {
  const bulkMessageType = useStore((s) => s.bulkMessageType)
  const setBulkMessageType = useStore((s) => s.setBulkMessageType)
  const contacts = useStore((s) => (s.bulkMessageType ? s.contacts : null))
  const selectedIds = useStore((s) => (s.bulkMessageType ? s.selectedIds : null))
  const showToast = useStore((s) => s.showToast)

  const [filterStars, setFilterStars] = useState(0)
  const [filterState, setFilterState] = useState('')
  const [filterCity, setFilterCity] = useState('')
  const [filterArea, setFilterArea] = useState('')
  const [filterType, setFilterType] = useState<FilterType>('')
  const [subject, setSubject] = useState(loadBulkEmailSubject)
  const [emailBody, setEmailBody] = useState(loadBulkEmailBody)
  const [smsBody, setSmsBody] = useState(loadBulkSmsBody)

  useEffect(() => {
    if (!bulkMessageType) return
    setFilterStars(0)
    setFilterState('')
    setFilterCity('')
    setFilterArea('')
    setFilterType('')
    setSubject(loadBulkEmailSubject())
    setEmailBody(loadBulkEmailBody())
    setSmsBody(loadBulkSmsBody())
  }, [bulkMessageType])

  useEffect(() => {
    if (bulkMessageType !== 'email') return
    saveBulkEmailSubject(subject)
  }, [bulkMessageType, subject])

  useEffect(() => {
    if (bulkMessageType !== 'email') return
    saveBulkEmailBody(emailBody)
  }, [bulkMessageType, emailBody])

  useEffect(() => {
    if (bulkMessageType !== 'sms') return
    saveBulkSmsBody(smsBody)
  }, [bulkMessageType, smsBody])

  if (!bulkMessageType || !contacts || !selectedIds) return null

  const pool = selectedIds.length
    ? contacts.filter((c) => selectedIds.includes(c.id))
    : contacts

  const close = () => setBulkMessageType(null)

  return (
    <OutreachSheet
      mode={bulkMessageType}
      pool={pool}
      selectedCount={selectedIds.length}
      filterStars={filterStars}
      filterState={filterState}
      filterCity={filterCity}
      filterArea={filterArea}
      filterType={filterType}
      onStars={setFilterStars}
      onState={(next) => {
        setFilterState(next)
        if (filterCity) {
          const stillValid = pool.some(
            (c) => c.city === filterCity && (!next || normalizeStateValue(c.state) === next),
          )
          if (!next || !stillValid) setFilterCity('')
        }
        if (filterArea) {
          const stillValid = pool.some(
            (c) => c.area === filterArea && (!next || normalizeStateValue(c.state) === next),
          )
          if (!next || !stillValid) setFilterArea('')
        }
      }}
      onCity={setFilterCity}
      onArea={setFilterArea}
      onType={setFilterType}
      subject={subject}
      onSubject={setSubject}
      emailBody={emailBody}
      onEmailBody={setEmailBody}
      smsBody={smsBody}
      onSmsBody={setSmsBody}
      onClose={close}
      showToast={showToast}
    />
  )
}

function OutreachSheet({
  mode,
  pool,
  selectedCount,
  filterStars,
  filterState,
  filterCity,
  filterArea,
  filterType,
  onStars,
  onState,
  onCity,
  onArea,
  onType,
  subject,
  onSubject,
  emailBody,
  onEmailBody,
  smsBody,
  onSmsBody,
  onClose,
  showToast,
}: {
  mode: 'email' | 'sms'
  pool: Contact[]
  selectedCount: number
  filterStars: number
  filterState: string
  filterCity: string
  filterArea: string
  filterType: FilterType
  onStars: (v: number) => void
  onState: (v: string) => void
  onCity: (v: string) => void
  onArea: (v: string) => void
  onType: (v: FilterType) => void
  subject: string
  onSubject: (v: string) => void
  emailBody: string
  onEmailBody: (v: string) => void
  smsBody: string
  onSmsBody: (v: string) => void
  onClose: () => void
  showToast: (msg: string, durationMs?: number) => void
}) {
  const filterDims = useMemo(() => ({
    stars: filterStars,
    state: filterState,
    city: filterCity,
    area: filterArea,
    type: filterType,
    query: '',
  }), [filterStars, filterState, filterCity, filterArea, filterType])

  const {
    states,
    cities,
    areas,
    starCounts,
    stateCounts,
    cityCounts,
    areaCounts,
    customerCount,
    goodsShownCount,
    oldCustomerCount,
  } = useMemo(
    () => buildContactFilterFacets(pool, filterDims),
    [pool, filterDims],
  )

  useEffect(() => {
    if (filterArea && !areas.includes(filterArea)) onArea('')
    if (filterCity && !cities.includes(filterCity)) onCity('')
  }, [areas, cities, filterArea, filterCity, onArea, onCity])

  const filtered = useMemo(
    () => pool.filter((c) => {
      if (filterStars > 0 && c.stars !== filterStars) return false
      if (filterState && normalizeStateValue(c.state) !== filterState) return false
      if (filterCity && c.city !== filterCity) return false
      if (filterArea && c.area !== filterArea) return false
      if (filterType === 'customer' && !c.is_customer) return false
      if (filterType === 'goods_shown' && !c.visited) return false
      if (filterType === 'old_customer' && !c.is_old_customer) return false
      return true
    }),
    [pool, filterStars, filterState, filterCity, filterArea, filterType],
  )

  const withEmail = useMemo(
    () => filtered.filter((c) => collectEmails(c).length > 0),
    [filtered],
  )
  const withPhone = useMemo(
    () => filtered.filter((c) => !!(c.phone_mobile || c.phone_work)),
    [filtered],
  )

  const emailList = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const c of withEmail) {
      for (const email of collectEmails(c)) {
        const key = email.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(email)
      }
    }
    return out
  }, [withEmail])

  const phoneRows = useMemo(() => withPhone.map((c) => ({
    id: c.id,
    label: c.company || c.name || 'Unknown',
    phone: c.phone_mobile || c.phone_work,
  })), [withPhone])

  const phoneListText = phoneRows.map((r) => `${r.label}\t${r.phone}`).join('\n')
  const phoneOnlyText = phoneRows.map((r) => r.phone).join('\n')
  /** Comma-separated — paste straight into Gmail Bcc / Cc. */
  const emailPasteText = emailList.join(', ')

  const hasFilters = filterStars > 0 || !!filterState || !!filterCity || !!filterArea || !!filterType

  const copyText = async (text: string, ok: string) => {
    if (!text.trim()) {
      showToast('Nothing to copy')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      showToast(ok)
    } catch {
      showToast('Could not copy — select and copy manually')
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'var(--modal-bg)',
        zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'fadeIn 0.18s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg2)', borderRadius: '22px 22px 0 0',
          width: '100%', maxWidth: 560, maxHeight: '92vh',
          display: 'flex', flexDirection: 'column',
          animation: 'sheetUp 0.3s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        <div style={{ padding: '16px 16px 0', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 4,
            background: 'var(--bg4)', margin: '0 auto 14px' }} />
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                {mode === 'email'
                  ? <Mail className="size-[18px] shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
                  : <MessageSquare className="size-[18px] shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />}
                Bulk {mode === 'email' ? 'Email' : 'iMessage list'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4, lineHeight: 1.4 }}>
                {selectedCount
                  ? `Starting from ${selectedCount} selected · `
                  : 'All contacts · '}
                same filters as Contacts. Copy each piece, then paste into Gmail or iMessage yourself
                (works with multiple accounts).
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 36, height: 36, borderRadius: '50%', border: 'none',
                background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              <X size={18} strokeWidth={2.25} />
            </button>
          </div>
        </div>

        <div style={{ padding: '12px 16px 28px', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <select
              value={filterStars}
              onChange={(e) => onStars(Number(e.target.value))}
              style={{ ...dropdownStyle(filterStars > 0), flex: 0.8 }}
            >
              <option value={0}>Stars</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{'★'.repeat(n)} ({starCounts.get(n) ?? 0})</option>
              ))}
            </select>
            <select
              value={filterState}
              onChange={(e) => onState(e.target.value)}
              style={{ ...dropdownStyle(!!filterState), flex: 1 }}
            >
              <option value="">ST</option>
              {states.map((s) => (
                <option key={s} value={s}>{s} ({stateCounts.get(s) ?? 0})</option>
              ))}
            </select>
            <select
              value={filterCity}
              onChange={(e) => onCity(e.target.value)}
              style={{ ...dropdownStyle(!!filterCity), flex: 1.2 }}
            >
              <option value="">City</option>
              {cities.map((city) => (
                <option key={city} value={city}>{city} ({cityCounts.get(city) ?? 0})</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <select
              value={filterArea}
              onChange={(e) => onArea(e.target.value)}
              style={{ ...dropdownStyle(!!filterArea), flex: 1 }}
            >
              <option value="">Area</option>
              {areas.map((a) => (
                <option key={a} value={a}>{a} ({areaCounts.get(a) ?? 0})</option>
              ))}
            </select>
            <select
              value={filterType}
              onChange={(e) => onType(e.target.value as FilterType)}
              style={{ ...dropdownStyle(!!filterType), flex: 1 }}
            >
              <option value="">Type</option>
              <option value="customer">Customers ({customerCount})</option>
              <option value="goods_shown">Goods shown ({goodsShownCount})</option>
              <option value="old_customer">Old customers ({oldCustomerCount})</option>
            </select>
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                onStars(0)
                onState('')
                onCity('')
                onArea('')
                onType('')
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 10,
                padding: '4px 10px', borderRadius: 999, border: 'none',
                background: 'var(--chip-danger-bg, rgba(255,59,48,0.12))',
                color: 'var(--danger, #ff3b30)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              <X size={12} strokeWidth={3} /> Clear filters
            </button>
          )}

          <div style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 12,
            background: 'var(--chip-accent-bg)', border: '1px solid var(--border2)',
            fontSize: 13, fontWeight: 700, color: 'var(--accent)',
          }}>
            {mode === 'email'
              ? `${emailList.length} email${emailList.length === 1 ? '' : 's'} ready`
                + (filtered.length > withEmail.length
                  ? ` · ${filtered.length - withEmail.length} skipped (no email)`
                  : '')
              : `${phoneRows.length} number${phoneRows.length === 1 ? '' : 's'} ready`
                + (filtered.length > withPhone.length
                  ? ` · ${filtered.length - withPhone.length} skipped (no phone)`
                  : '')}
            <span style={{ color: 'var(--text3)', fontWeight: 600 }}>
              {' '}· {filtered.length} match filter
            </span>
          </div>

          {mode === 'email' ? (
            <>
              <CopyBlock
                label={`Bcc / Cc emails (${emailList.length})`}
                copyLabel="Copy all emails"
                hint="Paste into Bcc in the Gmail account you want"
                preview={emailPasteText || 'No emails in this filter'}
                previewMaxLines={5}
                disabled={!emailList.length}
                onCopy={() => void copyText(
                  emailPasteText,
                  `${emailList.length} email${emailList.length === 1 ? '' : 's'} copied — paste into Bcc`,
                )}
              />

              <div style={{
                borderRadius: 12, border: '1px solid var(--border2)', overflow: 'hidden',
                maxHeight: 160, overflowY: 'auto', background: 'var(--bg3)', marginBottom: 12,
              }}>
                {emailList.length === 0 ? (
                  <div style={{ padding: 14, fontSize: 13, color: 'var(--text3)' }}>
                    No emails in this filter — shops without email are skipped.
                  </div>
                ) : emailList.map((email) => (
                  <div
                    key={email}
                    style={{
                      padding: '8px 12px', borderBottom: '1px solid var(--border2)',
                      fontSize: 13, fontWeight: 650, color: 'var(--accent)',
                      wordBreak: 'break-all',
                    }}
                  >
                    {email}
                  </div>
                ))}
              </div>

              <label style={labelStyle}>Subject · saved</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 11 }}>
                <input
                  value={subject}
                  onChange={(e) => onSubject(e.target.value)}
                  style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
                />
                <button
                  type="button"
                  onClick={() => void copyText(subject, 'Subject copied')}
                  style={{ ...iconCopyBtn }}
                  aria-label="Copy subject"
                >
                  <Copy size={16} strokeWidth={2.25} />
                </button>
              </div>

              <label style={labelStyle}>Body · saved · attach brochure after you paste</label>
              <textarea
                value={emailBody}
                onChange={(e) => onEmailBody(e.target.value)}
                rows={8}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 140, marginBottom: 8 }}
              />
              <button
                type="button"
                onClick={() => void copyText(emailBody, 'Body copied — paste into Gmail, attach brochure')}
                style={{ ...secondaryBtn, marginBottom: 4 }}
              >
                <Copy size={16} strokeWidth={2.25} aria-hidden />
                Copy body
              </button>
            </>
          ) : (
            <>
              <label style={labelStyle}>iMessage text · saved</label>
              <textarea
                value={smsBody}
                onChange={(e) => onSmsBody(e.target.value)}
                rows={6}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 120, marginBottom: 8 }}
              />
              <button
                type="button"
                onClick={() => void copyText(smsBody, 'Message copied — paste into iMessage, attach brochure')}
                style={{ ...secondaryBtn, marginBottom: 12 }}
              >
                <Copy size={16} strokeWidth={2.25} aria-hidden />
                Copy message text
              </button>

              <CopyBlock
                label={`Phone numbers (${phoneRows.length})`}
                copyLabel="Copy all numbers"
                hint="Paste into a note or Messages on your phone"
                preview={phoneOnlyText || 'No numbers in this filter'}
                previewMaxLines={4}
                disabled={!phoneRows.length}
                onCopy={() => void copyText(phoneOnlyText, `${phoneRows.length} number${phoneRows.length === 1 ? '' : 's'} copied`)}
              />

              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => void copyText(phoneListText, 'Name + number list copied')}
                  disabled={!phoneRows.length}
                  style={{ ...secondaryBtn, flex: 1, opacity: phoneRows.length ? 1 : 0.5 }}
                >
                  <Copy size={16} strokeWidth={2.25} aria-hidden />
                  Copy name + number
                </button>
              </div>

              <div style={{
                borderRadius: 12, border: '1px solid var(--border2)', overflow: 'hidden',
                maxHeight: 240, overflowY: 'auto', background: 'var(--bg3)',
              }}>
                {phoneRows.length === 0 ? (
                  <div style={{ padding: 14, fontSize: 13, color: 'var(--text3)' }}>
                    No phone numbers in this filter.
                  </div>
                ) : phoneRows.map((row) => (
                  <div
                    key={row.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderBottom: '1px solid var(--border2)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 700, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {row.label}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 650 }}>
                        {row.phone}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyText(row.phone, 'Number copied')}
                      aria-label={`Copy ${row.phone}`}
                      style={iconCopyBtn}
                    >
                      <Copy size={14} strokeWidth={2.25} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{
            marginTop: 12, fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.45,
            display: 'flex', alignItems: 'flex-start', gap: 6,
          }}>
            <Check size={14} strokeWidth={2.5} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
            Copy → open the right Gmail/iMessage account yourself → paste → attach brochure → send.
            Message edits stay saved after refresh.
          </div>
        </div>
      </div>
    </div>
  )
}

function CopyBlock({
  label,
  copyLabel,
  hint,
  preview,
  previewMaxLines = 4,
  disabled,
  onCopy,
}: {
  label: string
  copyLabel: string
  hint: string
  preview: string
  previewMaxLines?: number
  disabled?: boolean
  onCopy: () => void
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>
        <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{hint}</span>
      </div>
      <div style={{
        padding: '10px 12px', borderRadius: 10, marginBottom: 8,
        background: 'var(--bg3)', border: '1.5px solid var(--border)',
        fontSize: 12.5, color: disabled ? 'var(--text3)' : 'var(--text)',
        lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        maxHeight: previewMaxLines * 18 + 20, overflowY: 'auto',
      }}>
        {preview}
      </div>
      <button
        type="button"
        onClick={onCopy}
        disabled={disabled}
        style={{ ...secondaryBtn, opacity: disabled ? 0.5 : 1 }}
      >
        <Copy size={16} strokeWidth={2.25} aria-hidden />
        {copyLabel}
      </button>
    </div>
  )
}

function collectEmails(c: Contact): string[] {
  const list = [c.email, ...(c.extra_emails ?? [])]
    .map((e) => (e || '').trim())
    .filter(Boolean)
  return list
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

const labelStyle: CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text3)', marginBottom: 5,
  fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '12px 14px', background: 'var(--bg3)',
  border: '1.5px solid var(--border)', borderRadius: 10,
  color: 'var(--text)', fontSize: 15, fontFamily: 'inherit',
}

const secondaryBtn: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 7, padding: '11px 14px', borderRadius: 10,
  border: '1.5px solid var(--border)', background: 'var(--bg3)',
  color: 'var(--text)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', width: '100%',
}

const iconCopyBtn: CSSProperties = {
  width: 44, height: 44, borderRadius: 10, border: '1px solid var(--border)',
  background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}
