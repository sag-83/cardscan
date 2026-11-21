/**
 * Stop ordering for the trip planner.
 *
 * Visiting N shops optimally is TSP (exact search blows up fast), so we:
 *
 *   1. Seed a tour with Dijkstra on a sparse k-nearest graph of real road
 *      times — from the current stop, Dijkstra finds the cheapest path to the
 *      next unvisited shop (and we collect any unvisited shops on that path).
 *   2. Also try classic cheapest-insertion; keep whichever seed is shorter.
 *   3. Polish with 2-opt + Or-opt until the tour stops improving.
 *
 * Road edge weights come from OSRM (which itself uses Dijkstra/A*-style
 * search on the highway graph). We run Dijkstra again on the stop graph so
 * the *day order* is shortest-path driven, not random.
 */

import {
  aStar,
  buildKnnGraph,
  dijkstra,
  reconstructPath,
} from './dijkstra'

/** Square matrix of travel costs; `matrix[i][j]` is the cost from i to j. */
export type CostMatrix = number[][]

export interface RouteResult {
  /** Matrix indices in visit order. The origin (index 0) is always first. */
  order: number[]
  /** Total cost in the matrix's own unit (miles or seconds). */
  cost: number
}

/** The origin is pinned to matrix index 0 by every caller. */
export const ORIGIN_INDEX = 0

/**
 * Where the route finishes.
 *
 * `null` leaves the driver at the last stop. `ORIGIN_INDEX` closes the loop
 * back to the start. Any other index is a separate place — his office, a
 * hotel — that is costed as the final leg but never visited as a stop.
 */
export type EndIndex = number | null

const EPSILON = 1e-9
const MAX_PASSES = 50
const MAX_SEGMENT_LENGTH = 3
/** Neighbors per node in the Dijkstra graph (sparse, not complete). */
const KNN_K = 8

export function tourCost(order: number[], matrix: CostMatrix, endIndex: EndIndex): number {
  let total = 0
  for (let i = 0; i < order.length - 1; i++) {
    total += matrix[order[i]][order[i + 1]]
  }
  if (endIndex !== null && order.length > 1) {
    total += matrix[order[order.length - 1]][endIndex]
  }
  return total
}

export interface BuildTourOptions {
  /**
   * Matrix indices eligible to be visited. Must exclude the origin, and the
   * end node too when the route finishes somewhere that isn't a stop.
   */
  candidates: number[]
  /** Hard cap on stops. When candidates exceed it, the extras are dropped. */
  limit: number
  endIndex: EndIndex
  /**
   * Per-candidate multiplier applied to insertion / Dijkstra pick cost.
   * Below 1 makes a stop more attractive, so it survives the cap.
   */
  weights?: Map<number, number>
  /**
   * Decides between candidates whose cost is effectively identical; higher wins.
   */
  tieBreak?: Map<number, number>
}

/**
 * Dijkstra-seeded tour: from the current stop, run Dijkstra (or A* when a
 * finish exists) on a k-nearest road-time graph and walk to the nearest
 * remaining shop — collecting any other unvisited shops that lie on that
 * shortest path so we don't skip a storefront we already drive past.
 */
export function buildTourDijkstra(matrix: CostMatrix, options: BuildTourOptions): number[] {
  const { candidates, limit, endIndex, weights, tieBreak } = options
  const cap = Math.min(limit, candidates.length)
  if (cap <= 0) return [ORIGIN_INDEX]

  const nodeIds = new Set<number>([ORIGIN_INDEX, ...candidates])
  if (endIndex !== null && endIndex !== ORIGIN_INDEX) nodeIds.add(endIndex)
  const graph = buildKnnGraph(matrix, [...nodeIds], KNN_K)

  const order = [ORIGIN_INDEX]
  const remaining = new Set(candidates)
  let current = ORIGIN_INDEX

  while (order.length - 1 < cap && remaining.size > 0) {
    // Full Dijkstra from the current pin (need distances to every remaining shop).
    const { dist, prev } = dijkstra(graph, current)

    let best: number | null = null
    let bestScore = Infinity
    let bestRank = -Infinity

    for (const cand of remaining) {
      let d = dist.get(cand)
      // Prefer shops that also sit closer to the eventual finish when set.
      if (d !== undefined && endIndex !== null && endIndex !== ORIGIN_INDEX) {
        const toEnd = matrix[cand]?.[endIndex]
        if (Number.isFinite(toEnd)) d = d + toEnd * 0.12
      }
      if (d === undefined) continue
      const weight = weights?.get(cand) ?? 1
      const score = d * weight
      const rank = tieBreak?.get(cand) ?? 0
      const cheaper = score < bestScore - EPSILON
      const tied = Math.abs(score - bestScore) <= EPSILON && rank > bestRank
      if (cheaper || tied) {
        bestScore = score
        bestRank = rank
        best = cand
      }
    }

    // Sparse graph can leave a shop unreachable — fall back to direct matrix row.
    if (best === null) {
      for (const cand of remaining) {
        const d = matrix[current]?.[cand]
        if (!Number.isFinite(d)) continue
        const weight = weights?.get(cand) ?? 1
        const score = d * weight
        const rank = tieBreak?.get(cand) ?? 0
        if (score < bestScore - EPSILON || (Math.abs(score - bestScore) <= EPSILON && rank > bestRank)) {
          bestScore = score
          bestRank = rank
          best = cand
        }
      }
    }

    if (best === null) break

    // A* path current → chosen shop (heuristic = remaining road time to target).
    const target = best
    const star = aStar(
      graph,
      current,
      target,
      (node) => {
        const h = matrix[node]?.[target]
        return Number.isFinite(h) ? h : 0
      },
    )
    const path = reconstructPath(star.prev, current, target)
    const steps = path.length > 1 ? path.slice(1) : reconstructPath(prev, current, target).slice(1)
    const walk = steps.length ? steps : [best]

    for (const node of walk) {
      if (order.length - 1 >= cap) break
      if (!remaining.has(node)) {
        if (node === best && !order.includes(node)) {
          order.push(node)
          remaining.delete(node)
          current = node
        }
        continue
      }
      order.push(node)
      remaining.delete(node)
      current = node
      if (node === best) break
    }

    if (!order.includes(best) && remaining.has(best) && order.length - 1 < cap) {
      order.push(best)
      remaining.delete(best)
      current = best
    }
  }

  return order
}

/**
 * Greedy cheapest insertion (kept as a competing seed — Dijkstra wins on
 * progressive corridors; insertion sometimes wins on dense city packs).
 */
export function buildTour(matrix: CostMatrix, options: BuildTourOptions): number[] {
  const { candidates, limit, endIndex, weights, tieBreak } = options
  const order = [ORIGIN_INDEX]
  const remaining = new Set(candidates)
  const cap = Math.min(limit, candidates.length)

  while (order.length - 1 < cap && remaining.size > 0) {
    const baseCost = tourCost(order, matrix, endIndex)
    let bestScore = Infinity
    let bestRank = -Infinity
    let bestCandidate = -1
    let bestPosition = 1

    for (const candidate of remaining) {
      const weight = weights?.get(candidate) ?? 1
      const rank = tieBreak?.get(candidate) ?? 0
      for (let position = 1; position <= order.length; position++) {
        const trial = [...order.slice(0, position), candidate, ...order.slice(position)]
        const score = (tourCost(trial, matrix, endIndex) - baseCost) * weight
        const cheaper = score < bestScore - EPSILON
        const tiedButPreferred = Math.abs(score - bestScore) <= EPSILON && rank > bestRank
        if (cheaper || tiedButPreferred) {
          bestScore = score
          bestRank = rank
          bestCandidate = candidate
          bestPosition = position
        }
      }
    }

    if (bestCandidate < 0) break
    order.splice(bestPosition, 0, bestCandidate)
    remaining.delete(bestCandidate)
  }

  return order
}

/** Reverses every run of stops and keeps any reversal that shortens the tour. */
function twoOptPass(order: number[], matrix: CostMatrix, endIndex: EndIndex): RouteResult {
  let best = order
  let bestCost = tourCost(best, matrix, endIndex)

  for (let i = 1; i < best.length - 1; i++) {
    for (let j = i + 1; j < best.length; j++) {
      const trial = [
        ...best.slice(0, i),
        ...best.slice(i, j + 1).reverse(),
        ...best.slice(j + 1),
      ]
      const cost = tourCost(trial, matrix, endIndex)
      if (cost < bestCost - EPSILON) {
        best = trial
        bestCost = cost
      }
    }
  }

  return { order: best, cost: bestCost }
}

/** Lifts runs of 1-3 stops and reinserts them elsewhere, forwards or reversed. */
function orOptPass(order: number[], matrix: CostMatrix, endIndex: EndIndex): RouteResult {
  let best = order
  let bestCost = tourCost(best, matrix, endIndex)

  for (let length = 1; length <= MAX_SEGMENT_LENGTH; length++) {
    for (let start = 1; start + length <= best.length; start++) {
      const segment = best.slice(start, start + length)
      const rest = [...best.slice(0, start), ...best.slice(start + length)]

      for (let position = 1; position <= rest.length; position++) {
        if (position === start) continue
        for (const piece of [segment, [...segment].reverse()]) {
          const trial = [...rest.slice(0, position), ...piece, ...rest.slice(position)]
          const cost = tourCost(trial, matrix, endIndex)
          if (cost < bestCost - EPSILON) {
            best = trial
            bestCost = cost
          }
        }
      }
    }
  }

  return { order: best, cost: bestCost }
}

/** Alternates 2-opt and Or-opt until neither finds an improvement. */
export function improveTour(order: number[], matrix: CostMatrix, endIndex: EndIndex): RouteResult {
  let current = order
  let currentCost = tourCost(current, matrix, endIndex)

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const afterTwoOpt = twoOptPass(current, matrix, endIndex)
    const afterOrOpt = orOptPass(afterTwoOpt.order, matrix, endIndex)

    if (afterOrOpt.cost >= currentCost - EPSILON) {
      return { order: afterOrOpt.order, cost: afterOrOpt.cost }
    }
    current = afterOrOpt.order
    currentCost = afterOrOpt.cost
  }

  return { order: current, cost: currentCost }
}

/**
 * Build with Dijkstra (+ A* when finishing somewhere), compete with
 * cheapest-insertion, then polish. Returns the shorter improved tour.
 */
export function planRoute(matrix: CostMatrix, options: BuildTourOptions): RouteResult {
  if (options.candidates.length === 0) {
    return { order: [ORIGIN_INDEX], cost: 0 }
  }

  const dijkstraSeed = buildTourDijkstra(matrix, options)
  const insertionSeed = buildTour(matrix, options)

  const improvedD = dijkstraSeed.length <= 2
    ? { order: dijkstraSeed, cost: tourCost(dijkstraSeed, matrix, options.endIndex) }
    : improveTour(dijkstraSeed, matrix, options.endIndex)

  const improvedI = insertionSeed.length <= 2
    ? { order: insertionSeed, cost: tourCost(insertionSeed, matrix, options.endIndex) }
    : improveTour(insertionSeed, matrix, options.endIndex)

  return improvedD.cost <= improvedI.cost + EPSILON ? improvedD : improvedI
}
