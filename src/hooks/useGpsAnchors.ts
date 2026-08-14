import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadAnchors, saveAnchors, type GpsAnchor } from "@/lib/geo";

const SETTINGS_KEY = "gps_anchors";

/** Stored shape of the `gps_anchors` app setting. */
interface AnchorsSetting {
  anchors?: GpsAnchor[];
}

function sanitize(list: unknown): GpsAnchor[] {
  if (!Array.isArray(list)) return [];
  const out: GpsAnchor[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Partial<GpsAnchor>;
    if (
      typeof a.lat !== "number" ||
      typeof a.lng !== "number" ||
      typeof a.x !== "number" ||
      typeof a.y !== "number" ||
      !Number.isFinite(a.lat) ||
      !Number.isFinite(a.lng) ||
      !Number.isFinite(a.x) ||
      !Number.isFinite(a.y)
    ) {
      continue;
    }
    const id = String(a.id || a.label || `anchor-${i}`);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    out.push({
      id,
      label: String(a.label || "Anchor"),
      lat: a.lat,
      lng: a.lng,
      x: a.x,
      y: a.y,
      floor: typeof a.floor === "number" ? a.floor : 0,
    });
  }
  return out;
}

/**
 * GPS anchors persisted in the database (`app_settings.gps_anchors`) with a
 * localStorage mirror so calibration survives refreshes, redeploys, sign-ins
 * and offline use.
 */
export function useGpsAnchors() {
  const [anchors, setAnchorsState] = useState<GpsAnchor[]>(() =>
    sanitize(loadAnchors())
  );
  /** True once the database row has been read at least once. */
  const [loaded, setLoaded] = useState(false);
  const savingRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", SETTINGS_KEY)
        .single();

      if (savingRef.current) return;

      if (error) {
        console.warn("[gps-anchors] fetch error:", error.message);
        const local = sanitize(loadAnchors());
        if (local.length > 0) setAnchorsState(local);
        return;
      }

      const val = data?.value as AnchorsSetting | undefined;
      const remote = sanitize(val?.anchors);
      if (remote.length > 0) {
        setAnchorsState(remote);
        saveAnchors(remote);
      } else {
        const local = sanitize(loadAnchors());
        if (local.length > 0) setAnchorsState(local);
      }
    } catch (err) {
      console.warn("[gps-anchors] exception:", err);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Fetch on initial mount and subscribe to realtime updates
  useEffect(() => {
    refresh();

    const channel = supabase
      .channel(`gps-anchors-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        () => {
          if (!savingRef.current) refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  /** Persist anchors locally and to the database (admins only server-side). */
  const setAnchors = useCallback(async (next: GpsAnchor[]) => {
    const clean = sanitize(next);
    setAnchorsState(clean);
    saveAnchors(clean);
    savingRef.current = true;
    try {
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          { key: SETTINGS_KEY, value: { anchors: clean } as never },
          { onConflict: "key" }
        );
      if (error) console.warn("[gps-anchors] save failed:", error.message);
    } finally {
      savingRef.current = false;
    }
  }, []);

  return { anchors, setAnchors, loaded, refresh };
}
