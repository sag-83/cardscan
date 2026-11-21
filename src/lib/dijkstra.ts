/**
 * Dijkstra and A* on a weighted directed graph.
 *
 * Used by the trip router to grow an efficient day tour: from the current
 * stop, Dijkstra finds the cheapest path to the next shop on a sparse
 * near-neighbor graph built from real road times (OSRM matrix).
 */

export type GraphEdge = { to: number; weight: number }
export type SparseGraph = Map<number, GraphEdge[]>

export interface ShortestPathResult {
  dist: Map<number, number>
  prev: Map<number, number | null>
}

/** Binary-heap Dijkstra — O((V+E) log V). */
export function dijkstra(graph: SparseGraph, source: number): ShortestPathResult {
  const dist = new Map<number, number>()
  const prev = new Map<number, number | null>()
  const heap = new MinHeap()

  dist.set(source, 0)
  prev.set(source, null)
  heap.push(source, 0)

  while (heap.size > 0) {
    const { id: u, priority: du } = heap.pop()!
    if (du !== dist.get(u)) continue // stale

    const edges = graph.get(u)
    if (!edges) continue
    for (const { to: v, weight } of edges) {
      if (!Number.isFinite(weight) || weight < 0) continue
      const next = du + weight
      const known = dist.get(v)
      if (known !== undefined && next >= known) continue
      dist.set(v, next)
      prev.set(v, u)
      heap.push(v, next)
    }
  }

  return { dist, prev }
}

/**
 * A* toward `goal` with an admissible heuristic (never overestimates).
 * Same as Dijkstra when heuristic is 0; faster when the heuristic points well.
 */
export function aStar(
  graph: SparseGraph,
  source: number,
  goal: number,
  heuristic: (node: number) => number,
): ShortestPathResult {
  const dist = new Map<number, number>()
  const prev = new Map<number, number | null>()
  const heap = new MinHeap()

  dist.set(source, 0)
  prev.set(source, null)
  heap.push(source, heuristic(source))

  while (heap.size > 0) {
    const { id: u, priority: _f } = heap.pop()!
    if (u === goal) break
    const du = dist.get(u)
    if (du === undefined) continue

    const edges = graph.get(u)
    if (!edges) continue
    for (const { to: v, weight } of edges) {
      if (!Number.isFinite(weight) || weight < 0) continue
      const next = du + weight
      const known = dist.get(v)
      if (known !== undefined && next >= known) continue
      dist.set(v, next)
      prev.set(v, u)
      heap.push(v, next + heuristic(v))
    }
  }

  return { dist, prev }
}

/** Reconstruct source → target path (inclusive), or [] if unreachable. */
export function reconstructPath(
  prev: Map<number, number | null>,
  source: number,
  target: number,
): number[] {
  if (!prev.has(target) && target !== source) return []
  const path: number[] = []
  let cur: number | null = target
  while (cur !== null) {
    path.push(cur)
    if (cur === source) break
    cur = prev.get(cur) ?? null
  }
  path.reverse()
  if (path[0] !== source) return []
  return path
}

/**
 * Sparse k-nearest graph from a dense cost matrix.
 * Each node links to its `k` cheapest neighbors (asymmetric OK).
 */
export function buildKnnGraph(
  matrix: number[][],
  nodeIds: number[],
  k = 8,
): SparseGraph {
  const graph: SparseGraph = new Map()
  for (const u of nodeIds) {
    const scored: GraphEdge[] = []
    for (const v of nodeIds) {
      if (u === v) continue
      const w = matrix[u]?.[v]
      if (!Number.isFinite(w)) continue
      scored.push({ to: v, weight: w })
    }
    scored.sort((a, b) => a.weight - b.weight)
    graph.set(u, scored.slice(0, Math.max(1, k)))
  }
  // Ensure end/origin stay reachable: also add reciprocal best edges if missing.
  for (const u of nodeIds) {
    const outs = graph.get(u) ?? []
    for (const { to: v, weight } of outs) {
      const back = graph.get(v) ?? []
      if (!back.some((e) => e.to === u)) {
        back.push({ to: u, weight: matrix[v]?.[u] ?? weight })
        graph.set(v, back)
      }
    }
  }
  return graph
}

class MinHeap {
  private data: Array<{ id: number; priority: number }> = []

  get size() {
    return this.data.length
  }

  push(id: number, priority: number) {
    this.data.push({ id, priority })
    this.bubbleUp(this.data.length - 1)
  }

  pop(): { id: number; priority: number } | undefined {
    if (!this.data.length) return undefined
    const top = this.data[0]
    const last = this.data.pop()!
    if (this.data.length) {
      this.data[0] = last
      this.bubbleDown(0)
    }
    return top
  }

  private bubbleUp(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.data[p].priority <= this.data[i].priority) break
      ;[this.data[p], this.data[i]] = [this.data[i], this.data[p]]
      i = p
    }
  }

  private bubbleDown(i: number) {
    const n = this.data.length
    while (true) {
      let best = i
      const l = i * 2 + 1
      const r = l + 1
      if (l < n && this.data[l].priority < this.data[best].priority) best = l
      if (r < n && this.data[r].priority < this.data[best].priority) best = r
      if (best === i) break
      ;[this.data[best], this.data[i]] = [this.data[i], this.data[best]]
      i = best
    }
  }
}
