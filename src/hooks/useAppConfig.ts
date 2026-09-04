import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import fallbackMap from "@/assets/campus-map.jpg";
import {
  DATABASE_PAUSED_SETTING_KEY,
  DATABASE_PAUSE_EVENT,
  DEFAULT_PAUSE_MESSAGE,
  getDatabasePausedState,
  setLocalDatabasePausedState,
} from "@/lib/databasePause";

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
  const initialPause = getDatabasePausedState();
  const [databasePaused, setDatabasePausedState] = useState<boolean>(initialPause.paused);
  const [pauseMessage, setPauseMessage] = useState<string>(initialPause.message);

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
    try {
      const { data, error } = await supabase.from("app_settings").select("key, value");
      if (error) {
        console.warn("[AppConfig] fetch settings error:", error.message);
        return;
      }
      const rows = data ?? [];

      // Check database_paused / maintenance_mode
      const pauseRow = rows.find(
        (r) => r.key === DATABASE_PAUSED_SETTING_KEY || r.key === "database_paused"
      );
      const mapRow = rows.find((r) => r.key === "campus_map");
      const mapVal = (mapRow?.value && typeof mapRow.value === "object" ? mapRow.value : {}) as Record<string, any>;

      let detectedState: DatabasePauseState | null = null;
      if (pauseRow && pauseRow.value !== undefined && pauseRow.value !== null) {
        detectedState = parsePauseValue(pauseRow.value);
      }

      if (mapVal?.database_paused !== undefined && mapVal?.database_paused !== null) {
        const mapParsed = parsePauseValue(mapVal.database_paused);
        if (!detectedState) {
          detectedState = mapParsed;
        } else if (mapParsed.updatedAt && detectedState.updatedAt && mapParsed.updatedAt > detectedState.updatedAt) {
          detectedState = mapParsed;
        }
      }

      if (detectedState) {
        setDatabasePausedState(detectedState.paused);
        setPauseMessage(detectedState.message);
        setLocalDatabasePausedState(detectedState.paused, detectedState.message);
      } else {
        // If not in database yet, read current local storage state
        const current = getDatabasePausedState();
        setDatabasePausedState(current.paused);
        setPauseMessage(current.message);
      }

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
    } catch (err) {
      console.warn("[AppConfig] exception during refresh:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const setDatabasePaused = useCallback(
    async (paused: boolean, customMessage?: string) => {
      const msg = customMessage || pauseMessage || DEFAULT_PAUSE_MESSAGE;
      const timestamp = new Date().toISOString();

      // 1. Immediately reflect in local state and dispatch events to all hooks
      setDatabasePausedState(paused);
      if (customMessage) setPauseMessage(msg);
      setLocalDatabasePausedState(paused, msg);

      try {
        // Attempt dual persistence:
        // A) Update campus_map (whitelisted in RLS for all users with 'admin' role)
        // B) Upsert database_paused setting directly (allowed for super_admins)
        const { data: mapData } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "campus_map")
          .maybeSingle();

        const existingMap =
          mapData?.value && typeof mapData.value === "object"
            ? (mapData.value as Record<string, any>)
            : {};

        const updatedMap = {
          ...existingMap,
          database_paused: {
            paused,
            message: msg,
            updatedAt: timestamp,
          },
        };

        const [mapRes, directRes] = await Promise.allSettled([
          supabase.from("app_settings").update({ value: updatedMap }).eq("key", "campus_map"),
          supabase.from("app_settings").upsert(
            {
              key: DATABASE_PAUSED_SETTING_KEY,
              value: {
                paused,
                message: msg,
                updatedAt: timestamp,
              },
              updated_at: timestamp,
            },
            { onConflict: "key" }
          ),
        ]);

        const mapOk = mapRes.status === "fulfilled" && !mapRes.value.error;
        const directOk = directRes.status === "fulfilled" && !directRes.value.error;

        if (!mapOk && !directOk) {
          console.warn(
            "[AppConfig] warning: could not persist pause setting to remote database, saved locally only."
          );
        }

        await refresh();
        return true;
      } catch (err) {
        console.warn("[AppConfig] exception saving database_paused:", err);
        return true; // Still return true because local state was updated
      }
    },
    [pauseMessage, refresh]
  );

  useEffect(() => {
    refresh();

    const onLocalPauseChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.paused === "boolean") {
        setDatabasePausedState(detail.paused);
        if (detail.message) setPauseMessage(detail.message);
      }
    };
    window.addEventListener(DATABASE_PAUSE_EVENT, onLocalPauseChange);

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
      window.removeEventListener(DATABASE_PAUSE_EVENT, onLocalPauseChange);
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
    databasePaused,
    pauseMessage,
    setDatabasePaused,
  };
}
