import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeftRight,
  Compass,
  MapPin,
  Navigation,
  Pause,
  Play,
  QrCode,
  Satellite,
  WifiOff,
} from "lucide-react";
import { useAppConfig } from "@/hooks/useAppConfig";
import { AppHeader } from "@/components/AppHeader";
import { CampusMap } from "@/components/CampusMap";
import { CalibrationDialog } from "@/components/CalibrationDialog";
import { DestinationSearch } from "@/components/DestinationSearch";
import { FromToNavigation } from "@/components/FromToNavigation";
import { QuickAccess } from "@/components/QuickAccess";
import { Directions } from "@/components/Directions";
import { TurnByTurnCard } from "@/components/TurnByTurnCard";
import { LocationDetailModal } from "@/components/LocationDetailModal";
import { OutdoorGoogleMap } from "@/components/OutdoorGoogleMap";
import { NavigationModeBar, type NavMode } from "@/components/NavigationModeBar";
import { QRScanner } from "@/components/QRScanner";
import { playArrivalSound } from "@/lib/sound";

import { FloorSelector, floorLabel } from "@/components/FloorSelector";
import { cacheMapAsset } from "@/lib/offlineCache";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useAuth } from "@/hooks/useAuth";
import { useCampusData } from "@/hooks/useCampusData";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useLiveTracking } from "@/hooks/useLiveTracking";
import {
  buildProjection,
  haversine,
  type GpsAnchor,
} from "@/lib/geo";
import { useGpsAnchors } from "@/hooks/useGpsAnchors";

import { tr } from "@/lib/i18n";
import {
  COORD_TO_METERS,
  describeRoute,
  euclidean,
  walkingMinutes,
  getLocationName,
  type CampusLocation,
} from "@/data/locations";
import {
  generateNavigationInstructions,
  floorLabelName,
} from "@/lib/navigationInstructions";
import { shortestPath } from "@/lib/dijkstra";
import { toast } from "sonner";

const Index = () => {
  const { lang } = useAppSettings();
  const { isAdmin } = useAuth();
  const { locations, paths, loading, fromCache, isPaused, pauseMessage: dataPauseMessage } = useCampusData();
  const {
    quickAccess,
    mapSrcForFloor,
    mappedFloors,
    databasePaused,
    pauseMessage: configPauseMessage,
    setDatabasePaused,
  } = useAppConfig();
  const isCurrentlyPaused = databasePaused;
  const activePauseMessage = configPauseMessage || dataPauseMessage || "Campus Navigation is temporarily unavailable.";
  const [params] = useSearchParams();
  
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  const [destId, setDestId] = useState<string | undefined>();
  const [fromId, setFromId] = useState<string | undefined>();
  const [isLiveStart, setIsLiveStart] = useState<boolean>(true);
  const [fullScreen, setFullScreen] = useState(false);
  const [showPath, setShowPath] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [floor, setFloor] = useState<number>(0);
  const [floorTouched, setFloorTouched] = useState(false);

  useEffect(() => {
    if (isCurrentlyPaused) {
      setDestId(undefined);
      setFromId(undefined);
      setScannedLocationId(null);
      setModalLocation(null);
      setModalOpen(false);
    }
  }, [isCurrentlyPaused]);
  /** Map image for the currently displayed floor (falls back to the default map). */
  const floorMap = mapSrcForFloor(floor);

  const mapSectionRef = useRef<HTMLElement | null>(null);
  const [modalLocation, setModalLocation] = useState<CampusLocation | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [scannedLocationId, setScannedLocationId] = useState<string | null>(null);

  const [activeStep, setActiveStep] = useState(0);
  const [navigating, setNavigating] = useState(false);
  const [livePos, setLivePos] = useState<{ x: number; y: number; floor: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  // --- Real-world GPS ----------------------------------------------------
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const { anchors, setAnchors, loaded: anchorsLoaded } = useGpsAnchors();
  const { position: livePosition, status: gpsStatus, error: gpsError } = useGeolocation(gpsEnabled);

  const projection = useMemo(() => {
    if (anchors.length === 0) return null;
    return buildProjection(anchors);
  }, [anchors]);

  // Distance (m) from live GPS to nearest calibration anchor. If the user is
  // far from campus, we suppress the live puck entirely.
  const distanceToCampusM = useMemo(() => {
    if (!livePosition || anchors.length === 0) return null;
    let best = Infinity;
    for (const a of anchors) {
      const d = haversine(
        { lat: livePosition.lat, lng: livePosition.lng },
        { lat: a.lat, lng: a.lng }
      );
      if (d < best) best = d;
    }
    return best;
  }, [livePosition, anchors]);
  const OFF_CAMPUS_RADIUS_M = 500;
  const offCampus =
    distanceToCampusM != null && distanceToCampusM > OFF_CAMPUS_RADIUS_M;

  const [navMode, setNavMode] = useState<NavMode>("campus");
  const [userOverrodeNavMode, setUserOverrodeNavMode] = useState(false);
  const [outdoorRoadDistance, setOutdoorRoadDistance] = useState<number | null>(null);

  // Auto-switch navigation mode based on offCampus state unless manually toggled
  useEffect(() => {
    if (userOverrodeNavMode) return;
    if (offCampus) {
      setNavMode("outdoor");
    } else {
      setNavMode("campus");
    }
  }, [offCampus, userOverrodeNavMode]);

  // GPS → map coordinates (via calibration). Disabled when off-campus so the
  // blue marker doesn't drift across unrelated geography.
  const liveGpsMap = useMemo(() => {
    if (!projection || !livePosition || offCampus) return null;
    const p = projection.toMap(livePosition.lat, livePosition.lng);
    return { x: p.x, y: p.y };
  }, [projection, livePosition, offCampus]);

  // Effective meters-per-coord — use calibrated scale when available.
  const metersPerCoord = projection?.metersPerCoord ?? COORD_TO_METERS;

  // Pre-cache the map asset for offline use
  useEffect(() => {
    void cacheMapAsset(floorMap);
  }, [floorMap]);

  // Track online/offline state
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Resolve "from", "to", and "scan" trigger from URL params
  useEffect(() => {
    if (locations.length === 0) return;

    if (params.get("scan") === "1" || params.get("scan") === "true" || params.get("qr") === "1") {
      setQrScannerOpen(true);
    }

    const startSlug = params.get("location") || params.get("start") || params.get("from");
    const destSlug = params.get("destination") || params.get("dest") || params.get("to");

    if (destSlug) {
      const matchedDest = locations.find((l) => l.slug === destSlug || l.id === destSlug);
      if (matchedDest) {
        setDestId(matchedDest.id);
      }
    }

    const matched = startSlug
      ? locations.find((l) => l.slug === startSlug || l.id === startSlug)
      : null;
    if (matched) {
      setFromId(matched.id);
      setIsLiveStart(false);
      setScannedLocationId(matched.id);
    } else if (!fromId) {
      const entrance = locations.find((l) => l.category === "entrance") ?? locations[0];
      setFromId(entrance.id);
    }
  }, [locations, params, fromId]);

  const from = useMemo(
    () => locations.find((l) => l.id === fromId),
    [locations, fromId]
  );
  const to = useMemo(
    () => locations.find((l) => l.id === destId),
    [locations, destId]
  );
  const scanned = (!!params.get("location") || !!scannedLocationId) && !!from;

  const result = useMemo(() => {
    if (!from || !to) return null;
    return shortestPath(locations, paths, from.id, to.id);
  }, [locations, paths, from, to]);

  const route = result?.route ?? [];
  const distanceMeters = result ? result.distance * metersPerCoord : 0;
  const steps = useMemo(() => describeRoute(route), [route]);
  const turnInstructions = useMemo(
    () => generateNavigationInstructions(route, paths, metersPerCoord, lang),
    [route, paths, metersPerCoord, lang]
  );
  const walkingMin = walkingMinutes(distanceMeters);

  // ---- Anchor-based current location ------------------------------------
  /** Ground-floor location a GPS anchor represents (nearest floor-0 marker). */
  const anchorLocation = useCallback(
    (a: GpsAnchor): CampusLocation | null => {
      let best: { loc: CampusLocation; d: number } | null = null;
      for (const l of locations) {
        if ((l.floor ?? 0) !== 0) continue;
        const d = euclidean({ x: l.x, y: l.y }, { x: a.x, y: a.y });
        if (!best || d < best.d) best = { loc: l, d };
      }
      return best ? best.loc : null;
    },
    [locations]
  );

  const mainGate = useMemo(
    () =>
      locations.find(
        (l) =>
          l.slug.toLowerCase().includes("main") ||
          getLocationName(l, "en").toLowerCase().includes("main gate")
      ) ?? locations.find((l) => l.category === "entrance") ?? null,
    [locations]
  );

  /** Nearest GPS anchor to the live position (within campus radius). */
  const ANCHOR_MAX_M = 200;
  const nearestAnchor = useMemo(() => {
    if (!livePosition || offCampus || anchors.length === 0) return null;
    let best: { anchor: GpsAnchor; d: number } | null = null;
    for (const a of anchors) {
      const d = haversine({ lat: livePosition.lat, lng: livePosition.lng }, a);
      if (!best || d < best.d) best = { anchor: a, d };
    }
    if (!best || best.d > ANCHOR_MAX_M) return null;
    return best;
  }, [livePosition, anchors, offCampus]);

  /** Location the nearest anchor resolves to, or Main Gate as fallback. */
  const gpsCurrentLocation = useMemo(() => {
    if (!gpsEnabled || locations.length === 0) return null;
    if (nearestAnchor) return anchorLocation(nearestAnchor.anchor) ?? mainGate;
    return mainGate;
  }, [gpsEnabled, nearestAnchor, anchorLocation, mainGate, locations.length]);

  // Continuously follow the nearest anchor while Live GPS is on. A QR-scanned
  // start always wins. Route recalculation happens automatically downstream.
  useEffect(() => {
    if (!gpsEnabled) return;
    if (!isLiveStart) return;
    if (params.get("location")) return; // QR-scanned start wins
    if (!gpsCurrentLocation) return;
    if (gpsCurrentLocation.id !== fromId) setFromId(gpsCurrentLocation.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsEnabled, isLiveStart, gpsCurrentLocation, params]);


  // Floor handling --------------------------------------------------------
  const floors = useMemo(() => {
    const set = new Set<number>(locations.map((l) => l.floor ?? 0));
    // Include floors that have a dedicated map, even if empty of locations.
    mappedFloors.forEach((f) => set.add(f));
    return Array.from(set).sort((a, b) => a - b);
  }, [locations, mappedFloors]);


  const floorOptions = useMemo(
    () =>
      floors.map((f) => ({
        value: f,
        label: floorLabel(f),
        count: locations.filter((l) => (l.floor ?? 0) === f).length,
      })),
    [floors, locations]
  );

  // Auto-follow the active starting point's floor unless the user picked one.
  useEffect(() => {
    if (floorTouched) return;
    if (from) setFloor(from.floor ?? 0);
    else if (floors.length) setFloor(floors[0]);
  }, [from, floors, floorTouched]);

  // Track user-triggered activeStep changes when stepping through TurnByTurnCard or Directions.
  const prevActiveStepRef = useRef(activeStep);
  useEffect(() => {
    if (prevActiveStepRef.current !== activeStep) {
      prevActiveStepRef.current = activeStep;
      const s = steps[activeStep];
      if (s && typeof s.floor === "number" && s.floor !== floor) {
        setFloor(s.floor);
        setFloorTouched(true);
      }
    }
  }, [activeStep, steps, floor]);

  // Locations visible on the current floor (markers + map).
  // Hidden markers stay in the graph for routing but are never rendered.
  const visibleLocations = useMemo(
    () => locations.filter((l) => (l.floor ?? 0) === floor && !l.hidden),
    [locations, floor]
  );

  // Lookup a path between two location ids (any direction).
  const findPath = (aId: string, bId: string) =>
    paths.find(
      (p) =>
        (p.source_id === aId && p.destination_id === bId) ||
        (p.source_id === bId && p.destination_id === aId)
    );

  // Walkable paths underlay for the visible floor (thin grey polylines, walks only).
  const walkablePaths = useMemo(() => {
    const byId = new Map(locations.map((l) => [l.id, l]));
    const out: { points: { x: number; y: number }[] }[] = [];
    for (const p of paths) {
      if (p.type === "connector") continue;
      if (p.floor !== floor) continue;
      const a = byId.get(p.source_id);
      const b = byId.get(p.destination_id);
      if (!a || !b) continue;
      const pts = [{ x: a.x, y: a.y }, ...(p.points ?? []), { x: b.x, y: b.y }];
      out.push({ points: pts });
    }
    return out;
  }, [paths, locations, floor]);

  // Split the active route into per-floor polyline segments. Cross-floor jumps
  // become dotted connectors. Each walking edge expands into the path's stored
  // waypoints so manually-drawn turns are honoured.
  const { routePolylines, crossFloorConnectors, floorGroups } = useMemo(() => {
    type Poly = { floor: number; points: { x: number; y: number }[] };
    const polys: Poly[] = [];
    const conns: { x1: number; y1: number; x2: number; y2: number; label: string; fromFloor: number; toFloor: number }[] = [];
    if (route.length < 2)
      return { routePolylines: polys, crossFloorConnectors: conns, floorGroups: [] as { floor: number; pts: CampusLocation[] }[] };

    const groups: { floor: number; pts: CampusLocation[] }[] = [];
    let curGroup: CampusLocation[] = [route[0]];
    let curPoly: Poly = { floor: route[0].floor ?? 0, points: [{ x: route[0].x, y: route[0].y }] };

    const flushPoly = () => {
      if (curPoly.points.length >= 2) polys.push(curPoly);
    };

    for (let i = 1; i < route.length; i++) {
      const prev = route[i - 1];
      const node = route[i];
      const sameFloor = (node.floor ?? 0) === (prev.floor ?? 0);
      if (!sameFloor) {
        flushPoly();
        groups.push({ floor: prev.floor ?? 0, pts: curGroup });
        conns.push({
          x1: prev.x,
          y1: prev.y,
          x2: node.x,
          y2: node.y,
          label: `${getLocationName(prev, "en")} (F${prev.floor ?? 0}) → ${getLocationName(node, "en")} (F${node.floor ?? 0})`,
          fromFloor: prev.floor ?? 0,
          toFloor: node.floor ?? 0,
        });
        curGroup = [node];
        curPoly = { floor: node.floor ?? 0, points: [{ x: node.x, y: node.y }] };
      } else {
        // Same-floor edge: append intermediate path points (oriented prev→node) then the node.
        const edge = findPath(prev.id, node.id);
        if (edge && edge.points && edge.points.length > 0) {
          const oriented =
            edge.source_id === prev.id ? edge.points : [...edge.points].reverse();
          for (const pt of oriented) curPoly.points.push({ x: pt.x, y: pt.y });
        }
        curPoly.points.push({ x: node.x, y: node.y });
        curGroup.push(node);
      }
    }
    flushPoly();
    if (curGroup.length) groups.push({ floor: curGroup[curGroup.length - 1].floor ?? 0, pts: curGroup });
    return { routePolylines: polys, crossFloorConnectors: conns, floorGroups: groups };
  }, [route, paths]);

  // Filter what's drawn on the *current* floor.
  const visibleRoutePolylines = useMemo(
    () => routePolylines.filter((s) => s.floor === floor).map((s) => s.points),
    [routePolylines, floor]
  );
  const visibleConnectors = useMemo(
    () => crossFloorConnectors.filter((c) => c.fromFloor === floor || c.toFloor === floor),
    [crossFloorConnectors, floor]
  );

  const isMultiFloorRoute = floorGroups.length > 1;
  // For markers (from/to highlight) on this floor only.
  const visibleEndpointRoute: CampusLocation[] = useMemo(() => {
    if (!route.length) return [];
    const onFloor = route.filter((r) => (r.floor ?? 0) === floor);
    if (onFloor.length) return onFloor;
    // Fallback so markers still appear when the user is on an empty floor
    return [];
  }, [route, floor]);
  const crossFloorRoute = !!from && !!to && isMultiFloorRoute && visibleRoutePolylines.length === 0;

  const handleFloorChange = (f: number) => {
    setFloor(f);
    setFloorTouched(true);
  };

  // ----- Navigation progress engine -------------------------------------
  type NavSeg =
    | { kind: "walk"; floor: number; stepIndex: number; pts: { x: number; y: number }[]; length: number }
    | { kind: "connector"; floor: number; stepIndex: number; at: { x: number; y: number }; durationMs: number };

  const navSegments = useMemo<NavSeg[]>(() => {
    if (route.length < 2) return [];
    const segs: NavSeg[] = [];
    for (let i = 1; i < route.length; i++) {
      const prev = route[i - 1];
      const node = route[i];
      const sameFloor = (node.floor ?? 0) === (prev.floor ?? 0);
      if (!sameFloor) {
        segs.push({
          kind: "connector",
          floor: node.floor ?? 0,
          stepIndex: i,
          at: { x: node.x, y: node.y },
          durationMs: 2500,
        });
        continue;
      }
      const edge = findPath(prev.id, node.id);
      const inner =
        edge && edge.points && edge.points.length > 0
          ? edge.source_id === prev.id
            ? edge.points
            : [...edge.points].reverse()
          : [];
      const pts = [{ x: prev.x, y: prev.y }, ...inner.map((p) => ({ x: p.x, y: p.y })), { x: node.x, y: node.y }];
      let length = 0;
      for (let j = 1; j < pts.length; j++) {
        const dx = pts[j].x - pts[j - 1].x;
        const dy = pts[j].y - pts[j - 1].y;
        length += Math.sqrt(dx * dx + dy * dy);
      }
      segs.push({ kind: "walk", floor: node.floor ?? 0, stepIndex: i, pts, length: Math.max(length, 0.001) });
    }
    return segs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, paths]);

  const stopNavigation = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setNavigating(false);
    setLivePos(null);
  };

  const startNavigation = () => {
    if (navSegments.length === 0) return;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);

    // ~2.2 m/s natural human walking speed → coord units/ms
    const UNITS_PER_MS = 2.2 / COORD_TO_METERS / 1000;
    let segIdx = 0;
    let distInSeg = 0;
    let connectorStartedAt: number | null = null;
    let last = performance.now();

    setNavigating(true);
    setActiveStep(navSegments[0].stepIndex);
    setFloor(navSegments[0].floor);
    setFloorTouched(true);
    if (navSegments[0].kind === "walk") {
      setLivePos({ ...navSegments[0].pts[0], floor: navSegments[0].floor });
    } else {
      setLivePos({ ...navSegments[0].at, floor: navSegments[0].floor });
    }

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const seg = navSegments[segIdx];
      if (!seg) {
        rafRef.current = null;
        setNavigating(false);
        return;
      }

      if (seg.kind === "connector") {
        if (connectorStartedAt == null) connectorStartedAt = now;
        if (now - connectorStartedAt >= seg.durationMs) {
          connectorStartedAt = null;
          segIdx++;
          distInSeg = 0;
          if (segIdx < navSegments.length) {
            const next = navSegments[segIdx];
            setActiveStep(next.stepIndex);
            setFloor(next.floor);
            setFloorTouched(true);
            if (next.kind === "walk") setLivePos({ ...next.pts[0], floor: next.floor });
            else setLivePos({ ...next.at, floor: next.floor });
          }
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // walk segment — advance distance, interpolate along polyline
      distInSeg += dt * UNITS_PER_MS;
      if (distInSeg >= seg.length) {
        segIdx++;
        distInSeg = 0;
        if (segIdx < navSegments.length) {
          const next = navSegments[segIdx];
          setActiveStep(next.stepIndex);
          setFloor(next.floor);
          setFloorTouched(true);
          if (next.kind === "walk") setLivePos({ ...next.pts[0], floor: next.floor });
          else setLivePos({ ...next.at, floor: next.floor });
        } else {
          // Arrived
          const lastSeg = navSegments[navSegments.length - 1];
          if (lastSeg.kind === "walk") {
            const end = lastSeg.pts[lastSeg.pts.length - 1];
            setLivePos({ ...end, floor: lastSeg.floor });
          }
          playArrivalSound();
          toast.success("You have arrived at your destination!");
          rafRef.current = null;
          setNavigating(false);
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // walk along pts
      let remaining = distInSeg;
      let x = seg.pts[0].x;
      let y = seg.pts[0].y;
      for (let j = 1; j < seg.pts.length; j++) {
        const a = seg.pts[j - 1];
        const b = seg.pts[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segLen = Math.sqrt(dx * dx + dy * dy);
        if (remaining <= segLen) {
          const t = segLen === 0 ? 0 : remaining / segLen;
          x = a.x + dx * t;
          y = a.y + dy * t;
          break;
        }
        remaining -= segLen;
        x = b.x;
        y = b.y;
      }
      setLivePos({ x, y, floor: seg.floor });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  // Stop animation when route changes or component unmounts
  useEffect(() => {
    stopNavigation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromId, destId]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);



  // Snap GPS to nearest walkable path on the visible floor for nicer puck.
  const visibleWalkPolylines = useMemo(
    () =>
      paths
        .filter((p) => p.type !== "connector" && p.floor === floor)
        .map((p) => {
          const a = locations.find((l) => l.id === p.source_id);
          const b = locations.find((l) => l.id === p.destination_id);
          if (!a || !b) return null;
          return {
            points: [{ x: a.x, y: a.y }, ...(p.points ?? []), { x: b.x, y: b.y }],
          };
        })
        .filter((p): p is { points: { x: number; y: number }[] } => !!p),
    [paths, locations, floor]
  );

  // Route polyline for the visible floor (used for progress + off-route).
  const activeFloorRoute = useMemo(() => {
    if (!visibleRoutePolylines.length) return null;
    const pts = visibleRoutePolylines.flat();
    return pts.length >= 2 ? pts : null;
  }, [visibleRoutePolylines]);

  // Filter anchors for the current floor
  const floorAnchors = useMemo(
    () => anchors.filter((a) => (a.floor ?? 0) === floor),
    [anchors, floor]
  );

  // ---- Live tracking (Google-Maps style) --------------------------------
  const tracking = useLiveTracking({
    position: livePosition,
    projection,
    snapPolylines: visibleWalkPolylines,
    routePolyline: activeFloorRoute,
    metersPerCoord,
    enabled: gpsEnabled && !offCampus && (floor === 0 || floorAnchors.length > 0),
  });

  const [followMe, setFollowMe] = useState(false);
  useEffect(() => {
    if (!gpsEnabled) setFollowMe(false);
  }, [gpsEnabled]);

  // The actual on-screen live marker for the current visible floor.
  // Real GPS (when calibrated) wins over the simulated navigation puck.
  const displayedPuck = useMemo(() => {
    if (tracking.pos) return tracking.pos;
    if (navigating && livePos && livePos.floor === floor) {
      return { x: livePos.x, y: livePos.y };
    }
    return null;
  }, [tracking.pos, navigating, livePos, floor]);

  // Auto-advance the active direction step as the user physically or virtually moves.
  useEffect(() => {
    if (!displayedPuck || route.length < 2 || turnInstructions.length === 0) return;
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < turnInstructions.length; i++) {
      const inst = turnInstructions[i];
      if (inst.floor !== floor) continue;
      const d = euclidean({ x: inst.point.x, y: inst.point.y }, displayedPuck);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const distMeters = bestD * metersPerCoord;
    if (distMeters <= 12) {
      setActiveStep((cur) => Math.max(cur, bestIdx));
    }
  }, [displayedPuck, route.length, turnInstructions, floor, metersPerCoord]);

  // Arrival detection.
  const arrivedRef = useRef(false);
  useEffect(() => {
    if (!to) {
      arrivedRef.current = false;
      return;
    }
    if (tracking.arrived && !arrivedRef.current) {
      arrivedRef.current = true;
      toast.success(`You have arrived at ${getLocationName(to, lang)}`);
    } else if (!tracking.arrived && tracking.remainingMeters != null && tracking.remainingMeters > 30) {
      arrivedRef.current = false;
    }
  }, [tracking.arrived, tracking.remainingMeters, to, lang]);

  // Off-route re-routing: after being off the drawn route for a while, restart
  // the route from the nearest location on this floor.
  const offRouteSince = useRef<number | null>(null);
  useEffect(() => {
    if (!tracking.offRoute || !tracking.pos || !to || params.get("location")) {
      offRouteSince.current = null;
      return;
    }
    if (offRouteSince.current == null) {
      offRouteSince.current = Date.now();
      return;
    }
    if (Date.now() - offRouteSince.current < 8000) return;
    offRouteSince.current = null;
    let best: { loc: CampusLocation; d: number } | null = null;
    for (const l of locations) {
      if ((l.floor ?? 0) !== floor) continue;
      const d = euclidean({ x: l.x, y: l.y }, tracking.pos);
      if (!best || d < best.d) best = { loc: l, d };
    }
    if (best && best.loc.id !== fromId && best.loc.id !== to.id) {
      setFromId(best.loc.id);
      toast.message("Re-routing from your current position…");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking.offRoute, tracking.pos, to, floor, locations, fromId]);

  const accuracyCoord = useMemo(() => {
    if (!livePosition || !projection) return null;
    return livePosition.accuracy / metersPerCoord;
  }, [livePosition, projection, metersPerCoord]);

  const liveHeading = livePosition?.heading ?? null;

  const etaPill = useMemo(() => {
    if (!from || !to || !result) return null;
    // Use live remaining distance while tracking, else the full route length.
    const meters =
      tracking.pos && tracking.remainingMeters != null
        ? tracking.remainingMeters
        : distanceMeters;
    return `${walkingMinutes(meters)} min · ${Math.round(meters)} m`;
  }, [from, to, result, distanceMeters, tracking.pos, tracking.remainingMeters]);

  const handleRecenter = () => {
    if (!gpsEnabled) {
      setGpsEnabled(true);
      setFollowMe(true);
      toast.message("Turning on GPS…");
      return;
    }
    if (!projection) {
      if (isAdmin) {
        toast.error("Add at least one GPS anchor first.");
        setCalibrationOpen(true);
      } else {
        toast.error("GPS is not calibrated for this campus yet. Ask an admin.");
      }
      return;
    }
    if (!livePosition) {
      toast.message("Waiting for GPS signal…");
      return;
    }
    setFollowMe(true);
    toast.success(`Following you (±${Math.round(livePosition.accuracy)}m)`);
  };

  /** Travelled portion of the route on the current floor (dimmed on map). */
  const travelledSegments = useMemo(
    () => (tracking.travelled && tracking.travelled.length >= 2 ? [tracking.travelled] : undefined),
    [tracking.travelled]
  );
  const followActive = followMe && !!tracking.pos;


  const handleSelectFrom = (id: string | "live") => {
    if (id === "live") {
      setIsLiveStart(true);
      if (!gpsEnabled) {
        if (gpsStatus === "denied" || gpsStatus === "error") {
          toast.error("Location permissions are disabled in browser/device settings.");
        } else {
          setGpsEnabled(true);
        }
      }
      if (gpsCurrentLocation) {
        setFromId(gpsCurrentLocation.id);
        setFloor(gpsCurrentLocation.floor ?? 0);
        setFloorTouched(true);
      } else if (mainGate) {
        setFromId(mainGate.id);
        setFloor(mainGate.floor ?? 0);
        setFloorTouched(true);
      }
      toast.success("Starting point set to Live Location");
    } else {
      setIsLiveStart(false);
      setFromId(id);
      const loc = locations.find((l) => l.id === id);
      if (loc) {
        setFloor(loc.floor ?? 0);
        setFloorTouched(true);
        toast.success(`Start: ${getLocationName(loc, lang)}`);
      }
    }
  };

  const handleSelectDestination = (id: string) => {
    setDestId(id);
    setActiveStep(0);
    prevActiveStepRef.current = 0;
    const loc = locations.find((l) => l.id === id);
    if (loc) {
      setFloor(loc.floor ?? 0);
      setFloorTouched(true);
      toast.success(`Destination: ${getLocationName(loc, lang)}`);
    }
    mapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleOpenLocationDetail = (loc: CampusLocation) => {
    setModalLocation(loc);
    setModalOpen(true);
    if (typeof loc.floor === "number") {
      setFloor(loc.floor);
      setFloorTouched(true);
    }
  };

  const onPickFromMap = (loc: CampusLocation) => {
    handleOpenLocationDetail(loc);
  };

  const swapEndpoints = () => {
    const f = fromId;
    const d = destId;
    setFromId(d);
    setDestId(f);
    setIsLiveStart(false);
    if (d) {
      const loc = locations.find((l) => l.id === d);
      if (loc) {
        setFloor(loc.floor ?? 0);
        setFloorTouched(true);
      }
    }
    toast.info("Swapped starting point and destination");
  };

  // When paused, don't show anything - just text showing that it's unavailable
  if (isCurrentlyPaused) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center p-6 text-center bg-background text-foreground select-none">
        <p className="text-base sm:text-lg font-medium text-muted-foreground">
          {activePauseMessage || "Campus Navigation is temporarily unavailable."}
        </p>
        {isAdmin ? (
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await setDatabasePaused(false);
                toast.success("Campus Navigation resumed!");
              }}
              className="h-8 text-xs gap-1.5"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Resume
            </Button>
            <Button size="sm" variant="ghost" asChild className="h-8 text-xs text-muted-foreground">
              <Link to="/admin">Admin</Link>
            </Button>
          </div>
        ) : (
          <Link
            to="/admin"
            className="mt-8 text-[11px] text-muted-foreground/30 hover:text-muted-foreground transition-colors"
          >
            Admin
          </Link>
        )}
      </div>
    );
  }

  // Full-screen overlay
  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background animate-float-in">
        <div className="absolute left-3 top-3 z-30 rounded-full bg-background/90 px-3 py-1.5 text-xs font-bold shadow-soft backdrop-blur">
          {from && to ? (
            <span className="flex items-center gap-1.5">
              <Navigation className="h-3 w-3 text-primary" />
              {getLocationName(from, lang)} → {getLocationName(to, lang)} · {Math.round(distanceMeters)}m
            </span>
          ) : (
            tr("campusMap", lang)
          )}
        </div>
        {floors.length > 1 && (
          <div className="absolute right-3 top-3 z-30">
            <FloorSelector
              options={floorOptions}
              value={floor}
              onChange={handleFloorChange}
            />
          </div>
        )}
        <CampusMap
          mapSrc={floorMap}
          locations={visibleLocations}
          route={visibleEndpointRoute}
          routeSegments={visibleRoutePolylines}
          travelledSegments={travelledSegments}
          crossFloorConnectors={visibleConnectors}

          walkablePaths={undefined}
          onPickLocation={onPickFromMap}
          fullScreen
          onToggleFullScreen={() => setFullScreen(false)}
          className="flex-1"
          legendLabels={{
            current: tr("currentLocation", lang),
            destination: tr("destination", lang),
            route: tr("routeLine", lang),
            connector: tr("connector", lang),
          }}
          showPath={showPath}
          onTogglePath={() => setShowPath((s) => !s)}
          showPathLabel={{ show: tr("showPath", lang), hide: tr("hidePath", lang) }}
          showLabels={showLabels}
          onToggleLabels={() => setShowLabels((s) => !s)}
          labelsLabel={{ show: tr("showLabels", lang), hide: tr("hideLabels", lang) }}
          labelLang={lang}
          liveMarker={displayedPuck}
          liveHeading={liveGpsMap ? liveHeading : null}
          liveAccuracyCoord={liveGpsMap ? accuracyCoord : null}
          liveIsReal={!!liveGpsMap}
          onRecenter={handleRecenter}
          onOpenCalibration={isAdmin ? () => setCalibrationOpen(true) : undefined}
          etaPill={etaPill}
          currentLocationId={gpsCurrentLocation?.id}
          followEnabled={followActive}
          onUserPan={() => setFollowMe(false)}
        />

      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-5 sm:px-6 sm:py-8 overflow-x-hidden">
      <AppHeader onOpenScanner={() => setQrScannerOpen(true)} />

      <main className="mt-6 space-y-5 w-full max-w-full min-w-0">
        {(!online || fromCache) && (
          <div className="flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{tr("offlineMode", lang)}</span>
          </div>
        )}

        {gpsEnabled && offCampus && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <Satellite className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-words">
              You are outside the campus. GPS navigation is available only near campus.
              {distanceToCampusM != null && (
                <span className="ml-1 font-normal opacity-80">
                  (~{(distanceToCampusM / 1000).toFixed(1)} km away) — scan a campus QR to set your location.
                </span>
              )}
            </span>
          </div>
        )}

        {/* Top-level Google Maps Style From -> To Navigation */}
        <section className="w-full max-w-full min-w-0">
          <FromToNavigation
            locations={locations}
            lang={lang}
            fromId={fromId}
            destId={destId}
            isLiveMode={isLiveStart}
            liveLocationName={gpsCurrentLocation ? getLocationName(gpsCurrentLocation, lang) : undefined}
            scannedLocationName={scanned ? getLocationName(from, lang) : undefined}
            gpsEnabled={gpsEnabled}
            onSelectFrom={handleSelectFrom}
            onSelectDest={handleSelectDestination}
            onSwap={swapEndpoints}
            onEnableGps={() => handleSelectFrom("live")}
            onOpenScanner={() => setQrScannerOpen(true)}
          />
        </section>

        {/* Current Location Card */}
        <section
          className="relative overflow-hidden rounded-3xl bg-gradient-primary p-5 sm:p-6 text-primary-foreground shadow-card w-full max-w-full min-w-0"
          aria-label={tr("currentLocation", lang)}
        >
          <div className="absolute -right-12 -top-16 h-48 w-48 rounded-full bg-white/20 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 -left-12 h-48 w-48 rounded-full bg-accent/30 blur-3xl pointer-events-none" />
          <div className="relative min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground/80 truncate">
                {scanned ? <QrCode className="h-3.5 w-3.5 shrink-0" /> : <MapPin className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{tr("currentLocation", lang)}</span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setQrScannerOpen(true)}
                className="gap-1.5 rounded-full bg-white/20 text-primary-foreground hover:bg-white/30 text-xs font-semibold px-3 h-7 shadow-xs shrink-0"
              >
                <QrCode className="h-3.5 w-3.5" />
                {lang === "kn" ? "ಕ್ಯೂಆರ್ ಸ್ಕ್ಯಾನ್" : "Scan QR"}
              </Button>
            </div>
            {(() => {
              const onCampusGps =
                gpsEnabled && !!livePosition && !!projection && !offCampus;
              const showCampus = scanned || onCampusGps;
              const distLabel =
                distanceToCampusM == null
                  ? ""
                  : distanceToCampusM >= 1000
                  ? `${(distanceToCampusM / 1000).toFixed(1)} km`
                  : `${Math.round(distanceToCampusM)} m`;
              return (
                <>
                  {loading ? (
                    <Skeleton className="mt-2 h-9 w-2/3 bg-white/30" />
                  ) : (
                    <h1 className="mt-2 font-display text-xl sm:text-2xl lg:text-3xl font-bold leading-tight break-words">
                      {isCurrentlyPaused
                        ? "Navigation Paused"
                        : showCampus && from
                        ? getLocationName(from, lang)
                        : gpsEnabled && offCampus
                        ? "Outside Campus"
                        : "—"}
                    </h1>
                  )}
                  <p className="mt-1 text-xs text-primary-foreground/75 break-words">
                    {isCurrentlyPaused
                      ? "Campus Navigation is temporarily unavailable."
                      : scanned
                      ? tr("scannedHint", lang)
                      : gpsEnabled && offCampus
                      ? `~${distLabel} from campus · scan a campus QR to set your location`
                      : onCampusGps && livePosition
                      ? nearestAnchor
                        ? `Live GPS · nearest anchor ${nearestAnchor.anchor.label} (${Math.round(nearestAnchor.d)} m) · ±${Math.round(livePosition.accuracy)}m`
                        : `Live GPS · no anchor nearby · using ${mainGate ? getLocationName(mainGate, "en") : "default start"}`
                      : tr("notScanned", lang)}
                  </p>
                </>
              );
            })()}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (gpsStatus === "denied" || gpsStatus === "error") {
                    toast.error("Location permissions are disabled. Please enable location access in browser/device settings.");
                  } else {
                    if (!gpsEnabled) setGpsEnabled(true);
                    if (anchors.length === 0 && isAdmin) setCalibrationOpen(true);
                  }
                }}
                className="gap-1.5 rounded-full bg-white/15 text-primary-foreground hover:bg-white/25"
              >
                <Navigation className="h-3.5 w-3.5" />
                {gpsEnabled
                  ? gpsStatus === "watching"
                    ? "Live GPS on"
                    : gpsStatus === "denied"
                    ? "Turn on Location"
                    : "Connecting…"
                  : "Use my location"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setQrScannerOpen(true)}
                className="gap-1.5 rounded-full bg-white/15 text-primary-foreground hover:bg-white/25"
              >
                <QrCode className="h-3.5 w-3.5" />
                {lang === "kn" ? "ಕ್ಯಾಂಪಸ್ ಕ್ಯೂಆರ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ" : "Scan Location QR"}
              </Button>
              {isAdmin && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setCalibrationOpen(true)}
                  className="gap-1.5 rounded-full bg-white/15 text-primary-foreground hover:bg-white/25"
                >
                  <Satellite className="h-3.5 w-3.5" />
                  Calibrate ({anchors.length})
                </Button>
              )}
            </div>
            {gpsError && gpsEnabled && (
              <p className="mt-2 text-[11px] text-primary-foreground/80">{gpsError}</p>
            )}
          </div>
        </section>

        {/* Quick Access */}
        {!loading && locations.length > 0 && (
          <section>
            <h2 className="mb-3 px-1 text-sm font-bold uppercase tracking-wider text-muted-foreground">
              {tr("quickAccess", lang)}
            </h2>
            <QuickAccess
              locations={locations}
              lang={lang}
              onPick={(id) => {
                const loc = locations.find((l) => l.id === id);
                if (loc) handleOpenLocationDetail(loc);
                else handleSelectDestination(id);
              }}
              config={quickAccess}
            />
          </section>
        )}

        {/* Navigation Mode Control */}
        <NavigationModeBar
          mode={navMode}
          onModeChange={(m) => {
            setNavMode(m);
            setUserOverrodeNavMode(true);
          }}
          offCampus={offCampus}
          distanceToCampusM={distanceToCampusM}
          roadDistanceMeters={outdoorRoadDistance}
          lang={lang}
        />

        {/* Map */}
        <section ref={mapSectionRef} className="relative rounded-3xl border border-border bg-card p-4 shadow-card">
          {/* Compact Destination Panel (shown immediately when destination selected, before starting) */}
          {to && !navigating && (
            <div className="mb-3.5 rounded-2xl border border-primary/40 bg-gradient-to-r from-primary/10 via-primary/5 to-card p-3.5 shadow-soft">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-primary">
                    {lang === "kn" ? "ನ್ಯಾವಿಗೇಟ್ ಮಾಡಿ" : "Navigate to"}
                  </div>
                  <h3 className="font-display text-lg font-bold text-foreground">
                    {getLocationName(to, lang)}
                  </h3>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-primary font-semibold">
                      {floorLabelName(to.floor ?? 0, lang)}
                    </span>
                    <span>•</span>
                    <span>
                      {distanceMeters >= 1000
                        ? `${(distanceMeters / 1000).toFixed(1)} km`
                        : `${Math.round(distanceMeters)} m`}
                    </span>
                    <span>•</span>
                    <span>~{walkingMin} min</span>
                  </div>
                </div>
                <Button
                  type="button"
                  size="lg"
                  onClick={startNavigation}
                  className="w-full sm:w-auto gap-2 bg-gradient-primary text-primary-foreground font-semibold shadow-md hover:opacity-90 shrink-0"
                >
                  <Play className="h-4 w-4 fill-current" />
                  {lang === "kn" ? "ನ್ಯಾವಿಗೇಷನ್ ಪ್ರಾರಂಭಿಸಿ" : "Start Navigation"}
                </Button>
              </div>
            </div>
          )}

          {/* Active Navigation Instruction Panel (overlaid/sticky relative to map) */}
          {navigating && to && turnInstructions.length > 0 && (
            <div className="mb-3.5 md:mb-0 md:absolute md:top-14 md:left-6 md:z-20 md:max-w-sm md:w-80">
              <TurnByTurnCard
                destinationName={getLocationName(to, lang)}
                destinationFloorLabel={floorLabelName(to.floor ?? 0, lang)}
                instructions={turnInstructions}
                activeIndex={activeStep}
                navigating={navigating}
                offRoute={tracking.offRoute}
                arrived={tracking.arrived}
                lang={lang}
                onStartNavigation={startNavigation}
                onStopNavigation={stopNavigation}
                onStepChange={setActiveStep}
              />
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="font-display text-base font-semibold">
              {navMode === "outdoor"
                ? lang === "kn" ? "ಗೂಗಲ್ ಮ್ಯಾಪ್ಸ್ ಹೊರಾಂಗಣ ನಕ್ಷೆ" : "Google Maps Outdoor View"
                : tr("campusMap", lang)}
            </h2>
            {to && from && (
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
                  <Navigation className="h-3 w-3" />
                  {getLocationName(from, lang)} → {getLocationName(to, lang)}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 rounded-full"
                  onClick={swapEndpoints}
                  aria-label={tr("swapFromTo", lang)}
                  title={tr("swapFromTo", lang)}
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {navMode === "outdoor" ? (
            <OutdoorGoogleMap
              userPosition={livePosition}
              anchors={anchors}
              onSwitchToCampusMap={() => {
                setNavMode("campus");
                setUserOverrodeNavMode(true);
              }}
              onRoadDistanceChange={setOutdoorRoadDistance}
              lang={lang}
            />
          ) : (
            <>
              <p className="mb-3 px-1 text-[11px] text-muted-foreground">{tr("tapHint", lang)}</p>

              {floors.length > 1 && (
                <div className="mb-3 overflow-x-auto px-1">
                  <FloorSelector
                    options={floorOptions}
                    value={floor}
                    onChange={handleFloorChange}
                  />
                </div>
              )}

              {crossFloorRoute && (
                <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  {tr("routeOnDifferentFloor", lang)}
                </div>
              )}

              {loading ? (
                <Skeleton className="aspect-[3/2] w-full rounded-2xl" />
              ) : locations.length === 0 ? (
                <div className="flex aspect-[3/2] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center">
                  <Compass className="mb-3 h-10 w-10 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{tr("noLocations", lang)}</p>
                </div>
              ) : (
                <CampusMap
                  mapSrc={floorMap}
                  locations={visibleLocations}
                  currentFloor={floor}
                  route={visibleEndpointRoute}
                  routeSegments={visibleRoutePolylines}
                  travelledSegments={travelledSegments}
                  crossFloorConnectors={visibleConnectors}

                  walkablePaths={undefined}
                  onPickLocation={onPickFromMap}
                  onToggleFullScreen={() => setFullScreen(true)}
                  legendLabels={{
                    current: tr("currentLocation", lang),
                    destination: tr("destination", lang),
                    route: tr("routeLine", lang),
                    connector: tr("connector", lang),
                  }}
                  showPath={showPath}
                  onTogglePath={() => setShowPath((s) => !s)}
                  showPathLabel={{ show: tr("showPath", lang), hide: tr("hidePath", lang) }}
                  showLabels={showLabels}
                  onToggleLabels={() => setShowLabels((s) => !s)}
                  labelsLabel={{ show: tr("showLabels", lang), hide: tr("hideLabels", lang) }}
                  labelLang={lang}
                  liveMarker={displayedPuck}
                  liveHeading={liveGpsMap ? liveHeading : null}
                  liveAccuracyCoord={liveGpsMap ? accuracyCoord : null}
                  liveIsReal={!!liveGpsMap}
                  onRecenter={handleRecenter}
                  onOpenCalibration={isAdmin ? () => setCalibrationOpen(true) : undefined}
                  etaPill={etaPill}
                  currentLocationId={gpsCurrentLocation?.id}
                  followEnabled={followActive}
                  onUserPan={() => setFollowMe(false)}
                />
              )}
            </>
          )}
        </section>

        {/* Directions */}
        <section className="rounded-3xl border border-border bg-card p-5 shadow-card">
          <h2 className="mb-4 font-display text-base font-semibold">
            {tr("directions", lang)}
          </h2>
          {to && from && result ? (
            <>
              {isMultiFloorRoute && (
                <div className="mb-4 rounded-2xl border border-accent/30 bg-accent/10 p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-accent-foreground/80">
                    {tr("crossFloorTitle", lang)}
                  </div>
                  <ol className="mt-2 space-y-1.5 text-xs">
                    {floorGroups.map((g, i) => {
                      const conn = crossFloorConnectors[i];
                      return (
                        <li key={i} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-background/80 px-2 py-0.5 font-mono text-[10px] font-bold">
                              {floorLabel(g.floor)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleFloorChange(g.floor)}
                              className="text-left underline-offset-2 hover:underline"
                            >
                              {getLocationName(g.pts[0], lang)} → {getLocationName(g.pts[g.pts.length - 1], lang)}
                            </button>
                          </div>
                          {conn && (
                            <div className="ml-4 text-[11px] text-muted-foreground">
                              ↳ {tr("takeStairs", lang)
                                .replace("{floor}", floorLabel(conn.toFloor))
                                .replace("{place}", getLocationName(route.find((r) => r.x === conn.x2 && r.y === conn.y2), lang) || "")}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
              <Directions
                steps={steps}
                turnInstructions={turnInstructions}
                destinationName={to ? getLocationName(to, lang) : undefined}
                destinationFloorLabel={to ? floorLabelName(to.floor ?? 0, lang) : undefined}
                offRoute={tracking.offRoute}
                arrived={tracking.arrived}
                lang={lang}
                speakLabel={tr("speak", lang)}
                stopLabel={tr("stop", lang)}
                distanceMeters={distanceMeters}
                walkingMin={walkingMin}
                distanceLabel={tr("distance", lang)}
                walkingLabel={tr("walkingTime", lang)}
                activeStep={activeStep}
                onStepChange={setActiveStep}
                navigating={navigating}
                onStartNavigation={startNavigation}
                onStopNavigation={stopNavigation}
              />
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              {tr("selectDestination", lang)}
            </p>
          )}
        </section>

        <footer className="pb-8 pt-4 text-center text-xs text-muted-foreground">
          <p>
            Tip: scan a campus QR like{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">?location=maingate</code>
          </p>
        </footer>
      </main>

      {isAdmin && (
        <CalibrationDialog
          open={calibrationOpen}
          onOpenChange={setCalibrationOpen}
          anchors={anchors}
          setAnchors={setAnchors}
          locations={locations}
          livePosition={livePosition}
          projection={projection}
        />
      )}

      <LocationDetailModal
        location={modalLocation}
        open={modalOpen}
        onOpenChange={setModalOpen}
        lang={lang}
        onNavigate={(id) => {
          handleSelectDestination(id);
          setModalOpen(false);
        }}
        onSetStart={(id) => {
          setFromId(id);
          const loc = locations.find((l) => l.id === id);
          if (loc) {
            setFloor(loc.floor ?? 0);
            setFloorTouched(true);
          }
          mapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          setModalOpen(false);
        }}
      />

      <QRScanner
        open={qrScannerOpen}
        onClose={() => setQrScannerOpen(false)}
        locations={locations}
        lang={lang}
        currentDestinationId={destId}
        onSelectStart={(id) => {
          setIsLiveStart(false);
          setFromId(id);
          setScannedLocationId(id);
          const loc = locations.find((l) => l.id === id);
          if (loc) {
            setFloor(loc.floor ?? 0);
            setFloorTouched(true);
          }
          mapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        onSelectDestination={(id) => {
          handleSelectDestination(id);
        }}
        onSelectRoute={(startId, destinationId) => {
          setIsLiveStart(false);
          setFromId(startId);
          setDestId(destinationId);
          setScannedLocationId(startId);
          const startLoc = locations.find((l) => l.id === startId);
          if (startLoc) {
            setFloor(startLoc.floor ?? 0);
            setFloorTouched(true);
          }
          mapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          setNavigating(true);
        }}
        onViewLocation={(loc) => {
          handleOpenLocationDetail(loc);
        }}
      />
    </div>
  );
};

export default Index;
