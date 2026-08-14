import { useEffect, useMemo, useRef, useState } from "react";
import {
  projectOnPolyline,
  snapToPaths,
  splitPolyline,
  type Polyline,
  type Projection,
} from "@/lib/geo";
import type { LiveGeo } from "@/hooks/useGeolocation";

interface Args {
  /** Filtered GPS fix (already smoothed by useGeolocation). */
  position: LiveGeo | null;
  /** GPS ↔ map calibration. */
  projection: Projection | null;
  /** Walkable polylines on the visible floor (for snap-to-path). */
  snapPolylines: Polyline[];
  /** Active route polyline on the visible floor (for progress / off-route). */
  routePolyline: { x: number; y: number }[] | null;
  metersPerCoord: number;
  enabled: boolean;
}

export interface LiveTracking {
  /** Animated position in map coords (0-100), or null when unavailable. */
  pos: { x: number; y: number } | null;
  /** Raw (unsnapped) projected GPS position. */
  rawPos: { x: number; y: number } | null;
  /** True when the puck was snapped onto a walkable path. */
  snapped: boolean;
  /** Metres between the user and the active route (null when no route). */
  routeDeviationM: number | null;
  offRoute: boolean;
  /** Portion of the route already walked. */
  travelled: { x: number; y: number }[] | null;
  /** Portion of the route still ahead. */
  remaining: { x: number; y: number }[] | null;
  remainingMeters: number | null;
  /** Index of the route polyline vertex the user is currently approaching. */
  aheadIndex: number | null;
  arrived: boolean;
}

/** Distance (m) beyond which we consider the user off the drawn route. */
const OFF_ROUTE_M = 25;
/** Snap the puck to a path when within this many metres of one. */
const SNAP_M = 10;
/** Arrival radius in metres. */
const ARRIVE_M = 12;

export function useLiveTracking({
  position,
  projection,
  snapPolylines,
  routePolyline,
  metersPerCoord,
  enabled,
}: Args): LiveTracking {
  // Target position in map space, recomputed on every GPS fix.
  const target = useMemo(() => {
    if (!enabled || !projection || !position) return null;
    return projection.toMap(position.lat, position.lng);
  }, [enabled, projection, position]);

  const snapResult = useMemo(() => {
    if (!target) return null;
    const snap = snapToPaths(target, snapPolylines);
    if (snap && snap.distance * metersPerCoord <= SNAP_M) {
      return { x: snap.x, y: snap.y, snapped: true };
    }
    return { x: target.x, y: target.y, snapped: false };
  }, [target, snapPolylines, metersPerCoord]);

  // ---- Animated interpolation towards the target -------------------------
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const current = useRef<{ x: number; y: number } | null>(null);
  const goal = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    goal.current = snapResult ? { x: snapResult.x, y: snapResult.y } : null;
    if (!goal.current) {
      current.current = null;
      setPos(null);
      return;
    }
    if (!current.current) {
      current.current = { ...goal.current };
      setPos({ ...goal.current });
    }
  }, [snapResult]);

  useEffect(() => {
    if (!enabled) {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
      return;
    }
    const tick = () => {
      const g = goal.current;
      const c = current.current;
      if (g && c) {
        const dx = g.x - c.x;
        const dy = g.y - c.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.02) {
          // Ease towards the goal (~15% per frame) for a gliding puck.
          const next = { x: c.x + dx * 0.15, y: c.y + dy * 0.15 };
          current.current = next;
          setPos(next);
        } else if (dist > 0) {
          current.current = { ...g };
          setPos({ ...g });
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [enabled]);

  // ---- Progress along the active route ----------------------------------
  const progress = useMemo(() => {
    if (!pos || !routePolyline || routePolyline.length < 2) {
      return {
        routeDeviationM: null as number | null,
        travelled: null as { x: number; y: number }[] | null,
        remaining: null as { x: number; y: number }[] | null,
        remainingMeters: null as number | null,
        aheadIndex: null as number | null,
      };
    }
    const proj = projectOnPolyline(pos, routePolyline);
    if (!proj) {
      return {
        routeDeviationM: null,
        travelled: null,
        remaining: null,
        remainingMeters: null,
        aheadIndex: null,
      };
    }
    const { travelled, remaining } = splitPolyline(routePolyline, proj);
    let remLen = 0;
    for (let i = 1; i < remaining.length; i++) {
      const dx = remaining[i].x - remaining[i - 1].x;
      const dy = remaining[i].y - remaining[i - 1].y;
      remLen += Math.sqrt(dx * dx + dy * dy);
    }
    return {
      routeDeviationM: proj.distance * metersPerCoord,
      travelled,
      remaining,
      remainingMeters: remLen * metersPerCoord,
      aheadIndex: proj.index,
    };
  }, [pos, routePolyline, metersPerCoord]);

  const offRoute =
    progress.routeDeviationM != null && progress.routeDeviationM > OFF_ROUTE_M;
  const arrived =
    progress.remainingMeters != null && progress.remainingMeters <= ARRIVE_M;

  return {
    pos,
    rawPos: target,
    snapped: !!snapResult?.snapped,
    routeDeviationM: progress.routeDeviationM,
    offRoute,
    travelled: progress.travelled,
    remaining: progress.remaining,
    remainingMeters: progress.remainingMeters,
    aheadIndex: progress.aheadIndex,
    arrived,
  };
}
