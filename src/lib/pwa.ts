/** Name shown under iOS Settings → Privacy → Location Services for the home-screen app. */
export const PWA_DISPLAY_NAME = 'CardHolder'

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iOS uses different location permission for Safari vs Add to Home Screen. */
export function getLocationPermissionHelp(): string {
  if (isStandalonePwa()) {
    return [
      'Home Screen app has its own location permission (Safari settings do not apply).',
      '',
      'Fix: open the site in Safari (not the icon) → tap aA left of the address bar → Website Settings → Location → Allow.',
      '',
      `Or: Settings → Privacy & Security → Location Services → ${PWA_DISPLAY_NAME} → While Using.`,
    ].join('\n')
  }
  return [
    'Allow location for this site in Safari.',
    '',
    'Tap aA (left of the address bar) → Website Settings → Location → Allow.',
    'Or: Settings → Safari → Location → Ask.',
  ].join('\n')
}
