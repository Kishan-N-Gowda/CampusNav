import { useEffect, useState, useCallback } from "react";
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
  return {
    id: row.id,
    slug: row.slug,
    name: { en: row.name_en, kn: row.name_kn || row.name_en },
    category: row.category,
    floor: Number.isFinite(Number(row.floor)) ? Number(row.floor) : 0,
    icon: row.icon || "MapPin",
    description: row.description || undefined,
    hidden: !!row.hidden,
    x: Number(row.x),
    y: Number(row.y),
  };
}

function rowToPath(p: any): CampusPath {
  const type = (p.type as "walk" | "connector") ?? "walk";
  let points: { x: number; y: number }[] = [];
  if (Array.isArray(p.points)) {
    points = p.points
      .map((pt: any) => ({ x: Number(pt?.x), y: Number(pt?.y) }))
      .filter((pt: any) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
  }
  return {
    id: p.id,
    source_id: p.source_id,
    destination_id: p.destination_id,
    distance: Number(p.distance),
    floor: Number(p.floor ?? 0),
    type,
    to_floor: p.to_floor == null ? null : Number(p.to_floor),
    points,
  };
}

export function useCampusData() {
  // Hydrate from cache synchronously so the UI works while offline.
  const initial = readCache<CampusLocation, CampusPath>();
  const [state, setState] = useState<State>({
    locations: initial?.locations ?? [],
    paths: initial?.paths ?? [],
    loading: !initial,
    error: null,
    fromCache: !!initial,
    cachedAt: initial?.cachedAt ?? null,
  });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: s.locations.length === 0, error: null }));
    try {
      const [locRes, pathRes] = await Promise.all([
        supabase.from("locations").select("*").order("name_en"),
        supabase.from("paths").select("*"),
      ]);
      if (locRes.error) throw locRes.error;
      const locations = (locRes.data ?? []).map(rowToLocation);
      const paths = (pathRes.data ?? []).map(rowToPath);

      writeCache(locations, paths);
      setState({
        locations,
        paths,
        loading: false,
        error: null,
        fromCache: false,
        cachedAt: Date.now(),
      });
    } catch (err: any) {
      // Network/Supabase failure — keep cached data if any.
      setState((s) => ({
        ...s,
        loading: false,
        error: err?.message ?? "Failed to load",
        fromCache: s.locations.length > 0,
      }));
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
