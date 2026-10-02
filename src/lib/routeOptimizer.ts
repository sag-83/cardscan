/**
 * Stop ordering for the trip planner.
 *
 * Choosing the cheapest order to visit N stops is the Travelling Salesman
 * Problem, so an exact answer is out of reach beyond a handful of stops
 * (10 stops is already 360k orderings). Instead this runs the standard
 * heuristic stack used for real-world routing:
 *
 *   1. Cheapest insertion builds a tour by repeatedly dropping in the stop that
 *      adds the least travel. It beats nearest-neighbour, which tends to strand
 *      one far-away stop and backtrack for it at the end.
 *   2. 2-opt removes crossings by reversing a run of stops.
 *   3. Or-opt relocates runs of 1-3 stops elsewhere in the tour, which fixes the
 *      "one stop sitting in the wrong cluster" case that 2-opt can't.
 *
 * At day-trip sizes (under ~30 stops) this lands within a few percent of
 * optimal in milliseconds.
 *
 * Every candidate move is scored by recomputing the whole tour instead of a
 * delta. That's a few hundred extra additions at these sizes and it keeps the
 * search correct for asymmetric cost matrices — real driving times are not
 * symmetric because of one-way streets, ramps and turn restrictions.
 */

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

const EPSILON = 1e-9
const MAX_PASSES = 50
const MAX_SEGMENT_LENGTH = 3

export function tourCost(order: number[], matrix: CostMatrix, roundTrip: boolean): number {
  let total = 0
  for (let i = 0; i < order.length - 1; i++) {
    total += matrix[order[i]][order[i + 1]]
  }
  if (roundTrip && order.length > 1) {
    total += matrix[order[order.length - 1]][order[0]]
  }
  return total
}

export interface BuildTourOptions {
  /** Matrix indices eligible to be visited. Must not include the origin. */
  candidates: number[]
  /** Hard cap on stops. When candidates exceed it, the extras are dropped. */
  limit: number
  roundTrip: boolean
  /**
   * Per-candidate multiplier applied to insertion cost during construction.
   * Below 1 makes a stop more attractive, so it survives the cap. Ordering is
   * always optimised on true cost afterwards, so this only affects selection.
   */
  weights?: Map<number, number>
  /**
   * Decides between candidates whose insertion cost is effectively identical;
   * higher wins. Dense districts produce a lot of these ties — several shops
   * in one building share a coordinate exactly — and without a preference the
   * cap would fall back to whatever order the candidates arrived in.
   */
  tieBreak?: Map<number, number>
}

/**
 * Greedy cheapest insertion. When `limit` is below the candidate count this
 * doubles as stop selection: each round takes the stop that adds the least
 * detour, which naturally keeps the route inside one geographic cluster rather
 * than picking the N closest stops scattered in every direction.
 */
export function buildTour(matrix: CostMatrix, options: BuildTourOptions): number[] {
  const { candidates, limit, roundTrip, weights, tieBreak } = options
  const order = [ORIGIN_INDEX]
  const remaining = new Set(candidates)
  const cap = Math.min(limit, candidates.length)

  while (order.length - 1 < cap && remaining.size > 0) {
    const baseCost = tourCost(order, matrix, roundTrip)
    let bestScore = Infinity
    let bestRank = -Infinity
    let bestCandidate = -1
    let bestPosition = 1

    for (const candidate of remaining) {
      const weight = weights?.get(candidate) ?? 1
      const rank = tieBreak?.get(candidate) ?? 0
      for (let position = 1; position <= order.length; position++) {
        const trial = [...order.slice(0, position), candidate, ...order.slice(position)]
        const score = (tourCost(trial, matrix, roundTrip) - baseCost) * weight
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
function twoOptPass(order: number[], matrix: CostMatrix, roundTrip: boolean): RouteResult {
  let best = order
  let bestCost = tourCost(best, matrix, roundTrip)

  for (let i = 1; i < best.length - 1; i++) {
    for (let j = i + 1; j < best.length; j++) {
      const trial = [
        ...best.slice(0, i),
        ...best.slice(i, j + 1).reverse(),
        ...best.slice(j + 1),
      ]
      const cost = tourCost(trial, matrix, roundTrip)
      if (cost < bestCost - EPSILON) {
        best = trial
        bestCost = cost
      }
    }
  }

  return { order: best, cost: bestCost }
}

/** Lifts runs of 1-3 stops and reinserts them elsewhere, forwards or reversed. */
function orOptPass(order: number[], matrix: CostMatrix, roundTrip: boolean): RouteResult {
  let best = order
  let bestCost = tourCost(best, matrix, roundTrip)

  for (let length = 1; length <= MAX_SEGMENT_LENGTH; length++) {
    for (let start = 1; start + length <= best.length; start++) {
      const segment = best.slice(start, start + length)
      const rest = [...best.slice(0, start), ...best.slice(start + length)]

      for (let position = 1; position <= rest.length; position++) {
        if (position === start) continue
        for (const piece of [segment, [...segment].reverse()]) {
          const trial = [...rest.slice(0, position), ...piece, ...rest.slice(position)]
          const cost = tourCost(trial, matrix, roundTrip)
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
export function improveTour(order: number[], matrix: CostMatrix, roundTrip: boolean): RouteResult {
  let current = order
  let currentCost = tourCost(current, matrix, roundTrip)

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const afterTwoOpt = twoOptPass(current, matrix, roundTrip)
    const afterOrOpt = orOptPass(afterTwoOpt.order, matrix, roundTrip)

    if (afterOrOpt.cost >= currentCost - EPSILON) {
      return { order: afterOrOpt.order, cost: afterOrOpt.cost }
    }
    current = afterOrOpt.order
    currentCost = afterOrOpt.cost
  }

  return { order: current, cost: currentCost }
}

/** Builds a tour and then improves it. The planner's single entry point. */
export function planRoute(matrix: CostMatrix, options: BuildTourOptions): RouteResult {
  const built = buildTour(matrix, options)
  if (built.length <= 2) {
    return { order: built, cost: tourCost(built, matrix, options.roundTrip) }
  }
  return improveTour(built, matrix, options.roundTrip)
}
