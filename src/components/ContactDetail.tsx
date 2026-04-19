import { useStore } from '../store/useStore'
import { initials, mUrl } from '../lib/utils'
import { downloadVCard } from '../lib/vcard'
import { saveContactToDB } from '../lib/supabase'

export function ContactDetail() {
  const detailContactId = useStore((s) => s.detailContactId)
  const contacts = useStore((s) => s.contacts)
  const setDetailContactId = useStore((s) => s.setDetailContactId)
  const setEditModal = useStore((s) => s.setEditModal)
  const setMenuContactId = useStore((s) => s.setMenuContactId)
  const updateContact = useStore((s) => s.updateContact)
  const showToast = useStore((s) => s.showToast)

  const contact = contacts.find((c) => c.id === detailContactId)
  if (!contact) return null
  const c = contact

  const handleStarCycle = () => {
    const newStars = c.stars >= 4 ? 0 : c.stars + 1
    updateContact(c.id, { stars: newStars })
    saveContactToDB({ ...c, stars: newStars })
  }

  const handleSaveToPhone = () => {
    downloadVCard(c)
    showToast('Open the .vcf file to save!')
  }

  const handleSMS = () => {
    const phone = c.phone_mobile || c.phone_work
    if (!phone) { showToast('No phone number found'); return }
    window.open(`sms:${phone}`)
  }

  const fullAddress = [c.address, c.city, c.state, c.zip, c.country].filter(Boolean).join(', ')

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 200, background: 'var(--bg)', overflowY: 'auto',
      animation: 'slideUp 0.28s cubic-bezier(0.16,1,0.3,1)',
    }}>
      {/* Dark header */}
      <div style={{ background: 'var(--hdr)', padding: '56px 16px 18px', position: 'relative' }}>
        <button onClick={() => setDetailContactId(null)} style={hdrBtnStyle}>‹</button>
        <button onClick={handleStarCycle} style={{ ...hdrBtnStyle, right: 50, left: 'auto' }}>
          {c.stars > 0 ? '★' : '☆'}
        </button>
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
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
                📱 {c.phone_mobile}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick action row — now includes SMS */}
      <div style={{ display: 'flex', background: 'var(--bg2)', borderBottom: '1px solid var(--border2)' }}>
        {(c.phone_mobile || c.phone_work) && (
          <ActionBtn icon="📞" bg="#e1f0ff" label="Call"
            onClick={() => window.location.href = `tel:${c.phone_mobile || c.phone_work}`} />
        )}
        {(c.phone_mobile || c.phone_work) && (
          <ActionBtn icon="💬" bg="#e8f5e9" label="SMS" onClick={handleSMS} />
        )}
        {(c.address || c.city) && (
          <ActionBtn icon="📍" bg="#fff3e0" label="Map"
            onClick={() => window.open(`https://maps.google.com/?q=${encodeURIComponent(fullAddress)}`, '_blank')} />
        )}
        {c.email && (
          <ActionBtn icon="✉️" bg="#ede7f6" label="Email"
            onClick={() => window.location.href = `mailto:${c.email}`} />
        )}
        <ActionBtn icon="✏️" bg="#f5f5f5" label="Edit"
          onClick={() => setEditModal({ contact: c, isNew: false })} />
      </div>

      {/* Card images */}
      {(c.front_image || c.back_image) && (
        <>
          <SectionTitle>Card Images</SectionTitle>
          <Section>
            {c.front_image && (
              <DetailRow icon="🖼" bg="#8e8e93">
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Front Side</div>
                <img src={`data:image/jpeg;base64,${c.front_image}`}
                  style={{ width: '100%', borderRadius: 10, objectFit: 'contain',
                    maxHeight: 180, border: '1px solid var(--border2)', background: 'var(--bg3)' }} alt="Card front" />
              </DetailRow>
            )}
            {c.back_image && (
              <DetailRow icon="🖼" bg="#8e8e93">
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Back Side</div>
                <img src={`data:image/jpeg;base64,${c.back_image}`}
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
        {c.company && <SimpleRow icon="🏢" bg="#8e8e93" value={c.company} label="Company" />}
        {c.title && <SimpleRow icon="💼" bg="#8e8e93" value={c.title} label="Job Title" />}
        {c.email && (
          <DetailRow icon="📧" bg="#007aff">
            <a href={`mailto:${c.email}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 15, fontWeight: 500 }}>{c.email}</a>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Email</div>
          </DetailRow>
        )}
        {c.phone_mobile && (
          <DetailRow icon="📱" bg="#34c759">
            <a href={`tel:${c.phone_mobile}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 15, fontWeight: 500 }}>{c.phone_mobile}</a>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Mobile</div>
          </DetailRow>
        )}
        {c.phone_work && (
          <DetailRow icon="📞" bg="#8e8e93">
            <a href={`tel:${c.phone_work}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 15, fontWeight: 500 }}>{c.phone_work}</a>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Work Tel</div>
          </DetailRow>
        )}
        {c.phone_fax && <SimpleRow icon="📠" bg="#8e8e93" value={c.phone_fax} label="Fax" />}
        {c.website && (
          <DetailRow icon="🌐" bg="#5856d6">
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
            <DetailRow icon="📍" bg="#ff9500">
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

      {/* 4-star priority */}
      <SectionTitle>Info</SectionTitle>
      <Section>
        <SimpleRow icon="📅" bg="#8e8e93" value={c.scanned_at || '—'} label="Scanned On" />
        <DetailRow icon="⭐" bg="#ff9500">
          <div style={{ display: 'flex', gap: 4 }}>
            {[1, 2, 3, 4].map((n) => (
              <span key={n} onClick={handleStarCycle}
                style={{ fontSize: 22, cursor: 'pointer', color: c.stars >= n ? 'var(--star)' : 'var(--bg4)' }}>★</span>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Priority (1–4)</div>
        </DetailRow>
      </Section>

      <div style={{ height: 20 }} />

      {/* Bottom actions */}
      <div style={{
        padding: '14px 16px 36px', background: 'var(--bg2)',
        borderTop: '1px solid var(--border2)', position: 'sticky', bottom: 0,
        display: 'flex', gap: 10,
      }}>
        <button onClick={handleSMS} style={{ ...saveBtnStyle, background: 'var(--bg3)',
          color: 'var(--text)', border: '1px solid var(--border)', flex: 1 }}>
          💬 SMS
        </button>
        <button onClick={handleSaveToPhone} style={{ ...saveBtnStyle, flex: 2 }}>
          👤 Save to Phone
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

function ActionBtn({ icon, bg, label, onClick }: {
  icon: string; bg: string; label: string; onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 3, padding: '12px 4px', border: 'none', background: 'none',
      cursor: 'pointer', fontSize: 10, fontWeight: 700, color: 'var(--text2)',
      borderRight: '1px solid var(--border2)', transition: '0.1s',
      textTransform: 'uppercase', letterSpacing: '0.3px',
    }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
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

function DetailRow({ icon, bg, children }: { icon: string; bg: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      borderBottom: '1px solid var(--border2)' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

function SimpleRow({ icon, bg, value, label }: { icon: string; bg: string; value: string; label: string }) {
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
