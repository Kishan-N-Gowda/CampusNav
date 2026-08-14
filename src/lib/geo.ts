/**
 * GPS calibration & projection between real-world (lat,lng) and the
 * campus map's 0-100 SVG coordinate space.
 *
 * - 0 anchors  → projection unavailable
 * - 1 anchor   → translation only (assumes map is north-up, default scale)
 * - 2 anchors  → exact similarity transform (rotation + scale + translation)
 * - 3+ anchors → least-squares similarity (Umeyama / Kabsch w/ scale)
 *
 * Anchors are persisted in localStorage so calibration survives reloads.
 */

const STORAGE_KEY = "campusnav:gps-anchors-v1";
const EARTH_R = 6378137; // metres
// Fallback metres-per-coord-unit when only 1 anchor is known.
// Campus map: 0-100 ≈ ~150 m → 1.5 m per unit. Tunable in the UI later.
export const DEFAULT_METERS_PER_COORD = 1.5;

export interface GpsAnchor {
  id: string;
  label: string;
  lat: number;
  lng: number;
  /** 0-100 coord space */
  x: number;
  y: number;
  floor?: number;
}

export interface Projection {
  /** lat,lng → map (x,y) in 0-100 */
  toMap: (lat: number, lng: number) => { x: number; y: number };
  /** map (x,y) → lat,lng */
  toGeo: (x: number, y: number) => { lat: number; lng: number };
  /** Approximate metres-per-coord-unit at the campus. */
  metersPerCoord: number;
  /** "translate" | "similarity" */
  kind: "translate" | "similarity";
  /** Number of anchors used. */
  anchorCount: number;
}

/**
 * Format distance to campus:
 * Below 1 km: e.g. "850 m from campus"
 * Above 1 km: e.g. "16.2 km from campus"
 */
export function formatCampusDistance(meters: number, lang: "en" | "kn" = "en"): string {
  if (meters < 1000) {
    const val = Math.round(meters);
    return lang === "kn" ? `ಕ್ಯಾಂಪಸ್‌ನಿಂದ ${val} ಮೀ` : `${val} m from campus`;
  } else {
    const val = (meters / 1000).toFixed(1);
    return lang === "kn" ? `ಕ್ಯಾಂಪಸ್‌ನಿಂದ ${val} ಕಿ.ಮೀ` : `${val} km from campus`;
  }
}

// ---------- storage ----------

export function loadAnchors(): GpsAnchor[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (a) =>
        a &&
        typeof a.lat === "number" &&
        typeof a.lng === "number" &&
        typeof a.x === "number" &&
        typeof a.y === "number"
    );
  } catch {
    return [];
  }
}

export function saveAnchors(anchors: GpsAnchor[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(anchors));
}

// ---------- helpers ----------

export function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/** Equirectangular projection: lat/lng → local metres around origin. */
function geoToLocalMeters(
  origin: { lat: number; lng: number },
  p: { lat: number; lng: number }
): { mx: number; my: number } {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(p.lat - origin.lat);
  const dLng = toRad(p.lng - origin.lng);
  const mx = dLng * EARTH_R * Math.cos(toRad(origin.lat)); // east+
  const my = dLat * EARTH_R; // north+
  return { mx, my };
}

function localMetersToGeo(
  origin: { lat: number; lng: number },
  mx: number,
  my: number
): { lat: number; lng: number } {
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat = origin.lat + toDeg(my / EARTH_R);
  const lng =
    origin.lng +
    toDeg(mx / (EARTH_R * Math.cos((origin.lat * Math.PI) / 180)));
  return { lat, lng };
}

// ---------- projection builders ----------

export function buildProjection(anchors: GpsAnchor[]): Projection | null {
  if (anchors.length === 0) return null;

  if (anchors.length === 1) {
    const a = anchors[0];
    const mpc = DEFAULT_METERS_PER_COORD;
    const toMap = (lat: number, lng: number) => {
      const { mx, my } = geoToLocalMeters(a, { lat, lng });
      // North up: north (+my) → -y on map (y grows downward)
      return { x: a.x + mx / mpc, y: a.y - my / mpc };
    };
    const toGeo = (x: number, y: number) => {
      const mx = (x - a.x) * mpc;
      const my = -(y - a.y) * mpc;
      return localMetersToGeo(a, mx, my);
    };
    return { toMap, toGeo, metersPerCoord: mpc, kind: "translate", anchorCount: 1 };
  }

  // 2+ anchors: similarity transform (rotation + uniform scale + translation)
  // from local-meter space (origin = anchor[0]) → map (x,y) in 0-100.
  const origin = { lat: anchors[0].lat, lng: anchors[0].lng };

  // Build matched point sets:  src (metres east/north)  →  dst (map x,y)
  const src: { x: number; y: number }[] = [];
  const dst: { x: number; y: number }[] = [];
  for (const a of anchors) {
    const { mx, my } = geoToLocalMeters(origin, a);
    src.push({ x: mx, y: my });
    dst.push({ x: a.x, y: a.y });
  }

  // Umeyama similarity (2D): find s, R, t s.t.  dst ≈ s * R * src + t
  const n = src.length;
  const srcMean = { x: 0, y: 0 };
  const dstMean = { x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    srcMean.x += src[i].x;
    srcMean.y += src[i].y;
    dstMean.x += dst[i].x;
    dstMean.y += dst[i].y;
  }
  srcMean.x /= n;
  srcMean.y /= n;
  dstMean.x /= n;
  dstMean.y /= n;

  let Sxx = 0,
    Sxy = 0,
    Syx = 0,
    Syy = 0,
    varSrc = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i].x - srcMean.x;
    const sy = src[i].y - srcMean.y;
    const dx = dst[i].x - dstMean.x;
    const dy = dst[i].y - dstMean.y;
    Sxx += dx * sx;
    Sxy += dx * sy;
    Syx += dy * sx;
    Syy += dy * sy;
    varSrc += sx * sx + sy * sy;
  }
  varSrc /= n;

  // 2x2 SVD on the covariance matrix [[Sxx,Sxy],[Syx,Syy]]
  // Closed form for 2D Umeyama:
  //   theta = atan2(Syx - Sxy, Sxx + Syy)
  //   s = (cos(theta)*(Sxx+Syy) + sin(theta)*(Syx-Sxy)) / (n * varSrc)
  const theta = Math.atan2(Syx - Sxy, Sxx + Syy);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const s =
    varSrc > 0
      ? (cos * (Sxx + Syy) + sin * (Syx - Sxy)) / (n * varSrc)
      : 1 / DEFAULT_METERS_PER_COORD;

  // Final transform: dst = s * R * src + t
  // t = dstMean - s*R*srcMean
  const tx = dstMean.x - s * (cos * srcMean.x - sin * srcMean.y);
  const ty = dstMean.y - s * (sin * srcMean.x + cos * srcMean.y);

  const toMap = (lat: number, lng: number) => {
    const { mx, my } = geoToLocalMeters(origin, { lat, lng });
    const x = s * (cos * mx - sin * my) + tx;
    const y = s * (sin * mx + cos * my) + ty;
    return { x, y };
  };

  // Inverse: src = R^T * (dst - t) / s
  const toGeo = (x: number, y: number) => {
    const u = (x - tx) / s;
    const v = (y - ty) / s;
    const mx = cos * u + sin * v;
    const my = -sin * u + cos * v;
    return localMetersToGeo(origin, mx, my);
  };

  // metersPerCoord = 1 / s  (s = coord-units per metre)
  const metersPerCoord = s > 0 ? 1 / s : DEFAULT_METERS_PER_COORD;

  return {
    toMap,
    toGeo,
    metersPerCoord,
    kind: "similarity",
    anchorCount: n,
  };
}

// ---------- path snapping ----------

export interface Polyline {
  points: { x: number; y: number }[];
}

/**
 * Snap a map point to the nearest point on any of the given polylines.
 * Returns the snapped coordinates and distance in coord units.
 */
export function snapToPaths(
  pt: { x: number; y: number },
  polylines: Polyline[]
): { x: number; y: number; distance: number } | null {
  let best: { x: number; y: number; distance: number } | null = null;
  for (const pl of polylines) {
    for (let i = 1; i < pl.points.length; i++) {
      const a = pl.points[i - 1];
      const b = pl.points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = 0;
      if (len2 > 0) {
        t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
      }
      const sx = a.x + dx * t;
      const sy = a.y + dy * t;
      const ex = pt.x - sx;
      const ey = pt.y - sy;
      const d = Math.sqrt(ex * ex + ey * ey);
      if (!best || d < best.distance) best = { x: sx, y: sy, distance: d };
    }
  }
  return best;
}

// ---------- polyline geometry (progress along a route) ----------

export interface PolyProjection {
  x: number;
  y: number;
  /** Perpendicular distance from the query point, in coord units. */
  distance: number;
  /** Index of the segment end vertex (1..points.length-1). */
  index: number;
  /** Interpolation factor within that segment (0..1). */
  t: number;
  /** Distance travelled along the polyline up to the projected point. */
  along: number;
}

export function polylineLength(points: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

/** Project a point onto a polyline, returning position + distance along it. */
export function projectOnPolyline(
  pt: { x: number; y: number },
  points: { x: number; y: number }[]
): PolyProjection | null {
  if (!points || points.length < 2) return null;
  let best: PolyProjection | null = null;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    let t = 0;
    if (len2 > 0) {
      t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const sx = a.x + dx * t;
    const sy = a.y + dy * t;
    const ex = pt.x - sx;
    const ey = pt.y - sy;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (!best || d < best.distance) {
      best = { x: sx, y: sy, distance: d, index: i, t, along: acc + len * t };
    }
    acc += len;
  }
  return best;
}

/** Split a polyline at a projection into [travelled, remaining] polylines. */
export function splitPolyline(
  points: { x: number; y: number }[],
  proj: PolyProjection
): { travelled: { x: number; y: number }[]; remaining: { x: number; y: number }[] } {
  const cut = { x: proj.x, y: proj.y };
  const travelled = [...points.slice(0, proj.index), cut];
  const remaining = [cut, ...points.slice(proj.index)];
  return { travelled, remaining };
}
