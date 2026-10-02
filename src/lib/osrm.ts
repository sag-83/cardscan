// Real road travel times from the public OSRM routing service.
//
// Straight-line distance is a decent proxy for ordering stops, but it ignores
// rivers, highway access and one-way streets — exactly the things that decide
// whether "five miles east" is a six-minute hop or a twenty-minute detour.
// OSRM's table service returns a full driving matrix in one request, so the
// optimiser can minimise actual time behind the wheel.
//
// This is strictly an upgrade: every caller treats a null result as "fall back
// to the local estimate", so losing the service only costs accuracy.

import {
  distanceBetween,
  estimateDriveMinutes,
  estimateRoadMiles,
  MILES_PER_METER,
  type GeoPoint,
} from './geoMath'

const OSRM_BASE = 'https://router.project-osrm.org'
const REQUEST_TIMEOUT_MS = 15_000

// The public demo server rejects very large tables, and a day of stops never
// comes close to this. Anything bigger stays on local estimates.
const MAX_TABLE_POINTS = 60

export interface DrivingMatrix {
  /** Seconds from i to j. */
  durations: number[][]
  /** Miles from i to j. */
  miles: number[][]
}

interface OsrmTableResponse {
  code?: string
  durations?: (number | null)[][] | null
  distances?: (number | null)[][] | null
}

function isSquare(matrix: unknown[][] | null | undefined, size: number): boolean {
  return Array.isArray(matrix) && matrix.length === size && matrix.every((row) => Array.isArray(row) && row.length === size)
}

/**
 * Driving durations and distances between every pair of points, or null when
 * the service is unavailable, too slow, or returns something unusable.
 */
export async function fetchDrivingMatrix(
  points: GeoPoint[],
  signal?: AbortSignal,
): Promise<DrivingMatrix | null> {
  if (points.length < 2 || points.length > MAX_TABLE_POINTS) return null

  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `${OSRM_BASE}/table/v1/driving/${coords}?annotations=duration,distance`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null

    const data = await res.json() as OsrmTableResponse
    if (data.code !== 'Ok' || !isSquare(data.durations, points.length)) return null

    const rawDurations = data.durations as (number | null)[][]
    const rawDistances = isSquare(data.distances, points.length)
      ? data.distances as (number | null)[][]
      : null

    // OSRM reports null for pairs it can't connect by road. Rather than discard
    // an otherwise good matrix, fill those cells with the local estimate so the
    // optimiser still has a finite, roughly-right number to work with.
    const durations: number[][] = []
    const miles: number[][] = []

    for (let i = 0; i < points.length; i++) {
      durations.push([])
      miles.push([])
      for (let j = 0; j < points.length; j++) {
        if (i === j) {
          durations[i].push(0)
          miles[i].push(0)
          continue
        }

        const straight = distanceBetween(points[i], points[j])
        const seconds = rawDurations[i][j]
        const meters = rawDistances?.[i][j] ?? null

        durations[i].push(
          typeof seconds === 'number' && Number.isFinite(seconds)
            ? seconds
            : estimateDriveMinutes(straight) * 60,
        )
        miles[i].push(
          typeof meters === 'number' && Number.isFinite(meters)
            ? meters * MILES_PER_METER
            : estimateRoadMiles(straight),
        )
      }
    }

    return { durations, miles }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
