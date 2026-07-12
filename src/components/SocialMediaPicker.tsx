import { useState, type ReactNode } from 'react'
import { Camera, ThumbsUp, Music2, Pin, Share2 } from 'lucide-react'
import { getContactSocialLinks, openSocialLink } from '../lib/socialPlatforms'
import type { Contact } from '../types/contact'

const ICONS: Record<string, ReactNode> = {
  instagram: <Camera size={22} strokeWidth={2.25} />,
  facebook: <ThumbsUp size={22} strokeWidth={2.25} />,
  tiktok: <Music2 size={22} strokeWidth={2.25} />,
  pinterest: <Pin size={22} strokeWidth={2.25} />,
}

export function SocialMediaPicker({ contact }: { contact: Contact }) {
  const [open, setOpen] = useState(false)
  const links = getContactSocialLinks(contact)
  if (!links.length) return null

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          borderBottom: '1px solid var(--border2)', cursor: 'pointer',
        }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: '50%', background: 'var(--action-neutral-bg)',
          color: 'var(--action-neutral-fg)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
        }}>
          <Share2 size={16} strokeWidth={2} aria-hidden />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {links.map((l) => l.label).join(', ')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Social Media</div>
        </div>
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'var(--modal-bg)', zIndex: 400,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            animation: 'fadeIn 0.18s ease',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg2)', borderRadius: '22px 22px 0 0',
              width: '100%', maxWidth: 480, padding: '16px 16px 40px',
              animation: 'sheetUp 0.3s cubic-bezier(0.16,1,0.3,1)',
            }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 4, background: 'var(--bg4)', margin: '0 auto 16px' }} />
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 18, textAlign: 'center' }}>Social Media</div>
            <div style={{
              display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
              flexWrap: 'wrap', gap: 28,
            }}>
              {links.map((link) => (
                <button
                  key={link.key}
                  type="button"
                  onClick={() => { openSocialLink(link); setOpen(false) }}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                    background: 'none', border: 'none', cursor: 'pointer', padding: 4, width: 76,
                  }}
                >
                  <div style={{
                    width: 54, height: 54, borderRadius: '50%', background: link.bg, color: link.fg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {ICONS[link.key]}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', textAlign: 'center' }}>
                    {link.label}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
