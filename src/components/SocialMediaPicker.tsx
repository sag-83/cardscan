import { useState, type ReactNode } from 'react'
import { getContactSocialLinks, openSocialLink } from '../lib/socialPlatforms'
import { InstagramBadge, FacebookBadge, TikTokBadge, PinterestBadge } from './icons/SocialBadges'
import type { Contact } from '../types/contact'

const BADGES: Record<string, (size: number) => ReactNode> = {
  instagram: (size) => <InstagramBadge size={size} />,
  facebook: (size) => <FacebookBadge size={size} />,
  tiktok: (size) => <TikTokBadge size={size} />,
  pinterest: (size) => <PinterestBadge size={size} />,
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
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
          borderBottom: '1px solid var(--border2)', cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {links.map((link) => (
            <div key={link.key}>{BADGES[link.key]?.(30)}</div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>Social Media</div>
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
                  {BADGES[link.key]?.(54)}
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
