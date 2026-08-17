export type Language = "en" | "kn";

export interface CampusLocation {
  id: string;
  slug: string;
  name: { en: string; kn: string };
  category: string;
  floor: number;
  icon: string;
  description?: string;
  /** When true the marker is not rendered on maps, but stays fully routable. */
  hidden?: boolean;
  // 0..100 coords on the SVG canvas
  x: number;
  y: number;
}

export type PathType = "walk" | "connector";

export interface PathPoint {
  x: number;
  y: number;
}

export interface CampusPath {
  id: string;
  source_id: string;
  destination_id: string;
  distance: number;
  /** Floor this edge lives on. Connectors use the source floor here. */
  floor: number;
  /** "walk" = same-floor edge, "connector" = stairs/lift between floors. */
  type: PathType;
  /** Only set on connectors — the floor reached by traversing this edge. */
  to_floor: number | null;
  /** Optional intermediate waypoints between source and destination (0-100 coords). */
  points: PathPoint[];
}

export interface LocationStep {
  en: string;
  kn: string;
  /** Map floor that should be displayed when this step is active. */
  floor: number;
  /** "start" | "walk" | "connector" | "arrive" */
  kind?: "start" | "walk" | "connector" | "arrive";
}

// Map coords are 0-100 on the SVG canvas (image pixels, not metres).
// Calibrated so a full-canvas traversal ≈ 150 m of campus walking.
export const COORD_TO_METERS = 1.5;
// Average walking speed 1.3 m/s ≈ 78 m / min
export const WALKING_M_PER_MIN = 78;

export function euclidean(a: { x: number; y: number }, b: { x: number; y: number }) {
  if (!a || !b) return 0;
  const ax = Number.isFinite(a.x) ? a.x : 0;
  const ay = Number.isFinite(a.y) ? a.y : 0;
  const bx = Number.isFinite(b.x) ? b.x : 0;
  const by = Number.isFinite(b.y) ? b.y : 0;
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

export function metersBetween(a: CampusLocation, b: CampusLocation) {
  return euclidean(a, b) * COORD_TO_METERS;
}

export function walkingMinutes(distanceMeters: number) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 1;
  return Math.max(1, Math.round(distanceMeters / WALKING_M_PER_MIN));
}

export function getLocationName(loc?: Partial<CampusLocation> | null, lang: Language = "en"): string {
  if (!loc) return lang === "kn" ? "ಸ್ಥಳ" : "Location";
  if (loc.name) {
    if (lang === "kn") {
      return loc.name.kn || loc.name.en || loc.slug || "ಸ್ಥಳ";
    }
    return loc.name.en || loc.name.kn || loc.slug || "Location";
  }
  return loc.slug || (lang === "kn" ? "ಸ್ಥಳ" : "Location");
}

function floorName(n: number): { en: string; kn: string } {
  const map: Record<number, { en: string; kn: string }> = {
    0: { en: "Ground floor", kn: "ನೆಲ ಮಹಡಿ" },
    1: { en: "1st floor", kn: "1ನೇ ಮಹಡಿ" },
    2: { en: "2nd floor", kn: "2ನೇ ಮಹಡಿ" },
    3: { en: "3rd floor", kn: "3ನೇ ಮಹಡಿ" },
  };
  return map[n] ?? { en: `Floor ${n}`, kn: `ಮಹಡಿ ${n}` };
}

function turnDirection(
  prev: CampusLocation,
  pivot: CampusLocation,
  next: CampusLocation
): "left" | "right" | "straight" {
  if (!prev || !pivot || !next) return "straight";
  const v1x = (pivot.x ?? 0) - (prev.x ?? 0);
  const v1y = (pivot.y ?? 0) - (prev.y ?? 0);
  const v2x = (next.x ?? 0) - (pivot.x ?? 0);
  const v2y = (next.y ?? 0) - (pivot.y ?? 0);
  if ((v1x === 0 && v1y === 0) || (v2x === 0 && v2y === 0)) return "straight";
  const cross = v1x * v2y - v1y * v2x;
  const dot = v1x * v2x + v1y * v2y;
  const angle = (Math.atan2(cross, dot) * 180) / Math.PI;
  if (Math.abs(angle) < 25) return "straight";
  // SVG/map y grows downward → positive cross = clockwise = right turn.
  return angle > 0 ? "right" : "left";
}

function turnPrefix(t: "left" | "right" | "straight", lang: "en" | "kn"): string {
  if (lang === "en") {
    if (t === "left") return "Turn left and ";
    if (t === "right") return "Turn right and ";
    return "Walk straight and ";
  }
  if (t === "left") return "ಎಡಕ್ಕೆ ತಿರುಗಿ ";
  if (t === "right") return "ಬಲಕ್ಕೆ ತಿರುಗಿ ";
  return "ನೇರವಾಗಿ ನಡೆಯಿರಿ ";
}

/**
 * Generate concise, node-aware directions:
 *   Start → (walk to) Staircase → Floor change → ... → Destination
 */
export function describeRoute(waypoints: CampusLocation[]): LocationStep[] {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return [];

  // 1. Pick out "key" indices: start, destination, and both endpoints of any
  //    floor-change edge (the stair/lift pivot on each floor).
  const n = waypoints.length;
  const keySet = new Set<number>([0, n - 1]);
  for (let i = 0; i < n - 1; i++) {
    const a = waypoints[i]?.floor ?? 0;
    const b = waypoints[i + 1]?.floor ?? 0;
    if (a !== b) {
      keySet.add(i);
      keySet.add(i + 1);
    }
  }
  const keys = [...keySet].sort((a, b) => a - b);

  const isLocationHidden = (loc?: CampusLocation) =>
    !loc ||
    !!loc.hidden ||
    loc.category === "connector" ||
    loc.category === "stair" ||
    loc.category === "stairs";

  const steps: LocationStep[] = [];
  const start = waypoints[0];
  const startHidden = isLocationHidden(start);
  const startEn = getLocationName(start, "en");
  const startKn = getLocationName(start, "kn");

  steps.push({
    en: startHidden ? "Start your route." : `Start at ${startEn}.`,
    kn: startHidden ? "ನಿಮ್ಮ ಮಾರ್ಗವನ್ನು ಪ್ರಾರಂಭಿಸಿ." : `${startKn} ಇಂದ ಪ್ರಾರಂಭಿಸಿ.`,
    floor: start?.floor ?? 0,
    kind: "start",
  });

  for (let k = 0; k < keys.length - 1; k++) {
    const aIdx = keys[k];
    const bIdx = keys[k + 1];
    const a = waypoints[aIdx];
    const b = waypoints[bIdx];
    if (!a || !b) continue;

    const aFloor = a.floor ?? 0;
    const bFloor = b.floor ?? 0;
    const last = bIdx === n - 1;

    const isAHidden = isLocationHidden(a);
    const isBHidden = isLocationHidden(b);
    const aEn = getLocationName(a, "en");
    const aKn = getLocationName(a, "kn");
    const bEn = getLocationName(b, "en");
    const bKn = getLocationName(b, "kn");

    if (aFloor !== bFloor) {
      // Floor transition via stair/lift.
      const target = floorName(bFloor);
      const enText = isAHidden
        ? `Go to ${target.en} using stairs or elevator.`
        : `Go to ${target.en} via ${aEn}.`;
      const knText = isAHidden
        ? `${target.kn} ಗೆ ಮೆಟ್ಟಿಲುಗಳು ಅಥವಾ ಲಿಫ್ಟ್ ಬಳಸಿ ಹೋಗಿ.`
        : `${aKn} ಮೂಲಕ ${target.kn} ಗೆ ಹೋಗಿ.`;

      steps.push({
        en: enText,
        kn: knText,
        floor: bFloor,
        kind: "connector",
      });
      continue;
    }

    // Same floor — collapse all hops between aIdx and bIdx into one walk.
    let coordDist = 0;
    for (let i = aIdx; i < bIdx; i++) {
      if (waypoints[i] && waypoints[i + 1]) {
        coordDist += euclidean(waypoints[i], waypoints[i + 1]);
      }
    }
    const meters = Math.max(1, Math.round(coordDist * COORD_TO_METERS));

    // Turn cue at the pivot a (if there's a prior same-floor leg).
    let turnEn = "";
    let turnKn = "";
    if (aIdx >= 1 && (waypoints[aIdx - 1]?.floor ?? 0) === aFloor && waypoints[aIdx + 1]) {
      const t = turnDirection(waypoints[aIdx - 1], a, waypoints[aIdx + 1]);
      turnEn = turnPrefix(t, "en");
      turnKn = turnPrefix(t, "kn");
    }

    if (last) {
      const destNameEn = isBHidden ? "your destination" : bEn;
      const destNameKn = isBHidden ? "ನಿಮ್ಮ ತಲುಪುವ ಸ್ಥಳ" : bKn;

      steps.push({
        en: `${turnEn}walk to ${destNameEn} (about ${meters} m).`.replace(/^./, (c) => c.toUpperCase()),
        kn: `${turnKn}${destNameKn} ಗೆ ನಡೆಯಿರಿ (ಸುಮಾರು ${meters} ಮೀ).`,
        floor: bFloor,
        kind: "arrive",
      });
    } else {
      // b is a staircase/lift pivot — phrase it generically if b is hidden.
      const walkTargetEn = isBHidden ? "the stairs/elevator" : bEn;
      const walkTargetKn = isBHidden ? "ಮೆಟ್ಟಿಲುಗಳು/ಲಿಫ್ಟ್‌" : bKn;

      steps.push({
        en: `${turnEn}walk to ${walkTargetEn} (${meters} m).`.replace(/^./, (c) => c.toUpperCase()),
        kn: `${turnKn}${walkTargetKn} ಗೆ ನಡೆಯಿರಿ (${meters} ಮೀ).`,
        floor: bFloor,
        kind: "walk",
      });
    }
  }

  return steps;
}



