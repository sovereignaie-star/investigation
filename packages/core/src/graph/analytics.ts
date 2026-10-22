/**
 * P4-011 — graph analytics over the case projection graph: degree / betweenness
 * / closeness centrality, PageRank, community detection and shortest paths.
 *
 * Semantics deliberately mirror NetworkX 3.7 (the reference of record,
 * `fixtures/graph/networkx-reference.json`) because the acceptance criterion is
 * "results match NetworkX on a reference":
 * - degree centrality: NetworkX convention — 1 for every node when n ≤ 1;
 * - betweenness: Brandes 2001, undirected, normalized 2/((n-1)(n-2));
 * - closeness: Wasserman–Faust improved scaling (NetworkX default);
 * - PageRank: power iteration with the same L1 stopping rule (err < n·tol);
 * - communities: semi-synchronous label propagation (Cordasco & Gargano 2010,
 *   `label_propagation_communities`): greedy largest-first coloring, then
 *   Prec-Max label updates per color class until stable;
 * - shortest paths: undirected BFS.
 *
 * Input normalization (documented contract, exercised by the fixture which
 * carries one self-loop and one duplicate edge): self-loops are dropped,
 * duplicate edges are collapsed, edges referencing nodes absent from the node
 * list are ignored. The graph is treated as undirected — a claim edge joins
 * two entities in both directions. Tie-breaking among equally short paths is
 * implementation-defined (declared limit, DECLARED_LIMITS L-56).
 */
/** Minimal structural shape — the ledger `Graph` projection satisfies it. */
export interface GraphAnalyticsInput {
  nodes: { id: string }[];
  edges: { source: string; target: string }[];
}

/** Internal adjacency: node insertion order + neighbor lists (index-sorted). */
interface Adjacency {
  order: string[];
  index: Map<string, number>;
  neighbors: number[][];
}

function buildAdjacency(g: GraphAnalyticsInput): Adjacency {
  const order = g.nodes.map((n) => n.id);
  const index = new Map<string, number>();
  order.forEach((id, i) => {
    // Later duplicates of an id keep the first index (first occurrence wins).
    if (!index.has(id)) index.set(id, i);
  });
  const neighbors: number[][] = order.map(() => []);
  const seen = new Set<string>();
  for (const e of g.edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === undefined || b === undefined || a === b) continue; // self-loop / unknown endpoint
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue; // duplicate edge
    seen.add(key);
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  for (const list of neighbors) list.sort((x, y) => x - y);
  return { order, index, neighbors };
}

function zeros(adj: Adjacency): Float64Array {
  return new Float64Array(adj.order.length);
}

function toMap(adj: Adjacency, values: ArrayLike<number>): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < adj.order.length; i++) out.set(adj.order[i], values[i]);
  return out;
}

/**
 * Degree centrality — NetworkX convention: `1` for every node when the graph
 * has at most one node (division by zero is defined as full centrality).
 */
export function degreeCentrality(g: GraphAnalyticsInput): Map<string, number> {
  const adj = buildAdjacency(g);
  const n = adj.order.length;
  if (n === 0) return new Map();
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    values[i] = n <= 1 ? 1 : adj.neighbors[i].length / (n - 1);
  }
  return toMap(adj, values);
}

/**
 * Betweenness centrality — Brandes 2001 (undirected, unweighted), normalized
 * like NetworkX: raw pair counts × 2/((n-1)(n-2)) for n > 2.
 */
export function betweennessCentrality(g: GraphAnalyticsInput): Map<string, number> {
  const adj = buildAdjacency(g);
  const n = adj.order.length;
  const between = zeros(adj);
  if (n < 3) return toMap(adj, between);

  for (let s = 0; s < n; s++) {
    const stack: number[] = [];
    const dist = new Int32Array(n).fill(-1);
    const sigma = new Float64Array(n);
    const pred: number[][] = Array.from({ length: n }, () => []);
    sigma[s] = 1;
    dist[s] = 0;
    const queue = [s];
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q];
      stack.push(v);
      for (const w of adj.neighbors[v]) {
        if (dist[w] < 0) {
          dist[w] = dist[v] + 1;
          queue.push(w);
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          pred[w].push(v);
        }
      }
    }
    const delta = zeros(adj);
    for (let i = stack.length - 1; i >= 0; i--) {
      const w = stack[i];
      for (const v of pred[w]) {
        delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      }
      if (w !== s) between[w] += delta[w];
    }
  }

  // Undirected paths were counted in both directions.
  const scale = 2 / ((n - 1) * (n - 2));
  for (let i = 0; i < n; i++) between[i] = (between[i] / 2) * scale;
  return toMap(adj, between);
}

/**
 * Closeness centrality — NetworkX default (Wasserman–Faust improved):
 * (r-1)/totsp over the reachable component (r = reachable nodes incl. self),
 * scaled by (r-1)/(n-1). Isolated nodes score 0.
 */
export function closenessCentrality(g: GraphAnalyticsInput): Map<string, number> {
  const adj = buildAdjacency(g);
  const n = adj.order.length;
  const values = zeros(adj);
  if (n === 0) return toMap(adj, values);

  for (let v = 0; v < n; v++) {
    const { count, totsp } = bfsSums(adj, v);
    if (count > 1) {
      let c = (count - 1) / totsp;
      if (n > 1) c *= (count - 1) / (n - 1);
      values[v] = c;
    }
  }
  return toMap(adj, values);
}

function bfsSums(adj: Adjacency, source: number): { count: number; totsp: number } {
  const dist = new Int32Array(adj.order.length).fill(-1);
  dist[source] = 0;
  const queue = [source];
  let totsp = 0;
  let count = 0;
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q];
    count += 1;
    totsp += dist[v];
    for (const w of adj.neighbors[v]) {
      if (dist[w] < 0) {
        dist[w] = dist[v] + 1;
        queue.push(w);
      }
    }
  }
  return { count, totsp };
}

/**
 * PageRank — power iteration with the NetworkX/SciPy formulation: row-stochastic
 * transition, dangling mass redistributed uniformly, teleportation (1-alpha)
 * uniform; stops when the L1 error drops below n·tol. Returns the raw iteration
 * if it does not converge within maxIter (same value the caller would get from
 * NetworkX raising PowerIterationFailedConvergence is not silently faked).
 */
export function pageRank(g: GraphAnalyticsInput, opts: { alpha?: number; maxIter?: number; tol?: number } = {}): Map<string, number> {
  const adj = buildAdjacency(g);
  const n = adj.order.length;
  if (n === 0) return new Map();
  const alpha = opts.alpha ?? 0.85;
  const maxIter = opts.maxIter ?? 100;
  const tol = opts.tol ?? 1e-6;

  const x = new Float64Array(n).fill(1 / n);
  const dangling = new Float64Array(n).fill(1 / n); // uniform dangling weights
  const next = new Float64Array(n);
  for (let iter = 0; iter < maxIter; iter++) {
    const last = Float64Array.from(x);
    next.fill(0);
    let danglingSum = 0;
    for (let v = 0; v < n; v++) {
      if (adj.neighbors[v].length === 0) {
        danglingSum += last[v];
        continue;
      }
      const share = last[v] / adj.neighbors[v].length;
      for (const w of adj.neighbors[v]) next[w] += share;
    }
    let err = 0;
    for (let v = 0; v < n; v++) {
      x[v] = alpha * next[v] + alpha * danglingSum * dangling[v] + (1 - alpha) / n;
      err += Math.abs(x[v] - last[v]);
    }
    if (err < n * tol) break;
  }
  return toMap(adj, x);
}

/**
 * Communities — semi-synchronous label propagation (Cordasco & Gargano 2010),
 * the deterministic NetworkX `label_propagation_communities`:
 * 1. greedy largest-first coloring (independent color classes);
 * 2. every node starts as its own label (insertion index);
 * 3. per color class, Prec-Max update: the node takes the unique most frequent
 *    neighbor label; on ties it keeps its label if that label is among the
 *    best, otherwise the largest label wins;
 * 4. repeat until stable; nodes with no neighbors keep their own label.
 * Output: each community sorted lexicographically, communities sorted by
 * first member (the label values themselves are not part of the result).
 */
export function labelPropagationCommunities(g: GraphAnalyticsInput): string[][] {
  const adj = buildAdjacency(g);
  const n = adj.order.length;
  if (n === 0) return [];

  const classes = greedyColoring(adj);
  const label = new Int32Array(n);
  for (let i = 0; i < n; i++) label[i] = i; // unique label per node

  let changed = true;
  while (changed) {
    changed = labelUpdatePass(adj, label, classes);
  }

  const byLabel = new Map<number, string[]>();
  for (let v = 0; v < n; v++) {
    const list = byLabel.get(label[v]) ?? [];
    list.push(adj.order[v]);
    byLabel.set(label[v], list);
  }
  const communities = [...byLabel.values()];
  for (const c of communities) c.sort();
  communities.sort((a, b) => a[0].localeCompare(b[0]));
  return communities;
}

/** Greedy largest-first coloring: highest degree first (stable on insertion
 *  order), smallest available color. Returns color classes in first-occurrence
 *  order — nodes of one class are pairwise non-adjacent, so their label updates
 *  within a pass are independent (the semi-synchronous property). */
function greedyColoring(adj: Adjacency): number[][] {
  const n = adj.order.length;
  const order = [...adj.order.keys()].sort((a, b) => adj.neighbors[b].length - adj.neighbors[a].length);
  const color = new Int32Array(n).fill(-1);
  for (const v of order) {
    const used = new Set<number>();
    for (const w of adj.neighbors[v]) if (color[w] >= 0) used.add(color[w]);
    let c = 0;
    while (used.has(c)) c++;
    color[v] = c;
  }
  const classes: number[][] = [];
  const classIndex = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    const c = color[v];
    let ci = classIndex.get(c);
    if (ci === undefined) {
      ci = classes.length;
      classIndex.set(c, ci);
      classes.push([]);
    }
    classes[ci].push(v);
  }
  return classes;
}

/** One semi-synchronous pass: every color class updates once. Returns whether
 *  any label changed. */
function labelUpdatePass(adj: Adjacency, label: Int32Array, classes: number[][]): boolean {
  let changed = false;
  for (const cls of classes) {
    for (const v of cls) {
      if (applyPrecMax(adj, label, v)) changed = true;
    }
  }
  return changed;
}

/** Prec-Max update (Cordasco & Gargano 2010): take the unique most frequent
 *  neighbor label; on ties keep the current label if it is among the best,
 *  otherwise the largest label wins. Returns whether the label changed. */
function applyPrecMax(adj: Adjacency, label: Int32Array, v: number): boolean {
  const labels = mostFrequentLabels(adj, label, v);
  if (labels.length === 0) return false; // no neighbors: own community
  if (labels.length === 1) {
    const changed = label[v] !== labels[0];
    label[v] = labels[0];
    return changed;
  }
  if (labels.includes(label[v])) return false;
  label[v] = Math.max(...labels); // Prec-Max tie-break
  return true;
}

/** Labels of the neighbors of `v` that occur with maximum frequency. */
function mostFrequentLabels(adj: Adjacency, label: Int32Array, v: number): number[] {
  const freq = new Map<number, number>();
  for (const w of adj.neighbors[v]) {
    freq.set(label[w], (freq.get(label[w]) ?? 0) + 1);
  }
  let max = 0;
  for (const f of freq.values()) if (f > max) max = f;
  return [...freq.entries()].filter(([, f]) => f === max).map(([l]) => l);
}

/** Shortest-path lengths (unweighted BFS) from one source. Unreachable nodes
 *  are absent from the result (NetworkX dict semantics). Unknown source throws. */
export function shortestPathLengths(g: GraphAnalyticsInput, source: string): Map<string, number> {
  const adj = buildAdjacency(g);
  const s = requireNode(adj, source, "source");
  const dist = new Int32Array(adj.order.length).fill(-1);
  dist[s] = 0;
  const queue = [s];
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q];
    for (const w of adj.neighbors[v]) {
      if (dist[w] < 0) {
        dist[w] = dist[v] + 1;
        queue.push(w);
      }
    }
  }
  const out = new Map<string, number>();
  for (let v = 0; v < dist.length; v++) {
    if (dist[v] >= 0) out.set(adj.order[v], dist[v]);
  }
  return out;
}

/** One shortest path (undirected BFS, neighbor order by node index). Returns
 *  null when unreachable; [source] when source === target; throws on unknown
 *  node ids (fail-closed). */
export function shortestPath(g: GraphAnalyticsInput, source: string, target: string): string[] | null {
  const adj = buildAdjacency(g);
  const s = requireNode(adj, source, "source");
  const t = requireNode(adj, target, "target");
  if (s === t) return [adj.order[s]];
  const prev = new Int32Array(adj.order.length).fill(-2);
  prev[s] = -1;
  const queue = [s];
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q];
    for (const w of adj.neighbors[v]) {
      if (prev[w] === -2) {
        prev[w] = v;
        if (w === t) return reconstruct(adj, prev, t);
        queue.push(w);
      }
    }
  }
  return null;
}

function reconstruct(adj: Adjacency, prev: Int32Array, t: number): string[] {
  const path: string[] = [];
  for (let v = t; v >= 0; v = prev[v]) path.push(adj.order[v]);
  return path.reverse();
}

function requireNode(adj: Adjacency, id: string, role: string): number {
  const i = adj.index.get(id);
  if (i === undefined) {
    throw new Error(`graph analytics: unknown ${role} node "${id}" (fail-closed)`);
  }
  return i;
}
