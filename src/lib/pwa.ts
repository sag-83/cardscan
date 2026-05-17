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
      'Safari Websites → While Using does NOT always apply to this Home Screen icon.',
      '',
      '1. Settings → Privacy → Location Services → Safari Websites → your site → Ask Next Time',
      '2. Delete this Home Screen icon, re-add from Safari',
      '3. Open from the NEW icon only → tap Near Me → tap Allow on the popup',
      '',
      'No popup? Use Near Me in Safari until iOS 16.4+ or try updating iOS.',
    ].join('\n')
  }
  return [
    'Settings → Location Services → Safari Websites → your site → While Using or Ask Next Time.',
    '',
    'Then Add to Home Screen, open the icon, tap Near Me, and Allow on the popup there too.',
  ].join('\n')
}
