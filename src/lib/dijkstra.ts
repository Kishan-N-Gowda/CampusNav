import type { CampusLocation, CampusPath } from "@/data/locations";
import { euclidean } from "@/data/locations";

interface Edge {
  to: string;
  weight: number;
  isConnector: boolean;
}

/**
 * Floor-aware Dijkstra.
 * - Walk edges only join nodes on the same floor.
 * - Connector edges (stairs/lifts) join nodes across floors and add a small
 *   penalty so a same-floor walk is preferred when possible.
 * - When no explicit edges exist, falls back to a same-floor Euclidean graph
 *   so the navigator still works before paths are configured.
 */
const CONNECTOR_PENALTY = 12; // metres-equivalent extra cost per floor change

export function shortestPath(
  locations: CampusLocation[],
  paths: CampusPath[],
  fromId: string,
  toId: string
): { route: CampusLocation[]; distance: number } | null {
  if (fromId === toId) {
    const loc = locations.find((l) => l.id === fromId);
    return loc ? { route: [loc], distance: 0 } : null;
  }

  const byId = new Map(locations.map((l) => [l.id, l]));
  if (!byId.has(fromId) || !byId.has(toId)) return null;

  const adj = new Map<string, Edge[]>();
  for (const l of locations) adj.set(l.id, []);

  if (paths.length > 0) {
    for (const p of paths) {
      const a = byId.get(p.source_id);
      const b = byId.get(p.destination_id);
      if (!a || !b) continue;
      const isConnector = p.type === "connector";
      // Reject malformed walk edges that span floors.
      if (!isConnector && (a.floor ?? 0) !== (b.floor ?? 0)) continue;
      const w =
        (p.distance > 0 ? p.distance : euclidean(a, b)) +
        (isConnector ? CONNECTOR_PENALTY : 0);
      adj.get(a.id)!.push({ to: b.id, weight: w, isConnector });
      adj.get(b.id)!.push({ to: a.id, weight: w, isConnector });
    }
  } else {
    // Same-floor fully-connected fallback.
    for (let i = 0; i < locations.length; i++) {
      for (let j = i + 1; j < locations.length; j++) {
        const a = locations[i];
        const b = locations[j];
        if ((a.floor ?? 0) !== (b.floor ?? 0)) continue;
        const w = euclidean(a, b);
        adj.get(a.id)!.push({ to: b.id, weight: w, isConnector: false });
        adj.get(b.id)!.push({ to: a.id, weight: w, isConnector: false });
      }
    }
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();
  for (const l of locations) {
    dist.set(l.id, Infinity);
    prev.set(l.id, null);
  }
  dist.set(fromId, 0);

  while (visited.size < locations.length) {
    let u: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d;
        u = id;
      }
    }
    if (u === null || best === Infinity) break;
    if (u === toId) break;
    visited.add(u);
    for (const edge of adj.get(u) ?? []) {
      if (visited.has(edge.to)) continue;
      const alt = best + edge.weight;
      if (alt < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, alt);
        prev.set(edge.to, u);
      }
    }
  }

  if ((dist.get(toId) ?? Infinity) === Infinity) return null;

  const route: CampusLocation[] = [];
  let cur: string | null = toId;
  while (cur) {
    const loc = byId.get(cur);
    if (!loc) return null;
    route.unshift(loc);
    cur = prev.get(cur) ?? null;
  }
  return { route, distance: dist.get(toId) ?? 0 };
}
