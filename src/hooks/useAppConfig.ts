import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import fallbackMap from "@/assets/campus-map.jpg";

export interface QuickAccessConfig {
  count: number;
  location_ids: string[];
}

export const QUICK_ACCESS_COUNTS = [4, 6, 8, 10] as const;

const MAP_URL_KEY = "campusMapUrl";
const FLOOR_URL_KEY = "campusFloorMapUrls";

/** Stored shape of the `campus_map` app setting. */
interface CampusMapSetting {
  /** Legacy/base map used when a floor has no dedicated map. */
  path?: string | null;
  /** Per-floor storage paths keyed by floor number, e.g. { "0": "...", "1": "..." } */
  floors?: Record<string, string | null>;
}

const readCache = (key: string): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
};

export function useAppConfig() {
  const [quickAccess, setQuickAccess] = useState<QuickAccessConfig>({
    count: 4,
    location_ids: [],
  });
  const [mapPath, setMapPath] = useState<string | null>(null);
  const [mapSrc, setMapSrc] = useState<string>(() => {
    try {
      return localStorage.getItem(MAP_URL_KEY) || fallbackMap;
    } catch {
      return fallbackMap;
    }
  });
  /** floor -> storage path */
  const [floorMapPaths, setFloorMapPaths] = useState<Record<string, string>>({});
  /** floor -> signed URL */
  const [floorMapSrcs, setFloorMapSrcs] = useState<Record<string, string>>(() =>
    readCache(FLOOR_URL_KEY)
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from("app_settings").select("key, value");
    const rows = data ?? [];
    const qa = rows.find((r) => r.key === "quick_access")?.value as unknown as
      | QuickAccessConfig
      | undefined;
    if (qa) {
      setQuickAccess({
        count: Number(qa.count) || 4,
        location_ids: Array.isArray(qa.location_ids) ? qa.location_ids : [],
      });
    }

    const map = rows.find((r) => r.key === "campus_map")?.value as unknown as
      | CampusMapSetting
      | undefined;
    const path = map?.path ?? null;
    setMapPath(path);
    if (path) {
      const { data: signed } = await supabase.storage
        .from("campus-maps")
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      if (signed?.signedUrl) {
        setMapSrc(signed.signedUrl);
        try {
          localStorage.setItem(MAP_URL_KEY, signed.signedUrl);
        } catch {
          /* ignore */
        }
      }
    } else {
      setMapSrc(fallbackMap);
      try {
        localStorage.removeItem(MAP_URL_KEY);
      } catch {
        /* ignore */
      }
    }

    // Per-floor maps
    const rawFloors = map?.floors ?? {};
    const paths: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawFloors)) {
      if (typeof v === "string" && v) paths[k] = v;
    }
    setFloorMapPaths(paths);

    const srcs: Record<string, string> = {};
    await Promise.all(
      Object.entries(paths).map(async ([floor, p]) => {
        const { data: signed } = await supabase.storage
          .from("campus-maps")
          .createSignedUrl(p, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) srcs[floor] = signed.signedUrl;
      })
    );
    setFloorMapSrcs(srcs);
    try {
      localStorage.setItem(FLOOR_URL_KEY, JSON.stringify(srcs));
    } catch {
      /* ignore */
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel(`app-settings-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        () => {
          refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  /** Signed URL for a floor, falling back to the base/default campus map. */
  const mapSrcForFloor = useCallback(
    (floor: number) => floorMapSrcs[String(floor)] || mapSrc,
    [floorMapSrcs, mapSrc]
  );

  /** Floors that have a dedicated map uploaded, sorted ascending. */
  const mappedFloors = useMemo(
    () =>
      Object.keys(floorMapPaths)
        .map(Number)
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b),
    [floorMapPaths]
  );

  return {
    quickAccess,
    mapSrc,
    mapPath,
    floorMapPaths,
    floorMapSrcs,
    mapSrcForFloor,
    mappedFloors,
    loading,
    refresh,
  };
}
