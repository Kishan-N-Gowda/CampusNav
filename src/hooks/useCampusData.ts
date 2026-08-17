import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CampusLocation, CampusPath } from "@/data/locations";
import { readCache, writeCache } from "@/lib/offlineCache";

interface State {
  locations: CampusLocation[];
  paths: CampusPath[];
  loading: boolean;
  error: string | null;
  fromCache: boolean;
  cachedAt: number | null;
}

function rowToLocation(row: any): CampusLocation {
  if (!row || typeof row !== "object") {
    return {
      id: "unknown-" + Math.random().toString(36).slice(2),
      slug: "unknown",
      name: { en: "Location", kn: "ಸ್ಥಳ" },
      category: "facility",
      floor: 0,
      icon: "MapPin",
      hidden: false,
      x: 50,
      y: 50,
    };
  }

  const nameEn = String(row.name_en || row.slug || "Location").trim();
  const nameKn = String(row.name_kn || row.name_en || row.slug || "ಸ್ಥಳ").trim();
  const x = Number(row.x);
  const y = Number(row.y);
  const floorNum = Number(row.floor);

  return {
    id: String(row.id || row.slug || Math.random().toString(36).slice(2)),
    slug: String(row.slug || row.id || "location"),
    name: {
      en: nameEn || "Location",
      kn: nameKn || nameEn || "ಸ್ಥಳ",
    },
    category: String(row.category || "facility"),
    floor: Number.isFinite(floorNum) ? floorNum : 0,
    icon: String(row.icon || "MapPin"),
    description: row.description ? String(row.description) : undefined,
    hidden: Boolean(row.hidden),
    x: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50,
    y: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50,
  };
}

function rowToPath(p: any): CampusPath {
  if (!p || typeof p !== "object") {
    return {
      id: "unknown-" + Math.random().toString(36).slice(2),
      source_id: "",
      destination_id: "",
      distance: 1,
      floor: 0,
      type: "walk",
      to_floor: null,
      points: [],
    };
  }

  const type = p.type === "connector" ? "connector" : "walk";
  let points: { x: number; y: number }[] = [];
  if (Array.isArray(p.points)) {
    points = p.points
      .map((pt: any) => ({ x: Number(pt?.x), y: Number(pt?.y) }))
      .filter((pt: any) => Number.isFinite(pt.x) && Number.isFinite(pt.y))
      .map((pt: any) => ({
        x: Math.min(100, Math.max(0, pt.x)),
        y: Math.min(100, Math.max(0, pt.y)),
      }));
  }

  const dist = Number(p.distance);
  const floorNum = Number(p.floor ?? 0);
  const toFloorNum = p.to_floor == null ? null : Number(p.to_floor);

  return {
    id: String(p.id || Math.random().toString(36).slice(2)),
    source_id: String(p.source_id || ""),
    destination_id: String(p.destination_id || ""),
    distance: Number.isFinite(dist) && dist > 0 ? dist : 1,
    floor: Number.isFinite(floorNum) ? floorNum : 0,
    type,
    to_floor: toFloorNum !== null && Number.isFinite(toFloorNum) ? toFloorNum : null,
    points,
  };
}

export function useCampusData() {
  // Hydrate from cache synchronously so the UI works while offline.
  const initial = readCache<CampusLocation, CampusPath>();
  const [state, setState] = useState<State>({
    locations: Array.isArray(initial?.locations) ? initial.locations.map(rowToLocation) : [],
    paths: Array.isArray(initial?.paths) ? initial.paths.map(rowToPath) : [],
    loading: !initial,
    error: null,
    fromCache: !!initial,
    cachedAt: initial?.cachedAt ?? null,
  });

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setState((s) => ({ ...s, loading: s.locations.length === 0, error: null }));
    try {
      const [locRes, pathRes] = await Promise.all([
        supabase.from("locations").select("*").order("name_en"),
        supabase.from("paths").select("*"),
      ]);
      if (locRes.error) throw locRes.error;
      const locations = (locRes.data ?? []).map(rowToLocation);
      const paths = (pathRes.data ?? []).map(rowToPath);

      try {
        writeCache(locations, paths);
      } catch {
        // Ignore cache errors
      }

      if (mountedRef.current) {
        setState({
          locations,
          paths,
          loading: false,
          error: null,
          fromCache: false,
          cachedAt: Date.now(),
        });
      }
    } catch (err: any) {
      // Network/Supabase failure — keep cached data if any.
      if (mountedRef.current) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err?.message ?? "Failed to load",
          fromCache: s.locations.length > 0,
        }));
      }
    }
  }, []);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("campus-data")
      .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "paths" }, refresh)
      .subscribe();
    const onOnline = () => refresh();
    window.addEventListener("online", onOnline);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh]);

  return { ...state, refresh };
}
