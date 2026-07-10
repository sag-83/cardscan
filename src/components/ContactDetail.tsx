import { useState, useEffect, type ReactNode } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Briefcase,
  Calendar,
  FileText,
  Globe,
  Handshake,
  History,
  Image as ImageIcon,
  Loader2,
  Mail,
  Map,
  MapPin,
  MessageCircle,
  Package,
  Pencil,
  Phone,
  Printer,
  Smartphone,
  Star,
  User,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { initials, mUrl } from '../lib/utils'
import { downloadVCard } from '../lib/vcard'
import { saveContactToDB } from '../lib/supabase'
import { sendToGoogleSheets, hasBeenSentToSheets, markContactsSentToSheets } from '../lib/export'
import { IS_DEMO_MODE } from '../lib/demo'
import { useIsDesktop } from '../hooks/useIsDesktop'
import type { Contact } from '../types/contact'

export const DETAIL_PANEL_WIDTH = 440

export function ContactDetail() {
  const isDesktop = useIsDesktop()
  const [isSendingSheets, setIsSendingSheets] = useState(false)
  const detailContactId = useStore((s) => s.detailContactId)
  const contacts = useStore((s) => s.contacts)
  const setDetailContactId = useStore((s) => s.setDetailContactId)
  const setEditModal = useStore((s) => s.setEditModal)
  const setMenuContactId = useStore((s) => s.setMenuContactId)
  const setFollowupContactId = useStore((s) => s.setFollowupContactId)
  const setInvoiceContactId = useStore((s) => s.setInvoiceContactId)
  const updateContact = useStore((s) => s.updateContact)
  const showToast = useStore((s) => s.showToast)

  const contact = contacts.find((c) => c.id === detailContactId)

  useEffect(() => {
    if (detailContactId && !contacts.find((c) => c.id === detailContactId)) {
      setDetailContactId(null)
    }
  }, [contacts, detailContactId, setDetailContactId])

  if (!contact) return null
  const c = contact

  const handleStarCycle = async () => {
    const newStars = c.stars >= 4 ? 0 : c.stars + 1
    if (IS_DEMO_MODE) {
      updateContact(c.id, { stars: newStars })
      showToast('Demo mode: star updated locally')
      return
    }

    const saved = await saveContactToDB({ ...c, stars: newStars })
    if (!saved) {
      showToast('Supabase backup failed — star was not changed')
      return
    }

    updateContact(c.id, { stars: newStars })
  }

  const handleToggleVisited = async () => {
    const next = !c.visited
    if (IS_DEMO_MODE) { updateContact(c.id, { visited: next }); return }
    const saved = await saveContactToDB({ ...c, visited: next })
    if (saved) updateContact(c.id, { visited: next })
    else showToast('Supabase backup failed')
  }

  const handleToggleCustomer = async () => {
    const next = !c.is_customer
    if (IS_DEMO_MODE) { updateContact(c.id, { is_customer: next }); return }
    const saved = await saveContactToDB({ ...c, is_customer: next })
    if (saved) updateContact(c.id, { is_customer: next })
    else showToast('Supabase backup failed')
  }

  const handleToggleOldCustomer = async () => {
    const next = !c.is_old_customer
    if (IS_DEMO_MODE) { updateContact(c.id, { is_old_customer: next }); return }
    const saved = await saveContactToDB({ ...c, is_old_customer: next })
    if (saved) updateContact(c.id, { is_old_customer: next })
    else showToast('Supabase backup failed')
  }

  const handleSaveToPhone = () => {
    downloadVCard(c)
    showToast('Open the .vcf file to save!')
  }

  const handleSendToSheets = async () => {
    if (isSendingSheets) return
    if (hasBeenSentToSheets(c)) {
      showToast('Already sent to Google Sheets')
      return
    }
    if (IS_DEMO_MODE) {
      showToast('Demo mode: this would sync to Google Sheets')
      return
    }

    setIsSendingSheets(true)
    try {
      const sent = await sendToGoogleSheets([c])
      if (sent) {
        markContactsSentToSheets([c.id])
        updateContact(c.id, { sent_to_sheets: true })
      }
      showToast(sent ? 'Sent to Google Sheets!' : 'Not sent')
    } catch (err) {
      showToast('Error: ' + (err as Error).message)
    } finally {
      setIsSendingSheets(false)
    }
  }

  const handleWhatsApp = () => {
    const phone = c.phone_mobile || c.phone_work
    if (!phone) { showToast('No phone number found'); return }
    const digits = phone.replace(/[^\d]/g, '')
    window.open(`https://wa.me/${digits}`, '_blank')
  }

  const fullAddress = [c.address, c.city, c.state, c.zip, c.country].filter(Boolean).join(', ')

  return (
    <div style={isDesktop ? {
      position: 'fixed', top: 0, right: 0, bottom: 0, left: 'auto', width: DETAIL_PANEL_WIDTH,
      zIndex: 200, background: 'var(--bg)', overflowY: 'auto',
      borderLeft: '1px solid var(--border2)', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)',
      animation: 'slideInRight 0.22s cubic-bezier(0.16,1,0.3,1)',
    } : {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 200, background: 'var(--bg)', overflowY: 'auto',
      animation: 'slideUp 0.28s cubic-bezier(0.16,1,0.3,1)',
    }}>
      {/* Dark header */}
      <div style={{ background: 'var(--hdr)', padding: '56px 16px 18px', position: 'relative' }}>
        <button type="button" onClick={() => setDetailContactId(null)} style={hdrBtnStyle}>‹</button>
        <div style={{
          position: 'absolute', right: 96, top: 10,
          display: 'flex', gap: 2,
        }}>
          {[1, 2, 3, 4].map((n) => (
            <span key={n} onClick={handleStarCycle}
              style={{ fontSize: 20, cursor: 'pointer', color: c.stars >= n ? '#ffd700' : 'rgba(255,255,255,0.35)', lineHeight: 1, display: 'flex' }}>
              <Star size={20} fill={c.stars >= n ? '#ffd700' : 'transparent'} stroke={c.stars >= n ? '#ffd700' : 'rgba(255,255,255,0.35)'} />
            </span>
          ))}
        </div>
        <button onClick={() => setMenuContactId(c.id)} style={{ ...hdrBtnStyle, right: 12, left: 'auto' }}>
          ···
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 50, height: 50, borderRadius: '50%',
            background: 'rgba(255,255,255,0.22)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 10,
            border: '2px solid rgba(255,255,255,0.3)', flexShrink: 0,
          }}>
            {initials(c)}
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', lineHeight: 1.15 }}>
              {c.name || c.company || 'Unknown'}
            </div>
            {c.title && (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 3 }}>
                {c.title}{c.company && c.name ? ' · ' + c.company : ''}
              </div>
            )}
            {c.phone_mobile && (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Smartphone size={14} strokeWidth={2.25} aria-hidden />
                {c.phone_mobile}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick action row */}
      <div style={{ display: 'flex', background: 'var(--bg2)', borderBottom: '1px solid var(--border2)' }}>
        {(c.phone_mobile || c.phone_work) && (
          <ActionBtn icon={<Phone size={18} strokeWidth={2.25} />} token="call" label="Call"
            onClick={() => window.location.href = `tel:${c.phone_mobile || c.phone_work}`} />
        )}
        {(c.phone_mobile || c.phone_work) && (
          <ActionBtn icon={<MessageCircle size={18} strokeWidth={2.25} />} token="message" label="WhatsApp" onClick={handleWhatsApp} />
        )}
        {(c.address || c.city) && (
          <ActionBtn icon={<MapPin size={18} strokeWidth={2.25} />} token="map" label="Map"
            onClick={() => {
              const q = [c.company, fullAddress].filter(Boolean).join(' ')
              window.open(`https://maps.google.com/?q=${encodeURIComponent(q)}`, '_blank')
            }} />
        )}
        {c.email && (
          <ActionBtn icon={<Mail size={18} strokeWidth={2.25} />} token="email" label="Email"
            onClick={() => window.location.href = `mailto:${c.email}`} />
        )}
        <ActionBtn
          icon={isSendingSheets ? <Loader2 size={18} className="animate-spin" /> : <BarChart3 size={18} strokeWidth={2} />}
          token="sheets"
          label={isSendingSheets ? 'Sending…' : 'Sheets'}
          onClick={handleSendToSheets}
        />
        <ActionBtn icon={<FileText size={18} strokeWidth={2.25} />} token="invoice" label="Invoice" onClick={() => setInvoiceContactId(c.id)} />
        <ActionBtn icon={<Pencil size={18} strokeWidth={2.25} />} token="edit" label="Edit"
          onClick={() => setEditModal({ contact: c, isNew: false })} />
      </div>

      {/* Card images */}
      {(c.front_image || c.front_image_url || c.back_image || c.back_image_url) && (
        <>
          <SectionTitle>Card Images</SectionTitle>
          <Section>
            {(c.front_image || c.front_image_url) && (
              <DetailRow icon={<ImageIcon size={16} strokeWidth={2} />} bg="var(--action-neutral-bg)">
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Front Side</div>
                <img src={c.front_image ? `data:image/jpeg;base64,${c.front_image}` : c.front_image_url}
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                  style={{ width: '100%', borderRadius: 10, objectFit: 'contain',
                    maxHeight: 180, border: '1px solid var(--border2)', background: 'var(--bg3)' }} alt="Card front" />
              </DetailRow>
            )}
            {(c.back_image || c.back_image_url) && (
              <DetailRow icon={<ImageIcon size={16} strokeWidth={2} />} bg="var(--action-neutral-bg)">
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Back Side</div>
                <img src={c.back_image ? `data:image/jpeg;base64,${c.back_image}` : c.back_image_url}
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                  style={{ width: '100%', borderRadius: 10, objectFit: 'contain',
                    maxHeight: 180, border: '1px solid var(--border2)', background: 'var(--bg3)' }} alt="Card back" />
              </DetailRow>
            )}
          </Section>
        </>
      )}

      {/* Contact details */}
      <SectionTitle>Contact Details</SectionTitle>
      <Section>
        {c.company && <SimpleRow icon={<Building2 size={16} strokeWidth={2} />} bg="var(--action-neutral-bg)" value={c.company} label="Company" />}
        {c.title && <SimpleRow icon={<Briefcase size={16} strokeWidth={2} />} bg="var(--action-neutral-bg)" value={c.title} label="Job Title" />}
        {c.email && (
          <DetailRow icon={<Mail size={16} strokeWidth={2} />} bg="var(--accent)">
            <a href={`mailto:${c.email}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 15, fontWeight: 500 }}>{c.email}</a>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Email</div>
          </DetailRow>
        )}
        {c.phone_mobile && (
          <DetailRow icon={<Smartphone size={16} strokeWidth={2} />} bg="var(--chip-success-fg)">
            <a href={`tel:${c.phone_mobile}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 15, fontWeight: 500 }}>{c.phone_mobile}</a>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Mobile</div>
          </DetailRow>
        )}
        {c.phone_work && (
          <DetailRow icon={<Phone size={16} strokeWidth={2} />} bg="var(--action-neutral-bg)">
            <a href={`tel:${c.phone_work}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 15, fontWeight: 500 }}>{c.phone_work}</a>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Work Tel</div>
          </DetailRow>
        )}
        {c.phone_fax && <SimpleRow icon={<Printer size={16} strokeWidth={2} />} bg="var(--action-neutral-bg)" value={c.phone_fax} label="Fax" />}
        {c.website && (
          <DetailRow icon={<Globe size={16} strokeWidth={2} />} bg="var(--action-email-fg)">
            <a href={mUrl(c.website)} target="_blank" rel="noreferrer"
              style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 15, fontWeight: 500 }}>{c.website}</a>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Website</div>
          </DetailRow>
        )}
      </Section>

      {(c.address || c.city) && (
        <>
          <SectionTitle>Address</SectionTitle>
          <Section>
            <DetailRow icon={<MapPin size={16} strokeWidth={2} />} bg="var(--chip-warning-fg)">
              <div style={{ fontSize: 14, whiteSpace: 'normal' }}>{fullAddress}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Company Address</div>
            </DetailRow>
          </Section>
        </>
      )}

      {(c.notes || c.user_notes || c.back_notes) && (
        <>
          <SectionTitle>Notes</SectionTitle>
          <Section>
            {c.notes && <NoteRow label="From Card" text={c.notes} />}
            {c.back_notes && <NoteRow label="Back Side" text={c.back_notes} />}
            {c.user_notes && <NoteRow label="Your Notes" text={c.user_notes} />}
          </Section>
        </>
      )}

      <SectionTitle>Status</SectionTitle>
      <Section>
        <ToggleRow
          icon={<Package size={16} strokeWidth={2} />} label="Showed Goods" sublabel="Tap to toggle"
          active={!!c.visited} activeColor="var(--chip-success-fg)"
          onToggle={handleToggleVisited}
        />
        <ToggleRow
          icon={<Handshake size={16} strokeWidth={2} />} label="Current Customer" sublabel="Tap to toggle"
          active={!!c.is_customer} activeColor="var(--accent)"
          onToggle={handleToggleCustomer}
        />
        <ToggleRow
          icon={<History size={16} strokeWidth={2} />} label="Old Customer" sublabel="Tap to toggle"
          active={!!c.is_old_customer} activeColor="var(--chip-warning-fg)"
          onToggle={handleToggleOldCustomer}
        />
        <FollowupDetailRow contact={c} onOpen={() => setFollowupContactId(c.id)} />
      </Section>

      <SectionTitle>Info</SectionTitle>
      <Section>
        {c.area && <SimpleRow icon={<Map size={16} strokeWidth={2} />} bg="var(--action-neutral-bg)" value={c.area} label="Area" />}
        <SimpleRow icon={<Calendar size={16} strokeWidth={2} />} bg="var(--action-neutral-bg)" value={c.scanned_at || '—'} label="Scanned On" />
      </Section>

      <div style={{ height: 20 }} />

      {/* Bottom actions */}
      <div style={{
        padding: '14px 16px 36px', background: 'var(--bg2)',
        borderTop: '1px solid var(--border2)', position: 'sticky', bottom: 0,
        display: 'flex', gap: 10,
      }}>
        <button type="button" onClick={handleWhatsApp} style={{ ...saveBtnStyle, background: 'var(--bg3)',
          color: 'var(--text)', border: '1px solid var(--border)', flex: 1, gap: 8 }}>
          <MessageCircle size={18} strokeWidth={2} /> WhatsApp
        </button>
        <button type="button" onClick={handleSaveToPhone} style={{ ...saveBtnStyle, flex: 2, gap: 8 }}>
          <User size={18} strokeWidth={2} /> Save to Phone
        </button>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

const hdrBtnStyle: React.CSSProperties = {
  position: 'absolute', top: 12, left: 12, width: 34, height: 34,
  borderRadius: '50%', background: 'rgba(255,255,255,0.18)', border: 'none',
  color: '#fff', fontSize: 22, cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
}

const saveBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 7, padding: '13px 18px', borderRadius: 10, border: 'none',
  background: 'var(--accent)', color: '#fff', fontWeight: 700,
  fontSize: 15, cursor: 'pointer',
}

type ActionToken = 'call' | 'message' | 'map' | 'email' | 'sheets' | 'invoice' | 'edit' | 'neutral'

function ActionBtn({ icon, token, label, onClick }: {
  icon: ReactNode; token: ActionToken; label: string; onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 3, padding: '12px 4px', border: 'none', background: 'none',
      cursor: 'pointer', fontSize: 10, fontWeight: 700, color: 'var(--text2)',
      borderRight: '1px solid var(--border2)', transition: '0.1s',
      textTransform: 'uppercase', letterSpacing: '0.3px',
    }}>
      <div className="icon-btn-circle" style={{
        width: 36, height: 36, borderRadius: '50%',
        background: `var(--action-${token}-bg)`,
        color: `var(--action-${token}-fg)`,
        fontSize: 16,
      }}>
        {icon}
      </div>
      {label}
    </button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)',
      padding: '13px 16px 5px', textTransform: 'uppercase',
      letterSpacing: '0.5px', background: 'var(--bg)' }}>
      {children}
    </div>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg2)', borderTop: '1px solid var(--border2)', borderBottom: '1px solid var(--border2)' }}>
      {children}
    </div>
  )
}

function DetailRow({ icon, bg, children }: { icon: ReactNode; bg: string; children: React.ReactNode }) {
  const isNeutral = bg === 'var(--action-neutral-bg)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      borderBottom: '1px solid var(--border2)' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: bg,
        color: isNeutral ? 'var(--action-neutral-fg)' : 'var(--icon-on-accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

function SimpleRow({ icon, bg, value, label }: { icon: ReactNode; bg: string; value: string; label: string }) {
  return (
    <DetailRow icon={icon} bg={bg}>
      <div style={{ fontSize: 15, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>{label}</div>
    </DetailRow>
  )
}

function NoteRow({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border2)' }}>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  )
}

function FollowupDetailRow({ contact: c, onOpen }: { contact: Contact; onOpen: () => void }) {
  const hasFollowup = !!c.followup_at
  const isOverdue = hasFollowup && new Date(c.followup_at!) < new Date()
  const color = isOverdue ? 'var(--chip-danger-fg)' : hasFollowup ? 'var(--chip-warning-fg)' : 'var(--text3)'
  const bgColor = isOverdue ? 'var(--chip-danger-bg)' : hasFollowup ? 'var(--chip-warning-bg)' : 'var(--bg4)'

  const label = hasFollowup
    ? new Date(c.followup_at!).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : 'Tap to set a reminder'

  return (
    <div onClick={onOpen} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      borderBottom: '1px solid var(--border2)', cursor: 'pointer',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', background: bgColor,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, flexShrink: 0,
      }}><Calendar size={16} strokeWidth={2} /></div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {isOverdue && (
            <>
              <AlertTriangle size={16} strokeWidth={2} aria-hidden />
              <span>Overdue —</span>
            </>
          )}
          <span>{label}</span>
        </div>
        {c.followup_note ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>{c.followup_note}</div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Follow-up reminder</div>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>
        {hasFollowup ? 'Edit' : 'Set'}
      </div>
    </div>
  )
}

function ToggleRow({ icon, label, sublabel, active, activeColor, onToggle }: {
  icon: ReactNode; label: string; sublabel: string
  active: boolean; activeColor: string; onToggle: () => void
}) {
  return (
    <div onClick={onToggle} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      borderBottom: '1px solid var(--border2)', cursor: 'pointer',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: active ? activeColor : 'var(--bg4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, flexShrink: 0, transition: 'background 0.2s',
      }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: active ? activeColor : 'var(--text)' }}>
          {label}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>{sublabel}</div>
      </div>
      <div style={{
        width: 44, height: 26, borderRadius: 13,
        background: active ? activeColor : 'var(--bg4)',
        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: 3, left: active ? 21 : 3,
          width: 20, height: 20, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>
    </div>
  )
}

