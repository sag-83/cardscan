import type { CSSProperties } from 'react'

interface BadgeProps {
  size?: number
  style?: CSSProperties
}

// Self-contained, full-color circular brand badges — legible on both light and
// dark backgrounds without extra styling, since the color is baked into the icon.

export function InstagramBadge({ size = 40, style }: BadgeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={style} aria-hidden>
      <defs>
        <radialGradient id="ig-badge-grad" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497" />
          <stop offset="8%" stopColor="#fdf497" />
          <stop offset="42%" stopColor="#fd5949" />
          <stop offset="62%" stopColor="#d6249f" />
          <stop offset="92%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill="url(#ig-badge-grad)" />
      <rect x="11.5" y="11.5" width="17" height="17" rx="5.5" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="20" cy="20" r="4.6" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="25.2" cy="14.8" r="1.3" fill="#fff" />
    </svg>
  )
}

export function FacebookBadge({ size = 40, style }: BadgeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={style} aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#0866FF" />
      <path
        d="M23.6 13.2h2.3V9.6h-2.9c-3.1 0-4.9 1.9-4.9 5.1v2.4h-3v4h3V31h4.2v-9.9h3l0.6-4h-3.6v-1.9c0-1 .3-2 1.3-2Z"
        fill="#fff"
      />
    </svg>
  )
}

export function TikTokBadge({ size = 40, style }: BadgeProps) {
  const notePath = 'M22.2 9.5c.6 2.6 2.3 4.3 5.1 4.6v3.3c-1.8.1-3.4-.4-5.1-1.4v6.9c0 4.9-5.3 8-9.6 5.5-2.8-1.6-3.9-5.1-2.4-8 1.2-2.4 3.9-3.8 6.6-3.4v3.4c-1.2-.3-2.5.3-3 1.4-.6 1.3-.1 2.8 1.2 3.4 1.7.8 3.6-.3 3.6-2.2V9.5h3.6Z'
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={style} aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#010101" />
      <path d={notePath} fill="#25F4EE" transform="translate(-0.8,-0.6)" />
      <path d={notePath} fill="#FE2C55" transform="translate(0.8,0.6)" />
      <path d={notePath} fill="#fff" />
    </svg>
  )
}

export function PinterestBadge({ size = 40, style }: BadgeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={style} aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#E60023" />
      <path
        d="M20 9c-6.1 0-10.2 4.3-10.2 9.4 0 3 1.6 5.3 4.2 6.2.3.1.6-.1.7-.4l.3-1.2c.1-.4 0-.5-.2-.8-.6-.7-1-1.7-1-3.1 0-3.9 3-7.4 7.6-7.4 4.1 0 6.4 2.5 6.4 5.9 0 4.4-1.9 8.2-4.9 8.2-1.6 0-2.8-1.3-2.4-3 .5-2 1.5-4.1 1.5-5.5 0-1.3-.7-2.4-2.1-2.4-1.7 0-3.1 1.7-3.1 4.1 0 1.5.5 2.5.5 2.5s-1.7 7.3-2 8.5c-.5 2.3-.1 5.2 0 5.5.1.1.2.1.2 0 .1-.1 1.3-2 1.8-3.8.1-.5.7-2.9.7-2.9.4.8 1.6 1.5 2.9 1.5 3.8 0 6.6-3.5 6.6-8.5C29.5 12.8 25.4 9 20 9Z"
        fill="#fff"
      />
    </svg>
  )
}
