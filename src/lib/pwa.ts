/** Name shown under iOS Settings → Privacy → Location Services for the home-screen app. */
export const PWA_DISPLAY_NAME = 'CardHolder'

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** Shown when Enable fails with no popup — iOS already blocked location for this app. */
export function getLocationBlockedHelp(): string {
  const host = typeof window !== 'undefined' ? window.location.host : 'this site'
  return [
    'No popup = iPhone already blocked location for this app.',
    '',
    'Reset (do in order):',
    `1. Settings → Privacy → Location Services → ON`,
    `2. Settings → Safari → Location → find ${host} → Ask Next Time`,
    '3. Delete the CardHolder icon from Home Screen',
    '4. Open the site in Safari → Share → Add to Home Screen',
    '5. Open the NEW icon → Settings → Enable → Allow',
  ].join('\n')
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
