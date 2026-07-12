import { type ReactNode } from 'react'
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
  const links = getContactSocialLinks(contact)
  if (!links.length) return null

  return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap',
      gap: 22, padding: '16px 16px', borderBottom: '1px solid var(--border2)',
    }}>
      {links.map((link) => (
        <button
          key={link.key}
          type="button"
          onClick={() => openSocialLink(link)}
          aria-label={`Open ${link.label}`}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {BADGES[link.key]?.(46)}
        </button>
      ))}
    </div>
  )
}
