import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { mcpSupabase } from "../supabase";
import { parsePauseValue } from "../../databasePause";

const COORD_TO_METERS = 1.5;
const WALKING_M_PER_MIN = 78;
const CONNECTOR_PENALTY = 12;

type Loc = { id: string; slug: string; name_en: string; name_kn: string; floor: number; x: number; y: number };
type Path = {
  source_id: string;
  destination_id: string;
  distance: number;
  type: "walk" | "connector";
  floor: number;
  to_floor: number | null;
};

function euclid(a: Loc, b: Loc) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function dijkstra(locs: Loc[], paths: Path[], fromId: string, toId: string) {
  if (fromId === toId) {
    const l = locs.find((x) => x.id === fromId);
    return l ? { route: [l], distance: 0 } : null;
  }
  const byId = new Map(locs.map((l) => [l.id, l]));
  if (!byId.has(fromId) || !byId.has(toId)) return null;
  const adj = new Map<string, { to: string; w: number }[]>();
  for (const l of locs) adj.set(l.id, []);
  if (paths.length) {
    for (const p of paths) {
      const a = byId.get(p.source_id);
      const b = byId.get(p.destination_id);
      if (!a || !b) continue;
      const isConn = p.type === "connector";
      if (!isConn && (a.floor ?? 0) !== (b.floor ?? 0)) continue;
      const w = (p.distance > 0 ? p.distance : euclid(a, b)) + (isConn ? CONNECTOR_PENALTY : 0);
      adj.get(a.id)!.push({ to: b.id, w });
      adj.get(b.id)!.push({ to: a.id, w });
    }
  } else {
    for (let i = 0; i < locs.length; i++)
      for (let j = i + 1; j < locs.length; j++) {
        const a = locs[i];
        const b = locs[j];
        if ((a.floor ?? 0) !== (b.floor ?? 0)) continue;
        const w = euclid(a, b);
        adj.get(a.id)!.push({ to: b.id, w });
        adj.get(b.id)!.push({ to: a.id, w });
      }
  }
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();
  for (const l of locs) {
    dist.set(l.id, Infinity);
    prev.set(l.id, null);
  }
  dist.set(fromId, 0);
  while (visited.size < locs.length) {
    let u: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist)
      if (!visited.has(id) && d < best) {
        best = d;
        u = id;
      }
    if (u === null || best === Infinity) break;
    if (u === toId) break;
    visited.add(u);
    for (const e of adj.get(u) ?? []) {
      if (visited.has(e.to)) continue;
      const alt = best + e.w;
      if (alt < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, alt);
        prev.set(e.to, u);
      }
    }
  }
  if ((dist.get(toId) ?? Infinity) === Infinity) return null;
  const route: Loc[] = [];
  let cur: string | null = toId;
  while (cur) {
    const l = byId.get(cur);
    if (!l) return null;
    route.unshift(l);
    cur = prev.get(cur) ?? null;
  }
  return { route, distance: dist.get(toId) ?? 0 };
}

export default defineTool({
  name: "get_directions",
  title: "Get directions between two campus locations",
  description:
    "Compute the shortest walking route between two campus locations identified by slug. Returns the ordered route, distance in metres, and estimated walking time in minutes.",
  inputSchema: {
    from_slug: z.string().trim().min(1).describe("Slug of the starting location."),
    to_slug: z.string().trim().min(1).describe("Slug of the destination location."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from_slug, to_slug }) => {
    const supabase = mcpSupabase();
    const { data: settings } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["database_paused", "campus_map"]);

    const pausedRow = (settings ?? []).find((s) => s.key === "database_paused");
    const mapRow = (settings ?? []).find((s) => s.key === "campus_map");

    let isPaused = false;
    if (pausedRow?.value != null) {
      isPaused = parsePauseValue(pausedRow.value).paused;
    } else if ((mapRow?.value as any)?.database_paused != null) {
      isPaused = parsePauseValue((mapRow?.value as any).database_paused).paused;
    }

    if (isPaused) {
      return {
        content: [{ type: "text", text: "Campus Navigation is temporarily unavailable." }],
        isError: true,
      };
    }
    const [locRes, pathRes] = await Promise.all([
      supabase.from("locations").select("id,slug,name_en,name_kn,floor,x,y"),
      supabase.from("paths").select("source_id,destination_id,distance,type,floor,to_floor"),
    ]);
    if (locRes.error) return { content: [{ type: "text", text: locRes.error.message }], isError: true };
    const locs = (locRes.data ?? []).map((r: any) => ({ ...r, x: Number(r.x), y: Number(r.y), floor: Number(r.floor ?? 0) }));
    const paths = (pathRes.data ?? []).map((p: any) => ({ ...p, distance: Number(p.distance), floor: Number(p.floor ?? 0) }));
    const from = locs.find((l) => l.slug === from_slug);
    const to = locs.find((l) => l.slug === to_slug);
    if (!from || !to)
      return { content: [{ type: "text", text: `Unknown slug: ${!from ? from_slug : to_slug}` }], isError: true };
    const result = dijkstra(locs, paths, from.id, to.id);
    if (!result) return { content: [{ type: "text", text: "No route found." }], isError: true };
    const meters = Math.round(result.distance * COORD_TO_METERS);
    const minutes = Math.max(1, Math.round(meters / WALKING_M_PER_MIN));
    const route = result.route.map((l) => ({ slug: l.slug, name: l.name_en, floor: l.floor }));
    const payload = { from: from.slug, to: to.slug, distance_meters: meters, walk_minutes: minutes, route };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
