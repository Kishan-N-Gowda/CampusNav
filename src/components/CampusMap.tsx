import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, LocateFixed, Maximize2, Minus, Plus, Satellite, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CampusLocation, CampusPath, Language } from "@/data/locations";
import { cn } from "@/lib/utils";

interface RouteSegment {
  pts: { x: number; y: number }[];
}

interface Connector {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  fromFloor?: number;
  toFloor?: number;
}

interface Polyline {
  points: { x: number; y: number }[];
}

interface Props {
  mapSrc: string;
  locations: CampusLocation[];
  currentFloor?: number;
  /** Route through all floors (used to mark from/to and as a fallback). */
  route: CampusLocation[];
  /** Polylines on the visible floor — drawn as the bold blue line. */
  routeSegments?: { x: number; y: number }[][];
  /** Already-walked portion of the route on this floor (dimmed). */
  travelledSegments?: { x: number; y: number }[][];
  /** Cross-floor dotted connectors visible on this floor. */
  crossFloorConnectors?: Connector[];

  /** Underlay of all walkable paths on this floor (grey polylines). */
  walkablePaths?: Polyline[];
  onPickLocation?: (loc: CampusLocation) => void;
  fullScreen?: boolean;
  onToggleFullScreen?: () => void;
  className?: string;
  legendLabels?: { current: string; destination: string; route: string; connector?: string };
  showPath?: boolean;
  onTogglePath?: () => void;
  showPathLabel?: { show: string; hide: string };
  showLabels?: boolean;
  onToggleLabels?: () => void;
  labelLang?: Language;
  labelsLabel?: { show: string; hide: string };
  /** Live animated position (0-100 coords) for navigation progress mode. */
  liveMarker?: { x: number; y: number } | null;
  /** Heading in degrees (clockwise from north / up) for the live puck. */
  liveHeading?: number | null;
  /** Accuracy radius in map coord units (0-100 space) for the halo. */
  liveAccuracyCoord?: number | null;
  /** True when puck represents real GPS (vs simulated). Changes halo style. */
  liveIsReal?: boolean;
  /** Show the recenter FAB. */
  onRecenter?: () => void;
  /** Show the calibration FAB. */
  onOpenCalibration?: () => void;
  /** Floating ETA pill content (e.g. "12 min · 320 m") rendered top-center. */
  etaPill?: string | null;
  /** Tap-to-pick mode: clicks on the map return (x,y) in 0-100 coords. */
  pickOnMap?: boolean;
  onMapTap?: (pt: { x: number; y: number }) => void;
  /** Highlight this location as "current" when no route is active. */
  currentLocationId?: string;
  /** Google-Maps style follow mode: keep this point centred. */
  followEnabled?: boolean;
  /** Zoom level used while following (default 2.2). */
  followZoom?: number;
  /** Fires when the user pans/zooms manually so follow mode can be released. */
  onUserPan?: () => void;
}


const CATEGORY_EMOJI: Record<string, string> = {
  facility: "🏛️",
  academic: "🎓",
  admin: "🏢",
  entrance: "🚪",
  hostel: "🏠",
  library: "📚",
  canteen: "🍽️",
  sports: "🏃",
  auditorium: "🎭",
};

function emojiFor(loc: CampusLocation): string {
  const slug = loc.slug.toLowerCase();
  if (slug.includes("library")) return "📚";
  if (slug.includes("canteen") || slug.includes("mess")) return "🍽️";
  if (slug.includes("hostel")) return "🏠";
  if (slug.includes("admin")) return "🏢";
  if (slug.includes("audit")) return "🎭";
  if (slug.includes("sport") || slug.includes("gym")) return "🏃";
  return CATEGORY_EMOJI[loc.category] ?? "📍";
}

export function CampusMap({
  mapSrc,
  locations,
  currentFloor = 0,
  route,
  routeSegments,
  travelledSegments,
  crossFloorConnectors,
  walkablePaths,
  onPickLocation,
  fullScreen,
  onToggleFullScreen,
  className,
  legendLabels,
  showPath = true,
  onTogglePath,
  showPathLabel,
  showLabels = false,
  onToggleLabels,
  labelLang = "en",
  labelsLabel,
  liveMarker,
  liveHeading,
  liveAccuracyCoord,
  liveIsReal,
  onRecenter,
  onOpenCalibration,
  etaPill,
  pickOnMap,
  onMapTap,
  currentLocationId,
  followEnabled,
  followZoom = 2.2,
  onUserPan,

}: Props) {
  const from =
    route[0] ??
    (currentLocationId
      ? locations.find((l) => l.id === currentLocationId)
      : undefined);
  const to = route[route.length - 1];

  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  // Track the rendered image rect inside the container so markers/paths align
  // with the actual map pixels (image uses object-contain → letterboxed).
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [fullScreen]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullScreen]);

  const overlayStyle = useMemo<React.CSSProperties>(() => {
    if (!imgNatural || !containerSize.w || !containerSize.h) {
      return { position: "absolute", inset: 0 };
    }
    const cR = containerSize.w / containerSize.h;
    const iR = imgNatural.w / imgNatural.h;
    let w: number, h: number, left: number, top: number;
    if (iR > cR) {
      // image is wider — letterboxed top/bottom
      w = containerSize.w;
      h = containerSize.w / iR;
      left = 0;
      top = (containerSize.h - h) / 2;
    } else {
      // image is taller — letterboxed left/right
      h = containerSize.h;
      w = containerSize.h * iR;
      top = 0;
      left = (containerSize.w - w) / 2;
    }
    return { position: "absolute", left, top, width: w, height: h };
  }, [imgNatural, containerSize]);

  const segments: RouteSegment[] = useMemo(() => {
    if (routeSegments && routeSegments.length) {
      return routeSegments.filter((s) => s.length >= 2).map((pts) => ({ pts }));
    }
    return route.length >= 2 ? [{ pts: route }] : [];
  }, [routeSegments, route]);

  const segmentPaths = useMemo(
    () =>
      segments.map((s) =>
        s.pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
      ),
    [segments]
  );

  const travelledPaths = useMemo(
    () =>
      (travelledSegments ?? [])
        .filter((s) => s.length >= 2)
        .map((s) => s.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")),
    [travelledSegments]
  );

  // ---- Follow mode camera ------------------------------------------------
  // Keep the live puck centred while following. Any manual pan/zoom releases
  // follow mode through onUserPan.
  useEffect(() => {
    if (!followEnabled) return;
    setZoom((z) => (z < followZoom ? followZoom : z));
  }, [followEnabled, followZoom]);

  useEffect(() => {
    if (!followEnabled || !liveMarker || drag.current) return;
    const left = (overlayStyle.left as number) ?? 0;
    const top = (overlayStyle.top as number) ?? 0;
    const w = (overlayStyle.width as number) ?? containerSize.w;
    const h = (overlayStyle.height as number) ?? containerSize.h;
    if (!w || !h || !containerSize.w || !containerSize.h) return;
    const px = left + (w * liveMarker.x) / 100;
    const py = top + (h * liveMarker.y) / 100;
    const z = Math.max(zoom, 1);
    setPan({
      x: -(px - containerSize.w / 2) * z,
      y: -(py - containerSize.h / 2) * z,
    });
  }, [followEnabled, liveMarker, overlayStyle, containerSize, zoom]);

  const panAllowed = zoom > 1 || !!followEnabled;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!panAllowed) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) onUserPan?.();
    setPan({ x: drag.current.px + dx, y: drag.current.py + dy });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!fullScreen) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    onUserPan?.();
    setZoom((z) => Math.min(4, Math.max(1, z + delta)));
  };

  // The route polylines no longer carry location ids; from/to highlights come
  // from the `from` / `to` markers above. Waypoint dots are not drawn.
  const routeIds = useMemo(() => new Set<string>(), []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full overflow-hidden rounded-2xl border border-border bg-muted shadow-soft",
        fullScreen ? "h-full rounded-none border-0" : "aspect-[3/4] sm:aspect-[4/3]",
        className
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{ touchAction: panAllowed ? "none" : "auto", cursor: panAllowed ? "grab" : "default" }}
    >

      <div
        className="absolute inset-0 origin-center transition-transform duration-200 ease-out"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        <img
          ref={imgRef}
          src={mapSrc}
          alt="Campus map"
          loading="lazy"
          onLoad={(e) => {
            const im = e.currentTarget;
            setImgNatural({ w: im.naturalWidth, h: im.naturalHeight });
          }}
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/10" />

        <div style={overlayStyle}>

        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {/* Walkable paths underlay (polylines) */}
          {walkablePaths?.map((p, i) => (
            <polyline
              key={`wp-${i}`}
              points={p.points.map((pt) => `${pt.x},${pt.y}`).join(" ")}
              fill="none"
              stroke="hsl(var(--foreground))"
              strokeOpacity={0.18}
              strokeWidth={0.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Already-walked portion (dimmed) */}
          {showPath &&
            travelledPaths.map((d, i) => (
              <path
                key={`trav-${i}`}
                d={d}
                fill="none"
                stroke="hsl(var(--muted-foreground))"
                strokeOpacity={0.45}
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}

          {/* Active route segments (bold blue) */}

          {showPath &&
            segmentPaths.map((d, i) => (
              <g key={`seg-${i}`}>
                <path
                  d={d}
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeOpacity={0.22}
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  key={`path-${i}-${d.length}`}
                  d={d}
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  style={{ filter: "drop-shadow(0 0 4px hsl(var(--primary)))" }}
                  className="animate-draw-path"
                />
              </g>
            ))}
        </svg>

        {locations.map((l) => {
          const isFrom = l.id === from?.id;
          const isTo = l.id === to?.id;
          if (l.hidden && !isFrom && !isTo) return null;
          const isWaypoint = !isFrom && !isTo && showPath && routeIds.has(l.id);
          return (
            <div
              key={l.id}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2",
                isFrom || isTo ? "z-20" : "z-10"
              )}
              style={{ left: `${l.x}%`, top: `${l.y}%` }}
            >
              <button
                type="button"
                aria-label={l.name.en}
                onClick={() => onPickLocation?.(l)}
                className={cn(
                  "block rounded-full transition-transform",
                  !(isFrom || isTo) && "hover:scale-150",
                  onPickLocation ? "cursor-pointer" : "pointer-events-none"
                )}
              >
                {isFrom ? (
                  <span className="relative block">
                    <span className="absolute inset-0 -m-3 rounded-full bg-primary/30 animate-pulse-dot" />
                    <span className="relative block h-4 w-4 rounded-full bg-primary ring-4 ring-background shadow-glow" />
                  </span>
                ) : isTo ? (
                  <svg width="28" height="36" viewBox="0 0 28 36" className="-translate-y-1/2 drop-shadow-lg">
                    <path
                      d="M14 0 C6 0 0 6 0 14 C0 24 14 36 14 36 C14 36 28 24 28 14 C28 6 22 0 14 0 Z"
                      fill="hsl(var(--accent))"
                    />
                    <circle cx="14" cy="14" r="5" fill="white" />
                  </svg>
                ) : isWaypoint ? (
                  <span className="block h-2.5 w-2.5 rounded-full bg-primary/80 ring-2 ring-background" />
                ) : (
                  <span className="block h-2 w-2 rounded-full bg-foreground/40 ring-1 ring-background" />
                )}
              </button>
              {showLabels && (
                <span
                  className={cn(
                    "pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-foreground shadow-soft backdrop-blur",
                    (isFrom || isTo) && "text-[11px]"
                  )}
                >
                  <span className="mr-0.5">{emojiFor(l)}</span>
                  {l.name[labelLang]}
                </span>
              )}
            </div>
          );
        })}

        {/* Clear Floor-Transition Indicator Badges (e.g., ⬆ Take Stairs → 1st Floor) */}
        {showPath &&
          crossFloorConnectors?.map((c, i) => {
            const isDeparture = c.fromFloor === currentFloor;
            const isArrival = c.toFloor === currentFloor;
            if (!isDeparture && !isArrival) return null;

            const targetFloor = isDeparture ? c.toFloor : c.fromFloor;
            if (targetFloor == null) return null;

            const isUp = isDeparture ? c.toFloor! > c.fromFloor! : c.fromFloor! > c.toFloor!;
            const x = isDeparture ? c.x1 : c.x2;
            const y = isDeparture ? c.y1 : c.y2;
            const arrow = isUp ? "⬆" : "⬇";
            const targetName =
              targetFloor === 0
                ? "Ground Floor"
                : `${targetFloor}${targetFloor === 1 ? "st" : targetFloor === 2 ? "nd" : "th"} Floor`;
            const labelText = isDeparture
              ? `${arrow} Take Stairs → ${targetName}`
              : `${arrow} Stairs from ${targetName}`;

            return (
              <div
                key={`stair-badge-${i}`}
                className="pointer-events-auto absolute z-25 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${x}%`, top: `${y}%` }}
              >
                <div className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground shadow-soft ring-1 ring-background/80">
                  <span className="text-[10px] font-extrabold">{arrow}</span>
                  <span className="whitespace-nowrap">{labelText}</span>
                </div>
              </div>
            );
          })}
        {liveMarker && (
          <div
            className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-300 ease-out"
            style={{ left: `${liveMarker.x}%`, top: `${liveMarker.y}%` }}
          >
            <span className="relative block">
              {/* Accuracy halo (real GPS) — sized to GPS accuracy */}
              {liveIsReal && liveAccuracyCoord != null && liveAccuracyCoord > 0 && (
                <span
                  aria-hidden
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 ring-1 ring-primary/30"
                  style={{
                    // Convert coord units → CSS px using the overlay size.
                    width: `${(liveAccuracyCoord / 100) * (overlayStyle.width as number || 0) * 2}px`,
                    height: `${(liveAccuracyCoord / 100) * (overlayStyle.height as number || 0) * 2}px`,
                    minWidth: "20px",
                    minHeight: "20px",
                    maxWidth: "400px",
                    maxHeight: "400px",
                  }}
                />
              )}
              {/* Heading cone */}
              {typeof liveHeading === "number" && (
                <svg
                  aria-hidden
                  width="64"
                  height="64"
                  viewBox="-32 -32 64 64"
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ transform: `translate(-50%, -50%) rotate(${liveHeading}deg)` }}
                >
                  <defs>
                    <radialGradient id="liveCone" cx="50%" cy="100%" r="100%">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.7" />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                    </radialGradient>
                  </defs>
                  <path d="M 0 0 L -14 -30 A 32 32 0 0 1 14 -30 Z" fill="url(#liveCone)" />
                </svg>
              )}
              <span className="absolute inset-0 -m-3 rounded-full bg-primary/25 animate-pulse-dot" />
              <span className="relative block h-4 w-4 rounded-full bg-primary ring-[3px] ring-background shadow-glow" />
            </span>
          </div>
        )}
        {pickOnMap && onMapTap && (
          <button
            type="button"
            aria-label="Tap to pick a point on the map"
            className="absolute inset-0 z-40 cursor-crosshair bg-primary/5"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const x = ((e.clientX - r.left) / r.width) * 100;
              const y = ((e.clientY - r.top) / r.height) * 100;
              onMapTap({ x, y });
            }}
          />
        )}
        </div>
      </div>

      {etaPill && (
        <div className="pointer-events-none absolute left-1/2 top-2.5 z-30 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground shadow-glow">
          {etaPill}
        </div>
      )}

      {legendLabels && (
        <div className="pointer-events-none absolute top-2 left-2 z-30 flex flex-col gap-1 rounded-xl bg-background/80 px-2 py-1.5 text-[10px] font-medium shadow-soft backdrop-blur">
          <span className="flex items-center gap-1.5">
            <span className="relative inline-flex h-2 w-2 shrink-0">
              <span className="absolute inset-0 -m-0.5 rounded-full bg-primary/30" />
              <span className="relative h-2 w-2 rounded-full bg-primary ring-1 ring-background" />
            </span>
            {legendLabels.current}
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="8" height="10" viewBox="0 0 28 36" className="shrink-0">
              <path
                d="M14 0 C6 0 0 6 0 14 C0 24 14 36 14 36 C14 36 28 24 28 14 C28 6 22 0 14 0 Z"
                fill="hsl(var(--accent))"
              />
              <circle cx="14" cy="14" r="5" fill="white" />
            </svg>
            {legendLabels.destination}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-[2px] w-3.5 shrink-0 rounded-full"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, hsl(var(--primary)) 0 3px, transparent 3px 5px)",
              }}
            />
            {legendLabels.route}
          </span>
          {legendLabels.connector && crossFloorConnectors && crossFloorConnectors.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[2px] w-3.5 shrink-0 rounded-full"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(90deg, hsl(var(--accent)) 0 2px, transparent 2px 4px)",
                }}
              />
              {legendLabels.connector}
            </span>
          )}
        </div>
      )}

      <div className="absolute right-3 top-3 z-30 flex flex-col gap-2">
        {onRecenter && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={onRecenter}
            aria-label="Recenter on my location"
            title="Recenter on my location"
            className="h-9 w-9 rounded-full bg-background text-primary shadow-soft hover:bg-background/90"
          >
            <LocateFixed className="h-4 w-4" />
          </Button>
        )}
        {onOpenCalibration && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={onOpenCalibration}
            aria-label="GPS calibration"
            title="GPS calibration"
            className="h-9 w-9 rounded-full bg-background text-primary shadow-soft hover:bg-background/90"
          >
            <Satellite className="h-4 w-4" />
          </Button>
        )}
        {onToggleLabels && labelsLabel && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={onToggleLabels}
            aria-label={showLabels ? labelsLabel.hide : labelsLabel.show}
            title={showLabels ? labelsLabel.hide : labelsLabel.show}
            className="h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-glow hover:bg-primary/90"
          >
            <Tag className={cn("h-4 w-4", showLabels && "text-primary")} />
          </Button>
        )}
        {onTogglePath && showPathLabel && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={onTogglePath}
            aria-label={showPath ? showPathLabel.hide : showPathLabel.show}
            title={showPath ? showPathLabel.hide : showPathLabel.show}
            className="h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-glow hover:bg-primary/90"
          >
            {showPath ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        )}
        {onToggleFullScreen && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={onToggleFullScreen}
            aria-label={fullScreen ? "Exit full screen" : "Full screen"}
            className="h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-glow hover:bg-primary/90"
          >
            {fullScreen ? <X className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        )}
        {fullScreen && (
          <>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              onClick={() => setZoom((z) => Math.min(4, z + 0.4))}
              aria-label="Zoom in"
              className="h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-glow hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              onClick={() =>
                setZoom((z) => {
                  const next = Math.max(1, z - 0.4);
                  if (next === 1) setPan({ x: 0, y: 0 });
                  return next;
                })
              }
              aria-label="Zoom out"
              className="h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-glow hover:bg-primary/90"
            >
              <Minus className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
