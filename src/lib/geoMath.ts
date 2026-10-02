// Straight-line distance plus the rough driving estimates the trip planner
// falls back to when a real road-routing matrix isn't available.

const EARTH_RADIUS_MILES = 3958.8

export const MILES_PER_METER = 0.000621371

export interface GeoPoint {
  lat: number
  lng: number
}

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function distanceBetween(a: GeoPoint, b: GeoPoint): number {
  return haversineDistance(a.lat, a.lng, b.lat, b.lng)
}

// Roads never follow the straight line. The multiplier is deliberately modest
// because the gap narrows on longer legs, which run mostly on highways.
const DETOUR_FACTOR = 1.3

export function estimateRoadMiles(straightMiles: number): number {
  return straightMiles * DETOUR_FACTOR
}

// Average speed climbs with leg length: a two-mile hop is all traffic lights,
// an eighty-mile leg is nearly all interstate.
function averageMph(roadMiles: number): number {
  if (roadMiles < 3) return 20
  if (roadMiles < 10) return 30
  if (roadMiles < 30) return 42
  if (roadMiles < 80) return 52
  return 60
}

export function estimateDriveMinutes(straightMiles: number): number {
  const roadMiles = estimateRoadMiles(straightMiles)
  if (roadMiles <= 0) return 0
  return (roadMiles / averageMph(roadMiles)) * 60
}

export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`
}

export function formatMiles(miles: number): string {
  if (miles < 10) return `${miles.toFixed(1)} mi`
  return `${Math.round(miles)} mi`
}
