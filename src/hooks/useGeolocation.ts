import { useEffect, useRef, useState } from "react";

export interface LiveGeo {
  lat: number;
  lng: number;
  /** Accuracy radius in metres (1 sigma). */
  accuracy: number;
  /** Heading in degrees clockwise from true north, or null if unknown. */
  heading: number | null;
  /** Speed in m/s or null. */
  speed: number | null;
  timestamp: number;
}

export type GeoStatus =
  | "idle"
  | "requesting"
  | "watching"
  | "denied"
  | "unavailable"
  | "error";

/** Reject fixes worse than this (metres) once we already have a decent one. */
const MAX_ACCURACY_M = 120;
/** Reject jumps implying a speed above this (m/s) — GPS glitch guard. */
const MAX_SPEED_MPS = 12;

const EARTH_R = 6378137;
function metres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng) * Math.cos(toRad((a.lat + b.lat) / 2));
  return Math.sqrt(dLat * dLat + dLng * dLng) * EARTH_R;
}

function shortestAngle(from: number, to: number): number {
  let d = ((to - from + 540) % 360) - 180;
  return d;
}

export function useGeolocation(enabled: boolean) {
  const [position, setPosition] = useState<LiveGeo | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const lastHeading = useRef<number | null>(null);
  const compassHeading = useRef<number | null>(null);
  /** Filtered (smoothed) position kept outside React state. */
  const filtered = useRef<LiveGeo | null>(null);

  // --- Device compass fallback (used when GPS gives no heading) -----------
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onOrient = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      const wk = typeof e.webkitCompassHeading === "number" ? e.webkitCompassHeading : null;
      if (wk != null && Number.isFinite(wk)) {
        compassHeading.current = wk;
        return;
      }
      if (typeof e.alpha === "number" && Number.isFinite(e.alpha)) {
        // alpha is counter-clockwise from north on most Android devices.
        compassHeading.current = (360 - e.alpha) % 360;
      }
    };
    window.addEventListener("deviceorientationabsolute", onOrient as EventListener);
    window.addEventListener("deviceorientation", onOrient as EventListener);
    return () => {
      window.removeEventListener("deviceorientationabsolute", onOrient as EventListener);
      window.removeEventListener("deviceorientation", onOrient as EventListener);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      if (watchId.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId.current);
      }
      watchId.current = null;
      filtered.current = null;
      setStatus("idle");
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      setError("Geolocation not supported");
      return;
    }

    setStatus("requesting");
    setError(null);

    const onPos = (p: GeolocationPosition) => {
      setStatus("watching");
      const acc = Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : 30;
      const raw = { lat: p.coords.latitude, lng: p.coords.longitude };
      const prev = filtered.current;

      // 1) Accuracy gate — drop junk fixes once we have something usable.
      if (prev && acc > MAX_ACCURACY_M && acc > prev.accuracy * 2.5) return;

      // 2) Impossible-jump gate.
      if (prev) {
        const dt = Math.max((p.timestamp - prev.timestamp) / 1000, 0.5);
        const jump = metres(prev, raw);
        if (jump / dt > MAX_SPEED_MPS && jump > Math.max(acc, 25)) return;
      }

      // 3) Low-pass filter — weight the new fix by its relative accuracy.
      let lat = raw.lat;
      let lng = raw.lng;
      if (prev) {
        const w = Math.min(
          0.9,
          Math.max(0.15, prev.accuracy / (prev.accuracy + acc))
        );
        lat = prev.lat + (raw.lat - prev.lat) * w;
        lng = prev.lng + (raw.lng - prev.lng) * w;
      }

      // 4) Heading: GPS course → derived from movement → device compass.
      let heading: number | null =
        p.coords.heading != null && Number.isFinite(p.coords.heading) && (p.coords.speed ?? 0) > 0.4
          ? p.coords.heading
          : null;
      if (heading == null && prev) {
        const moved = metres(prev, { lat, lng });
        if (moved > Math.max(2, acc * 0.25)) {
          const dLat = lat - prev.lat;
          const dLng =
            (lng - prev.lng) * Math.cos(((lat + prev.lat) / 2 * Math.PI) / 180);
          heading = ((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360;
        }
      }
      if (heading == null) heading = compassHeading.current;
      if (heading == null) heading = lastHeading.current;
      // Smooth heading to avoid jitter.
      if (heading != null && lastHeading.current != null) {
        heading =
          (lastHeading.current + shortestAngle(lastHeading.current, heading) * 0.35 + 360) % 360;
      }
      if (heading != null) lastHeading.current = heading;

      const next: LiveGeo = {
        lat,
        lng,
        accuracy: acc,
        heading,
        speed: p.coords.speed != null && Number.isFinite(p.coords.speed) ? p.coords.speed : null,
        timestamp: p.timestamp,
      };
      filtered.current = next;
      setPosition(next);
    };

    const onErr = (e: GeolocationPositionError) => {
      setError(e.message);
      if (e.code === e.PERMISSION_DENIED) setStatus("denied");
      else setStatus("error");
    };

    watchId.current = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 20000,
    });

    return () => {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, [enabled]);

  return { position, status, error };
}
