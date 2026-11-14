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

/** Closest point on segment AB to P, plus distance along AB from A. */
function closestOnSegment(
  p: GeoPoint,
  a: GeoPoint,
  b: GeoPoint,
): { point: GeoPoint; t: number; milesFromA: number } {
  const abLat = b.lat - a.lat
  const abLng = b.lng - a.lng
  const abLen2 = abLat * abLat + abLng * abLng
  if (abLen2 < 1e-18) {
    return { point: a, t: 0, milesFromA: 0 }
  }
  const t = Math.max(0, Math.min(1,
    ((p.lat - a.lat) * abLat + (p.lng - a.lng) * abLng) / abLen2,
  ))
  const point = { lat: a.lat + t * abLat, lng: a.lng + t * abLng }
  return { point, t, milesFromA: distanceBetween(a, point) }
}

/**
 * Distance from a point to a polyline, and how far along the path that
 * projection sits — used to pick jewelry stopovers along a highway corridor.
 */
export function distanceToPolyline(
  point: GeoPoint,
  path: GeoPoint[],
): { miles: number; alongMiles: number } {
  if (path.length === 0) return { miles: Infinity, alongMiles: 0 }
  if (path.length === 1) {
    return { miles: distanceBetween(point, path[0]), alongMiles: 0 }
  }

  let bestMiles = Infinity
  let bestAlong = 0
  let traveled = 0

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const segLen = distanceBetween(a, b)
    const hit = closestOnSegment(point, a, b)
    const d = distanceBetween(point, hit.point)
    if (d < bestMiles) {
      bestMiles = d
      bestAlong = traveled + hit.milesFromA
    }
    traveled += segLen
  }

  return { miles: bestMiles, alongMiles: bestAlong }
}
