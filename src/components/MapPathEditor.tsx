import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Layers, Loader2, Magnet, Maximize2, RefreshCw, Save, Spline, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import type { CampusLocation, CampusPath } from "@/data/locations";
import { COORD_TO_METERS, euclidean } from "@/data/locations";
import { FloorSelector, floorLabel } from "@/components/FloorSelector";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  mapSrc: string;
  /** Optional per-floor map images keyed by floor number. */
  floorMaps?: Record<string, string>;
  locations: CampusLocation[];
  paths: CampusPath[];
}

interface DragState {
  id: string;
  pointerId: number;
  rect: DOMRect;
}

/** Snap radius in 0-100 coordinate units. ~3 ≈ 12 meters. */
const SNAP_RADIUS = 3;

/**
 * Visual map editor — drag any location marker to update its (x, y) coordinates.
 * Features:
 *  - Snap-to-node: dragged marker snaps onto neighbours connected via the path graph
 *  - Floor filter: edit one floor at a time
 *  - Rebuild path distances: recompute every path.distance from current coordinates
 *  - Per-floor view of nodes/edges
 */
export function MapPathEditor({ mapSrc, floorMaps, locations, paths }: Props) {
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [curved, setCurved] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showAllFloors, setShowAllFloors] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  // Floor handling
  const floors = useMemo(() => {
    const set = new Set<number>(locations.map((l) => l.floor ?? 0));
    return Array.from(set).sort((a, b) => a - b);
  }, [locations]);
  const [floor, setFloor] = useState<number>(0);
  useEffect(() => {
    if (floors.length && !floors.includes(floor)) setFloor(floors[0]);
  }, [floors, floor]);

  const floorOptions = useMemo(
    () =>
      floors.map((f) => ({
        value: f,
        label: floorLabel(f),
        count: locations.filter((l) => (l.floor ?? 0) === f).length,
      })),
    [floors, locations]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  // Reset overrides if the underlying location set changes meaningfully
  useEffect(() => {
    setOverrides((o) => {
      const next: typeof o = {};
      for (const id of Object.keys(o)) {
        if (locations.find((l) => l.id === id)) next[id] = o[id];
      }
      return next;
    });
  }, [locations]);

  const positioned = useMemo(
    () =>
      locations.map((l) => {
        const ov = overrides[l.id];
        return ov ? { ...l, x: ov.x, y: ov.y } : l;
      }),
    [locations, overrides]
  );

  const visibleLocations = useMemo(() => {
    const base = showHidden ? positioned : positioned.filter((l) => !l.hidden);
    return showAllFloors ? base : base.filter((l) => (l.floor ?? 0) === floor);
  }, [positioned, floor, showAllFloors, showHidden]);

  // Walk paths on this floor are bold; connectors touching this floor are shown faintly for context.
  const visiblePaths = useMemo(() => {
    if (showAllFloors) return paths;
    return paths.filter((p) => {
      if (p.type === "connector") {
        return p.floor === floor || p.to_floor === floor;
      }
      return p.floor === floor;
    });
  }, [paths, floor, showAllFloors]);

  const dirtyCount = Object.keys(overrides).length;

  // Snap candidates for the currently dragged node = its graph neighbours
  // plus all nodes within SNAP_RADIUS, on the same floor.
  const snapTarget = (
    draggingId: string,
    cx: number,
    cy: number
  ): { x: number; y: number } | null => {
    const dragging = positioned.find((l) => l.id === draggingId);
    if (!dragging) return null;
    const sameFloor = positioned.filter(
      (l) => l.id !== draggingId && (l.floor ?? 0) === (dragging.floor ?? 0)
    );
    let best: { x: number; y: number; d: number } | null = null;
    for (const n of sameFloor) {
      const d = Math.hypot(n.x - cx, n.y - cy);
      if (d <= SNAP_RADIUS && (!best || d < best.d)) {
        best = { x: n.x, y: n.y, d };
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  };

  const onPointerDown = (e: React.PointerEvent, loc: CampusLocation) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: loc.id, pointerId: e.pointerId, rect };
    setSelectedId(loc.id);
  };

  // Click on empty map area = quick-add a new marker at this point on the current floor.
  const onCanvasClick = async (e: React.MouseEvent) => {
    if (drag.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = +(((e.clientX - rect.left) / rect.width) * 100).toFixed(2);
    const y = +(((e.clientY - rect.top) / rect.height) * 100).toFixed(2);
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    const name = window.prompt(`Name for new marker on ${floorLabel(floor)}?`);
    if (!name?.trim()) return;
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") + "-" + Math.random().toString(36).slice(2, 6);
    const { error } = await supabase.from("locations").insert({
      slug,
      name_en: name.trim(),
      name_kn: name.trim(),
      category: "facility",
      floor,
      icon: "MapPin",
      x,
      y,
    });
    if (error) toast.error(error.message);
    else toast.success(`Added "${name.trim()}" on ${floorLabel(floor)}`);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const rawX = ((e.clientX - d.rect.left) / d.rect.width) * 100;
    const rawY = ((e.clientY - d.rect.top) / d.rect.height) * 100;
    let cx = Math.min(100, Math.max(0, rawX));
    let cy = Math.min(100, Math.max(0, rawY));
    if (snapEnabled) {
      const snap = snapTarget(d.id, cx, cy);
      if (snap) {
        cx = snap.x;
        cy = snap.y;
      }
    }
    setOverrides((o) => ({ ...o, [d.id]: { x: +cx.toFixed(2), y: +cy.toFixed(2) } }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.pointerId === e.pointerId) {
      drag.current = null;
    }
  };

  const reset = () => {
    setOverrides({});
    toast.message("Reverted unsaved coordinate changes");
  };

  const save = async () => {
    const ids = Object.keys(overrides);
    if (ids.length === 0) return;
    setSaving(true);
    let failed = 0;
    for (const id of ids) {
      const { x, y } = overrides[id];
      const { error } = await supabase
        .from("locations")
        .update({ x, y })
        .eq("id", id);
      if (error) failed++;
    }
    setSaving(false);
    if (failed) {
      toast.error(`Saved with ${failed} error(s)`);
    } else {
      toast.success(`Updated ${ids.length} location${ids.length === 1 ? "" : "s"}`);
      setOverrides({});
    }
  };

  /**
   * Recompute every path's distance from current marker coordinates.
   * Walking-direction text is generated on the fly from coordinates by
   * `describeRoute` (in src/data/locations.ts), so updating distances here
   * keeps the entire navigation graph in sync with the visual layout.
   */
  const rebuild = async () => {
    if (paths.length === 0) {
      toast.message("No paths to rebuild yet — add some first.");
      return;
    }
    if (dirtyCount > 0) {
      toast.error("Save coordinate changes first, then rebuild.");
      return;
    }
    setRebuilding(true);
    const byId = new Map(locations.map((l) => [l.id, l]));
    let updated = 0;
    let failed = 0;
    for (const p of paths) {
      const a = byId.get(p.source_id);
      const b = byId.get(p.destination_id);
      if (!a || !b) continue;
      const meters = +(euclidean(a, b) * COORD_TO_METERS).toFixed(2);
      // Skip writes that wouldn't change anything meaningful
      if (Math.abs(meters - p.distance) < 0.01) continue;
      const { error } = await supabase
        .from("paths")
        .update({ distance: meters })
        .eq("id", p.id);
      if (error) failed++;
      else updated++;
    }
    setRebuilding(false);
    if (failed) toast.error(`Rebuilt with ${failed} error(s)`);
    else if (updated === 0) toast.message("All paths already match the layout.");
    else toast.success(`Recomputed ${updated} path${updated === 1 ? "" : "s"}`);
  };

  // Render path lines using updated coordinates (for the visible floor)
  const pathLines = useMemo(() => {
    const byId = new Map(positioned.map((l) => [l.id, l]));
    return visiblePaths
      .map((p) => {
        const a = byId.get(p.source_id);
        const b = byId.get(p.destination_id);
        if (!a || !b) return null;
        return {
          id: p.id,
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          isConnector: p.type === "connector",
        };
      })
      .filter(Boolean) as {
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      isConnector: boolean;
    }[];
  }, [visiblePaths, positioned]);

  const selected = selectedId ? visibleLocations.find((l) => l.id === selectedId) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          Click empty area to add a marker on this floor — drag any marker to reposition.
          {dirtyCount > 0 && (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
              {dirtyCount} unsaved
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={rebuild}
            disabled={rebuilding || saving || paths.length === 0}
            className="gap-1.5"
            title="Recompute all path distances from current coordinates"
          >
            {rebuilding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Rebuild paths
          </Button>
          <Button variant="outline" size="sm" disabled={!dirtyCount || saving} onClick={reset}>
            Revert
          </Button>
          <Button
            size="sm"
            disabled={!dirtyCount || saving}
            onClick={save}
            className="gap-1.5 bg-gradient-primary text-primary-foreground hover:opacity-90"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FloorSelector options={floorOptions} value={floor} onChange={setFloor} />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-soft">
            <Magnet className="h-3.5 w-3.5 text-primary" />
            <Label htmlFor="snap-toggle" className="cursor-pointer text-xs font-medium">
              Snap to nodes
            </Label>
            <Switch id="snap-toggle" checked={snapEnabled} onCheckedChange={setSnapEnabled} />
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-soft">
            <Spline className="h-3.5 w-3.5 text-primary" />
            <Label htmlFor="curved-toggle" className="cursor-pointer text-xs font-medium">
              Curved paths
            </Label>
            <Switch id="curved-toggle" checked={curved} onCheckedChange={setCurved} />
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-soft">
            <Layers className="h-3.5 w-3.5 text-primary" />
            <Label htmlFor="allfloors-toggle" className="cursor-pointer text-xs font-medium">
              Show all floors
            </Label>
            <Switch
              id="allfloors-toggle"
              checked={showAllFloors}
              onCheckedChange={setShowAllFloors}
            />
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-soft">
            <Eye className="h-3.5 w-3.5 text-primary" />
            <Label htmlFor="hidden-toggle" className="cursor-pointer text-xs font-medium">
              Show hidden markers
            </Label>
            <Switch id="hidden-toggle" checked={showHidden} onCheckedChange={setShowHidden} />
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className={cn(
          "relative cursor-crosshair overflow-hidden border border-border bg-muted shadow-soft select-none touch-none transition-all duration-[250ms] ease-out",
          fullscreen
            ? "fixed inset-0 z-50 h-dvh w-dvw rounded-none"
            : "aspect-[3/2] w-full rounded-2xl"
        )}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onCanvasClick}
        title="Click empty area to add a marker on this floor"
      >
        <Button
          type="button"
          size="icon"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            setFullscreen((v) => !v);
          }}
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen editor"}
          className="absolute right-3 top-3 z-30 h-9 w-9 rounded-full bg-background/90 shadow-soft backdrop-blur"
        >
          {fullscreen ? <X className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        <img
          src={floorMaps?.[String(floor)] || mapSrc}
          alt="Campus map editor"
          className="absolute inset-0 h-full w-full object-cover pointer-events-none"
          draggable={false}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/10 pointer-events-none" />

        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full pointer-events-none"
        >
          {pathLines.map((p) => {
            const stroke = p.isConnector ? "hsl(var(--accent))" : "hsl(var(--primary))";
            const common = {
              stroke,
              strokeOpacity: p.isConnector ? 0.45 : 0.6,
              strokeWidth: p.isConnector ? 0.7 : 0.6,
              strokeDasharray: p.isConnector ? "1.2 1.6" : undefined,
              strokeLinecap: "round" as const,
              fill: "none" as const,
              vectorEffect: "non-scaling-stroke" as const,
            };
            if (curved) {
              const mx = (p.x1 + p.x2) / 2;
              const my = (p.y1 + p.y2) / 2;
              const dx = p.x2 - p.x1;
              const dy = p.y2 - p.y1;
              const nx = -dy * 0.18;
              const ny = dx * 0.18;
              const d = `M ${p.x1} ${p.y1} Q ${mx + nx} ${my + ny} ${p.x2} ${p.y2}`;
              return <path key={p.id} d={d} {...common} />;
            }
            return <line key={p.id} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} {...common} />;
          })}
        </svg>

        {visibleLocations.map((l) => {
          const isDirty = !!overrides[l.id];
          const isSelected = selectedId === l.id;
          const offFloor = (l.floor ?? 0) !== floor;
          return (
            <button
              key={l.id}
              type="button"
              aria-label={`Move ${l.name.en}`}
              onPointerDown={(e) => onPointerDown(e, l)}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform",
                "hover:scale-125 cursor-grab active:cursor-grabbing",
                offFloor && "opacity-40",
                l.hidden && "opacity-60",
                isSelected && "scale-125 z-20"
              )}
              style={{ left: `${l.x}%`, top: `${l.y}%`, touchAction: "none" }}
            >
              <span className="relative block">
                {isSelected && (
                  <span className="absolute inset-0 -m-2.5 rounded-full bg-primary/30 animate-pulse-dot" />
                )}
                <span
                  className={cn(
                    "relative block h-3.5 w-3.5 rounded-full ring-2 ring-background",
                    isDirty ? "bg-accent" : offFloor ? "bg-muted-foreground" : "bg-primary",
                    l.hidden && "border-2 border-dashed border-background bg-muted-foreground"
                  )}
                />
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Saved
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" /> Modified (unsaved)
        </span>
        <span className="flex items-center gap-1.5">
          <Magnet className="h-3 w-3" /> Snap radius {SNAP_RADIUS}%
        </span>
        {selected && (
          <span className="ml-auto rounded-full bg-muted px-2.5 py-1 font-mono">
            {selected.name.en}: {selected.x.toFixed(1)}, {selected.y.toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
}
