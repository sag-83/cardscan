import type { Contact } from '../types/contact'
import { openInstagram } from './utils'

export interface SocialPlatformConfig {
  key: string
  label: string
  bg: string
  fg: string
  webUrl: (handle: string) => string
  urlPattern: RegExp
  labelPattern: RegExp
}

function cleanHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').replace(/[.,;:]+$/, '').toLowerCase()
}

// Display order: Instagram (handled separately, always first) then these three.
export const SOCIAL_PLATFORMS: SocialPlatformConfig[] = [
  {
    key: 'facebook',
    label: 'Facebook',
    bg: 'rgba(24, 119, 242, 0.14)',
    fg: '#1877f2',
    webUrl: (h) => `https://facebook.com/${h}`,
    urlPattern: /facebook\.com\/([a-zA-Z0-9._-]{2,50})/i,
    labelPattern: /\b(?:facebook|fb)\b\s*[:\-]?\s*@?([a-zA-Z0-9._-]{2,50})/i,
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    bg: 'rgba(0, 0, 0, 0.08)',
    fg: '#111111',
    webUrl: (h) => `https://tiktok.com/@${h.replace(/^@/, '')}`,
    urlPattern: /tiktok\.com\/@?([a-zA-Z0-9._]{2,30})/i,
    labelPattern: /\btik ?tok\b\s*[:\-]?\s*@?([a-zA-Z0-9._]{2,30})/i,
  },
  {
    key: 'pinterest',
    label: 'Pinterest',
    bg: 'rgba(230, 0, 35, 0.14)',
    fg: '#e60023',
    webUrl: (h) => `https://pinterest.com/${h}`,
    urlPattern: /pinterest\.com\/([a-zA-Z0-9._]{2,30})/i,
    labelPattern: /\bpinterest\b\s*[:\-]?\s*@?([a-zA-Z0-9._]{2,30})/i,
  },
]

export function extractSocialFromText(text: string | undefined | null): Record<string, string> {
  const source = (text ?? '').trim()
  if (!source) return {}
  const found: Record<string, string> = {}
  for (const platform of SOCIAL_PLATFORMS) {
    const urlMatch = source.match(platform.urlPattern)
    if (urlMatch?.[1]) {
      found[platform.key] = cleanHandle(urlMatch[1])
      continue
    }
    const labelMatch = source.match(platform.labelPattern)
    if (labelMatch?.[1]) found[platform.key] = cleanHandle(labelMatch[1])
  }
  return found
}

/** Backfill helper: derive facebook/tiktok/pinterest handles from a contact's existing notes fields. */
export function deriveSocialMediaFromNotes(
  c: Pick<Contact, 'notes' | 'back_notes' | 'user_notes'>
): Record<string, string> {
  return {
    ...extractSocialFromText(c.user_notes),
    ...extractSocialFromText(c.back_notes),
    ...extractSocialFromText(c.notes),
  }
}

export interface ContactSocialLink {
  key: string
  label: string
  handle: string
  bg: string
  fg: string
  url: string
}

/** Merges the dedicated instagram field + the generic social_media map into one ordered list for display. */
export function getContactSocialLinks(
  c: Pick<Contact, 'instagram' | 'social_media'>
): ContactSocialLink[] {
  const links: ContactSocialLink[] = []
  if (c.instagram) {
    links.push({
      key: 'instagram',
      label: 'Instagram',
      handle: c.instagram,
      bg: 'var(--action-instagram-bg)',
      fg: 'var(--action-instagram-fg)',
      url: `https://instagram.com/${c.instagram}`,
    })
  }
  for (const platform of SOCIAL_PLATFORMS) {
    const handle = c.social_media?.[platform.key]
    if (!handle) continue
    links.push({
      key: platform.key,
      label: platform.label,
      handle,
      bg: platform.bg,
      fg: platform.fg,
      url: platform.webUrl(handle),
    })
  }
  return links
}

export function openSocialLink(link: ContactSocialLink): void {
  if (link.key === 'instagram') {
    openInstagram(link.handle)
    return
  }
  window.open(link.url, '_blank')
}
