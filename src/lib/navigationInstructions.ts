import type { CampusLocation, CampusPath, Language } from "@/data/locations";
import { COORD_TO_METERS, euclidean, getLocationName } from "@/data/locations";

export type TurnType =
  | "start"
  | "straight"
  | "slight_left"
  | "slight_right"
  | "left"
  | "right"
  | "sharp_left"
  | "sharp_right"
  | "connector"
  | "arrive";

export interface TurnInstruction {
  id: string;
  type: TurnType;
  title: { en: string; kn: string };
  subtitle?: { en: string; kn: string };
  distanceMeters: number;
  floor: number;
  point: { x: number; y: number };
  targetLocationName?: { en: string; kn: string };
  destinationFloor?: number;
}

export function floorLabelName(n: number, lang: Language = "en"): string {
  const map: Record<number, { en: string; kn: string }> = {
    0: { en: "Ground floor", kn: "ನೆಲ ಮಹಡಿ" },
    1: { en: "1st floor", kn: "1ನೇ ಮಹಡಿ" },
    2: { en: "2nd floor", kn: "2ನೇ ಮಹಡಿ" },
    3: { en: "3rd floor", kn: "3ನೇ ಮಹಡಿ" },
  };
  const val = map[n] ?? { en: `Floor ${n}`, kn: `ಮಹಡಿ ${n}` };
  return val[lang] || val.en || `Floor ${n}`;
}

export function formatInstructionDistance(meters: number, lang: Language = "en"): string {
  if (!Number.isFinite(meters) || meters <= 0) {
    return lang === "kn" ? "1 ಮೀ" : "1 m";
  }
  if (meters >= 1000) {
    const km = (meters / 1000).toFixed(1);
    return lang === "kn" ? `${km} ಕಿ.ಮೀ` : `${km} km`;
  }
  const m = Math.max(1, Math.round(meters));
  return lang === "kn" ? `${m} ಮೀ` : `${m} m`;
}

/**
  Generate human-readable turn-by-turn indoor navigation instructions
  from a calculated route (sequence of nodes) and path edges.
 */
export function generateNavigationInstructions(
  route: CampusLocation[],
  paths: CampusPath[],
  metersPerCoord: number = COORD_TO_METERS,
  lang: Language = "en"
): TurnInstruction[] {
  if (!Array.isArray(route) || route.length === 0) return [];

  const startLoc = route[0];
  const destLoc = route[route.length - 1];

  if (!startLoc || !destLoc) return [];

  const safeStartName = {
    en: getLocationName(startLoc, "en"),
    kn: getLocationName(startLoc, "kn"),
  };
  const safeDestName = {
    en: getLocationName(destLoc, "en"),
    kn: getLocationName(destLoc, "kn"),
  };

  if (route.length === 1) {
    return [
      {
        id: "inst-0",
        type: "arrive",
        title: {
          en: `You have arrived at ${safeDestName.en}`,
          kn: `${safeDestName.kn} ತಲುಪಿದ್ದೀರಿ`,
        },
        subtitle: {
          en: floorLabelName(destLoc.floor ?? 0, "en"),
          kn: floorLabelName(destLoc.floor ?? 0, "kn"),
        },
        distanceMeters: 0,
        floor: destLoc.floor ?? 0,
        point: { x: destLoc.x ?? 50, y: destLoc.y ?? 50 },
        targetLocationName: safeDestName,
      },
    ];
  }

  const instructions: TurnInstruction[] = [];
  let stepCounter = 0;

  // Helper to check if a location is a connector/stair node
  const isConnectorNode = (loc?: CampusLocation) =>
    !loc ||
    !!loc.hidden ||
    loc.category === "connector" ||
    loc.category === "stair" ||
    loc.category === "stairs" ||
    loc.category === "lift" ||
    loc.category === "elevator";

  // 1. Start Instruction
  const startIsHidden = isConnectorNode(startLoc);
  instructions.push({
    id: `inst-${++stepCounter}-start`,
    type: "start",
    title: {
      en: startIsHidden ? "Start your route" : `Start at ${safeStartName.en}`,
      kn: startIsHidden ? "ನಿಮ್ಮ ಮಾರ್ಗವನ್ನು ಪ್ರಾರಂಭಿಸಿ" : `${safeStartName.kn} ಇಂದ ಪ್ರಾರಂಭಿಸಿ`,
    },
    distanceMeters: 0,
    floor: startLoc.floor ?? 0,
    point: { x: startLoc.x ?? 50, y: startLoc.y ?? 50 },
    targetLocationName: safeStartName,
  });

  // Build the geometric points along the route
  type RouteLeg =
    | { kind: "same_floor"; floor: number; points: { x: number; y: number }[] }
    | { kind: "connector"; fromLoc: CampusLocation; toLoc: CampusLocation };

  const legs: RouteLeg[] = [];

  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    if (!a || !b) continue;

    const aFloor = a.floor ?? 0;
    const bFloor = b.floor ?? 0;

    if (aFloor !== bFloor) {
      legs.push({ kind: "connector", fromLoc: a, toLoc: b });
    } else {
      // Find connecting path for intermediate waypoints
      const edge = Array.isArray(paths)
        ? paths.find(
            (p) =>
              p &&
              ((p.source_id === a.id && p.destination_id === b.id) ||
                (p.source_id === b.id && p.destination_id === a.id))
          )
        : undefined;

      let pts: { x: number; y: number }[] = [{ x: a.x ?? 50, y: a.y ?? 50 }];
      if (edge && Array.isArray(edge.points) && edge.points.length > 0) {
        const oriented =
          edge.source_id === a.id ? edge.points : [...edge.points].reverse();
        pts.push(...oriented.filter((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)));
      }
      pts.push({ x: b.x ?? 50, y: b.y ?? 50 });

      // Merge with previous leg if it was on the same floor
      const lastLeg = legs[legs.length - 1];
      if (lastLeg && lastLeg.kind === "same_floor" && lastLeg.floor === aFloor) {
        // append pts (skipping duplicate first point)
        for (let j = 1; j < pts.length; j++) {
          const prevPt = lastLeg.points[lastLeg.points.length - 1];
          const curPt = pts[j];
          if (prevPt && curPt && euclidean(prevPt, curPt) > 0.01) {
            lastLeg.points.push(curPt);
          }
        }
      } else {
        legs.push({ kind: "same_floor", floor: aFloor, points: pts });
      }
    }
  }

  // Helper to determine turn direction
  const analyzeTurn = (
    v1: { x: number; y: number },
    v2: { x: number; y: number }
  ): { type: TurnType; angle: number; isRight: boolean } => {
    const cross = v1.x * v2.y - v1.y * v2.x;
    const dot = v1.x * v2.x + v1.y * v2.y;
    const angle = (Math.atan2(cross, dot) * 180) / Math.PI;
    const absAngle = Math.abs(angle);
    const isRight = cross > 0;

    if (absAngle < 22) {
      return { type: "straight", angle, isRight };
    }
    if (absAngle < 60) {
      return { type: isRight ? "slight_right" : "slight_left", angle, isRight };
    }
    if (absAngle < 120) {
      return { type: isRight ? "right" : "left", angle, isRight };
    }
    return { type: isRight ? "sharp_right" : "sharp_left", angle, isRight };
  };

  // Process legs into instructions
  legs.forEach((leg, legIndex) => {
    if (leg.kind === "connector") {
      const { fromLoc, toLoc } = leg;
      const targetFloor = toLoc?.floor ?? 0;
      const fromNameStr = getLocationName(fromLoc, "en").toLowerCase();
      const isElevator =
        fromNameStr.includes("elevator") ||
        fromNameStr.includes("lift") ||
        fromLoc?.category === "lift" ||
        fromLoc?.category === "elevator";

      const floorEn = floorLabelName(targetFloor, "en");
      const floorKn = floorLabelName(targetFloor, "kn");

      const titleEn = isElevator
        ? `Take the elevator to ${floorEn}`
        : `Take the stairs to ${floorEn}`;
      const titleKn = isElevator
        ? `${floorKn}ಗೆ ಲಿಫ್ಟ್ ಬಳಸಿ ಹೋಗಿ`
        : `${floorKn}ಗೆ ಮೆಟ್ಟಿಲುಗಳನ್ನು ಬಳಸಿ ಹೋಗಿ`;

      instructions.push({
        id: `inst-${++stepCounter}-conn-${fromLoc.id}-${toLoc.id}`,
        type: "connector",
        title: { en: titleEn, kn: titleKn },
        distanceMeters: 0,
        floor: fromLoc.floor ?? 0,
        point: { x: fromLoc.x ?? 50, y: fromLoc.y ?? 50 },
        targetLocationName: {
          en: getLocationName(toLoc, "en"),
          kn: getLocationName(toLoc, "kn"),
        },
        destinationFloor: targetFloor,
      });
      return;
    }

    // Same floor leg
    const pts = leg.points;
    if (pts.length < 2) return;

    let accumMeters = 0;
    let legStartPt = pts[0];
    let prevVector: { x: number; y: number } | null = null;

    for (let j = 0; j < pts.length - 1; j++) {
      const p1 = pts[j];
      const p2 = pts[j + 1];
      if (!p1 || !p2) continue;

      const dx = (p2.x ?? 0) - (p1.x ?? 0);
      const dy = (p2.y ?? 0) - (p1.y ?? 0);
      const distCoord = Math.sqrt(dx * dx + dy * dy);
      if (distCoord < 0.001) continue;

      const distM = distCoord * metersPerCoord;
      const curVector = { x: dx, y: dy };

      if (!prevVector) {
        // Initial direction vector on this floor segment
        prevVector = curVector;
        accumMeters += distM;
        continue;
      }

      const turn = analyzeTurn(prevVector, curVector);

      if (turn.type === "straight") {
        accumMeters += distM;
        prevVector = curVector;
      } else {
        // Significant turn detected at point p1!
        // 1. Emit preceding walk instruction if distance >= 2m
        if (accumMeters >= 2) {
          instructions.push({
            id: `inst-${++stepCounter}-walk-leg${legIndex}-pt${j}`,
            type: "straight",
            title: {
              en: `Walk straight for ${formatInstructionDistance(accumMeters, "en")}`,
              kn: `${formatInstructionDistance(accumMeters, "kn")} ನೇರವಾಗಿ ನಡೆಯಿರಿ`,
            },
            subtitle: {
              en: `Continue for ${formatInstructionDistance(accumMeters, "en")}`,
              kn: `${formatInstructionDistance(accumMeters, "kn")} ಮುಂದುವರಿಯಿರಿ`,
            },
            distanceMeters: accumMeters,
            floor: leg.floor,
            point: legStartPt,
          });
        }

        // 2. Emit turn instruction at p1
        let turnTitleEn = "Turn right";
        let turnTitleKn = "ಬಲಕ್ಕೆ ತಿರುಗಿ";

        switch (turn.type) {
          case "left":
            turnTitleEn = "Turn left";
            turnTitleKn = "ಎಡಕ್ಕೆ ತಿರುಗಿ";
            break;
          case "right":
            turnTitleEn = "Turn right";
            turnTitleKn = "ಬಲಕ್ಕೆ ತಿರುಗಿ";
            break;
          case "slight_left":
            turnTitleEn = "Turn slight left";
            turnTitleKn = "ಸ್ವಲ್ಪ ಎಡಕ್ಕೆ ತಿರುಗಿ";
            break;
          case "slight_right":
            turnTitleEn = "Turn slight right";
            turnTitleKn = "ಸ್ವಲ್ಪ ಬಲಕ್ಕೆ ತಿರುಗಿ";
            break;
          case "sharp_left":
            turnTitleEn = "Sharp left turn";
            turnTitleKn = "ತೀವ್ರ ಎಡಕ್ಕೆ ತಿರುಗಿ";
            break;
          case "sharp_right":
            turnTitleEn = "Sharp right turn";
            turnTitleKn = "ತೀವ್ರ ಬಲಕ್ಕೆ ತಿರುಗಿ";
            break;
        }

        instructions.push({
          id: `inst-${++stepCounter}-turn-leg${legIndex}-pt${j}`,
          type: turn.type,
          title: { en: turnTitleEn, kn: turnTitleKn },
          distanceMeters: 0,
          floor: leg.floor,
          point: { x: p1.x ?? 50, y: p1.y ?? 50 },
        });

        // Reset tracking for the segment following the turn
        accumMeters = distM;
        legStartPt = { x: p1.x ?? 50, y: p1.y ?? 50 };
        prevVector = curVector;
      }
    }

    // Flush remaining accumulated distance at end of floor leg
    if (accumMeters >= 2) {
      instructions.push({
        id: `inst-${++stepCounter}-walk-end-leg${legIndex}`,
        type: "straight",
        title: {
          en: `Walk straight for ${formatInstructionDistance(accumMeters, "en")}`,
          kn: `${formatInstructionDistance(accumMeters, "kn")} ನೇರವಾಗಿ ನಡೆಯಿರಿ`,
        },
        subtitle: {
          en: `Continue for ${formatInstructionDistance(accumMeters, "en")}`,
          kn: `${formatInstructionDistance(accumMeters, "kn")} ಮುಂದುವರಿಯಿರಿ`,
        },
        distanceMeters: accumMeters,
        floor: leg.floor,
        point: legStartPt,
      });
    }
  });

  // 3. Final Arrival Instruction
  const destIsHidden = isConnectorNode(destLoc);
  const destNameEn = destIsHidden ? "your destination" : safeDestName.en;
  const destNameKn = destIsHidden ? "ನಿಮ್ಮ ತಲುಪುವ ಸ್ಥಳ" : safeDestName.kn;
  const destFloorEn = floorLabelName(destLoc.floor ?? 0, "en");
  const destFloorKn = floorLabelName(destLoc.floor ?? 0, "kn");

  instructions.push({
    id: `inst-${++stepCounter}-arrive`,
    type: "arrive",
    title: {
      en: `You have arrived at ${destNameEn}`,
      kn: `${destNameKn} ತಲುಪಿದ್ದೀರಿ`,
    },
    subtitle: {
      en: `${destNameEn} — ${destFloorEn}`,
      kn: `${destNameKn} — ${destFloorKn}`,
    },
    distanceMeters: 0,
    floor: destLoc.floor ?? 0,
    point: { x: destLoc.x ?? 50, y: destLoc.y ?? 50 },
    targetLocationName: safeDestName,
    destinationFloor: destLoc.floor ?? 0,
  });

  return instructions;
}
