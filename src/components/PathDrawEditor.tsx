import { useEffect, useMemo, useRef, useState } from "react";
import {
  Eraser,
  Eye,
  Layers,
  Loader2,
  Maximize2,
  MousePointerClick,
  PenTool,
  Save,
  Spline,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import type { CampusLocation, CampusPath, PathPoint } from "@/data/locations";
import { COORD_TO_METERS } from "@/data/locations";
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

interface DraftPath {
  sourceId: string;
  destId: string | null;
  type: "walk" | "connector";
  floor: number;
  toFloor: number | null;
  points: PathPoint[];
}

interface DragHandle {
  pathId: string;
  pointIndex: number;
}

function polylineFor(
  source: CampusLocation,
  dest: CampusLocation,
  points: PathPoint[]
): string {
  const all = [{ x: source.x, y: source.y }, ...points, { x: dest.x, y: dest.y }];
  return all.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

function smoothPath(
  source: CampusLocation,
  dest: CampusLocation,
  points: PathPoint[]
): string {
  const pts = [{ x: source.x, y: source.y }, ...points, { x: dest.x, y: dest.y }];
  if (pts.length < 3) {
    return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function polylineLengthMeters(
  source: CampusLocation,
  dest: CampusLocation,
  points: PathPoint[]
) {
  const pts = [{ x: source.x, y: source.y }, ...points, { x: dest.x, y: dest.y }];
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return +(d * COORD_TO_METERS).toFixed(2);
}

export function PathDrawEditor({ mapSrc, floorMaps, locations, paths: allPaths }: Props) {
  const [mode, setMode] = useState<"auto" | "manual">("manual");
  /** "draw" = click markers to create paths · "edit" = click paths to select/edit/delete */
  const [tool, setTool] = useState<"draw" | "edit">("draw");
  const [smooth, setSmooth] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showAllFloors, setShowAllFloors] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  /** Locally removed paths — keeps the map in sync instantly after a delete. */
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const paths = useMemo(
    () => allPaths.filter((p) => !deletedIds.includes(p.id)),
    [allPaths, deletedIds]
  );


  const floors = useMemo(() => {
    const set = new Set<number>(locations.map((l) => l.floor ?? 0));
    if (set.size === 0) set.add(0);
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

  const [draft, setDraft] = useState<DraftPath | null>(null);
  const [pointEdits, setPointEdits] = useState<Record<string, PathPoint[]>>({});
  const dirtyIds = Object.keys(pointEdits);

  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [pathToDelete, setPathToDelete] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragHandle | null>(null);

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

  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  const visibleLocations = useMemo(
    () => {
      const base = showHidden ? locations : locations.filter((l) => !l.hidden);
      return showAllFloors ? base : base.filter((l) => (l.floor ?? 0) === floor);
    },
    [locations, floor, showAllFloors, showHidden]
  );

  const visiblePaths = useMemo(
    () =>
      showAllFloors
        ? paths
        : paths.filter((p) => {
            if (p.type === "connector") {
              return p.floor === floor || p.to_floor === floor;
            }
            return p.floor === floor;
          }),
    [paths, floor, showAllFloors]
  );

  const pointsFor = (p: CampusPath): PathPoint[] =>
    pointEdits[p.id] ?? p.points ?? [];

  const clientToCoords = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return null;
    return { x: +x.toFixed(2), y: +y.toFixed(2) };
  };

  const onMarkerClick = (loc: CampusLocation, e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode !== "manual") return;
    if (tool === "edit") {
      toast.message("Edit mode — click a drawn path to select it, or switch to Draw mode.");
      return;
    }

    if (!draft) {
      setDraft({
        sourceId: loc.id,
        destId: null,
        type: "walk",
        floor: loc.floor ?? 0,
        toFloor: null,
        points: [],
      });
      setSelectedPathId(null);
      toast.message(`Drawing from ${loc.name.en}. Click waypoints, then a destination marker.`);
      return;
    }
    if (loc.id === draft.sourceId) {
      toast.message("Pick a different destination marker, or double-click to cancel.");
      return;
    }
    const src = byId.get(draft.sourceId);
    if (!src) return;
    const sFloor = src.floor ?? 0;
    const dFloor = loc.floor ?? 0;
    const isConnector = sFloor !== dFloor;
    if (isConnector && draft.points.length > 0) {
      toast.error("Connectors (stairs/lift) cannot have intermediate waypoints.");
      return;
    }
    setDraft({
      ...draft,
      destId: loc.id,
      type: isConnector ? "connector" : "walk",
      floor: sFloor,
      toFloor: isConnector ? dFloor : null,
    });
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    if (dragRef.current) return;
    if (tool === "edit" || mode !== "manual" || !draft || draft.destId) {
      setSelectedPathId(null);
      return;
    }
    const c = clientToCoords(e.clientX, e.clientY);
    if (!c) return;
    setDraft({ ...draft, points: [...draft.points, c] });
  };

  const onCanvasDoubleClick = () => {
    if (draft && !draft.destId) {
      toast.message("Path drawing cancelled.");
      setDraft(null);
    }
  };

  const undoLastPoint = () => {
    if (!draft || draft.points.length === 0) return;
    setDraft({ ...draft, points: draft.points.slice(0, -1) });
  };

  /** Remove every waypoint but keep drawing from the same source marker. */
  const clearDraftPoints = () => {
    if (!draft || draft.points.length === 0) return;
    setDraft({ ...draft, points: [], destId: null, type: "walk", toFloor: null });
    toast.message("Cleared all waypoints of the unfinished path.");
  };


  const saveDraft = async () => {
    if (!draft || !draft.destId) return;
    const src = byId.get(draft.sourceId);
    const dst = byId.get(draft.destId);
    if (!src || !dst) return;

    const dup = paths.find(
      (p) =>
        (p.source_id === draft.sourceId && p.destination_id === draft.destId) ||
        (p.source_id === draft.destId && p.destination_id === draft.sourceId)
    );
    if (dup) {
      toast.error("A path between these two locations already exists.");
      return;
    }

    const distance = polylineLengthMeters(src, dst, draft.points);
    setSaving(true);
    const { error } = await supabase.from("paths").insert({
      source_id: draft.sourceId,
      destination_id: draft.destId,
      distance,
      type: draft.type,
      floor: draft.floor,
      to_floor: draft.toFloor,
      points: draft.points as any,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      draft.type === "connector"
        ? `Connector saved (${distance} m)`
        : `Path saved with ${draft.points.length} waypoint${draft.points.length === 1 ? "" : "s"} (${distance} m)`
    );
    setDraft(null);
  };

  const onHandlePointerDown = (e: React.PointerEvent, pathId: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { pathId, pointIndex: index };
    setSelectedPathId(pathId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const c = clientToCoords(e.clientX, e.clientY);
    if (!c) return;
    if (d.pathId === "draft") {
      setDraft((dr) => {
        if (!dr) return dr;
        const next = [...dr.points];
        next[d.pointIndex] = c;
        return { ...dr, points: next };
      });
    } else {
      setPointEdits((edits) => {
        const path = paths.find((p) => p.id === d.pathId);
        if (!path) return edits;
        const cur = edits[d.pathId] ?? path.points ?? [];
        const next = [...cur];
        next[d.pointIndex] = c;
        return { ...edits, [d.pathId]: next };
      });
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const deletePointFromExisting = (pathId: string, index: number) => {
    setSelectedPathId(pathId);
    setPointEdits((edits) => {
      const path = paths.find((p) => p.id === pathId);
      if (!path) return edits;
      const cur = edits[pathId] ?? path.points ?? [];
      const next = cur.filter((_, i) => i !== index);
      return { ...edits, [pathId]: next };
    });
  };

  const deletePointFromDraft = (index: number) => {
    if (!draft) return;
    setDraft({ ...draft, points: draft.points.filter((_, i) => i !== index) });
  };

  const onSegmentClick = (e: React.MouseEvent, pathId: string, segmentIndex: number) => {
    e.stopPropagation();
    const c = clientToCoords(e.clientX, e.clientY);
    if (!c) return;
    setSelectedPathId(pathId);
    setPointEdits((edits) => {
      const path = paths.find((p) => p.id === pathId);
      if (!path) return edits;
      const cur = edits[pathId] ?? path.points ?? [];
      const next = [...cur];
      next.splice(segmentIndex, 0, c);
      return { ...edits, [pathId]: next };
    });
  };

  const saveEdits = async () => {
    if (dirtyIds.length === 0) return;
    setSaving(true);
    let failed = 0;
    for (const id of dirtyIds) {
      const path = paths.find((p) => p.id === id);
      if (!path) continue;
      const src = byId.get(path.source_id);
      const dst = byId.get(path.destination_id);
      const pts = pointEdits[id];
      const distance =
        src && dst ? polylineLengthMeters(src, dst, pts) : path.distance;
      const { error } = await supabase
        .from("paths")
        .update({ points: pts as any, distance })
        .eq("id", id);
      if (error) failed++;
    }
    setSaving(false);
    if (failed) toast.error(`Saved with ${failed} error(s)`);
    else {
      toast.success(`Updated ${dirtyIds.length} path${dirtyIds.length === 1 ? "" : "s"}`);
      setPointEdits({});
    }
  };

  const revertEdits = () => {
    setPointEdits({});
    toast.message("Reverted unsaved path edits");
  };

  const removePath = async () => {
    if (!pathToDelete) return;
    const id = pathToDelete;
    setPathToDelete(null);
    // Optimistic removal so the map updates immediately, no refresh needed.
    setDeletedIds((d) => [...d, id]);
    const { error } = await supabase.from("paths").delete().eq("id", id);
    if (error) {
      setDeletedIds((d) => d.filter((x) => x !== id));
      toast.error(error.message);
      return;
    }
    toast.success("Path deleted");
    setPointEdits((e) => {
      const { [id]: _drop, ...rest } = e;
      return rest;
    });
    if (selectedPathId === id) setSelectedPathId(null);
  };


  const draftSource = draft ? byId.get(draft.sourceId) : null;
  const draftDest = draft?.destId ? byId.get(draft.destId) : null;

  const renderPathLine = (p: CampusPath) => {
    const src = byId.get(p.source_id);
    const dst = byId.get(p.destination_id);
    if (!src || !dst) return null;
    const pts = pointsFor(p);
    const isConnector = p.type === "connector";
    const isSelected = selectedPathId === p.id;
    const isDirty = !!pointEdits[p.id];
    const stroke = isConnector
      ? "hsl(var(--accent))"
      : isSelected
        ? "hsl(var(--primary))"
        : "hsl(var(--primary))";
    const opacity = isSelected ? 1 : isDirty ? 0.85 : 0.55;
    const width = isSelected ? 1.6 : isConnector ? 0.7 : 0.7;

    const d = smooth ? smoothPath(src, dst, pts) : polylineFor(src, dst, pts);

    const all = [src, ...pts, dst];
    return (
      <g key={p.id}>
        <path
          d={d}
          fill="none"
          stroke={stroke}
          strokeOpacity={opacity}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={isConnector ? "1.2 1.6" : undefined}
          vectorEffect="non-scaling-stroke"
          filter={isSelected ? "drop-shadow(0 0 3px hsl(var(--primary)))" : undefined}

          onClick={(e) => {
            e.stopPropagation();
            setSelectedPathId(p.id);
          }}
          style={{ cursor: "pointer", pointerEvents: "stroke" }}
        />
        {isSelected &&
          all.slice(0, -1).map((a, i) => {
            const b = all[i + 1];
            return (
              <line
                key={`seg-${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={2.5}
                vectorEffect="non-scaling-stroke"
                onClick={(e) => onSegmentClick(e, p.id, i)}
                style={{ cursor: "copy", pointerEvents: "stroke" }}
              />
            );
          })}
      </g>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {mode !== "manual" ? (
            <>Auto mode — paths are straight lines between markers (legacy). Use the Paths tab to add them.</>
          ) : tool === "edit" ? (
            selectedPathId ? (
              <>Path selected — drag its waypoints, click a segment to add one, or use <strong>Delete</strong>.</>
            ) : (
              <>Edit mode — click any drawn path line to select it.</>
            )
          ) : draft && !draft.destId ? (
            <>Click on the map to add waypoints. Click another marker to finish, or double-click to cancel.</>
          ) : draft && draft.destId ? (
            <>Review the route, then click <strong>Save path</strong>.</>
          ) : (
            <>Click a marker to start drawing a path.</>
          )}
          {dirtyIds.length > 0 && (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
              {dirtyIds.length} unsaved edit{dirtyIds.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-soft">
            <Button
              size="sm"
              variant={tool === "draw" ? "default" : "ghost"}
              onClick={() => {
                setTool("draw");
                setSelectedPathId(null);
              }}
              className="h-7 gap-1.5 rounded-full px-3 text-xs"
            >
              <PenTool className="h-3.5 w-3.5" /> Draw
            </Button>
            <Button
              size="sm"
              variant={tool === "edit" ? "default" : "ghost"}
              onClick={() => {
                setTool("edit");
                setDraft(null);
              }}
              className="h-7 gap-1.5 rounded-full px-3 text-xs"
            >
              <MousePointerClick className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>
          {draft && !draft.destId && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={undoLastPoint}
                disabled={draft.points.length === 0}
                className="gap-1.5"
              >
                <Undo2 className="h-4 w-4" /> Undo point
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={clearDraftPoints}
                disabled={draft.points.length === 0}
                className="gap-1.5"
              >
                <Eraser className="h-4 w-4" /> Clear points
              </Button>
            </>
          )}
          {draft && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDraft(null)}
              className="gap-1.5"
            >
              <X className="h-4 w-4" /> Cancel
            </Button>
          )}
          {selectedPathId && !draft && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setPathToDelete(selectedPathId)}
              className="gap-1.5"
            >
              <Trash2 className="h-4 w-4" /> Delete path
            </Button>
          )}
          {draft?.destId && (
            <Button
              size="sm"
              onClick={saveDraft}
              disabled={saving}
              className="gap-1.5 bg-gradient-primary text-primary-foreground hover:opacity-90"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save path
            </Button>
          )}
          {dirtyIds.length > 0 && !draft && (
            <>
              <Button variant="outline" size="sm" onClick={revertEdits} disabled={saving}>
                Revert
              </Button>
              <Button
                size="sm"
                onClick={saveEdits}
                disabled={saving}
                className="gap-1.5 bg-gradient-primary text-primary-foreground hover:opacity-90"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save edits
              </Button>
            </>
          )}
        </div>
      </div>


      <div className="flex flex-wrap items-center justify-between gap-3">
        <FloorSelector options={floorOptions} value={floor} onChange={setFloor} />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-soft">
            <PenTool className="h-3.5 w-3.5 text-primary" />
            <Label className="cursor-pointer text-xs font-medium">
              {mode === "manual" ? "Manual draw" : "Auto path"}
            </Label>
            <Switch
              checked={mode === "manual"}
              onCheckedChange={(v) => {
                setMode(v ? "manual" : "auto");
                setDraft(null);
              }}
            />
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-soft">
            <Spline className="h-3.5 w-3.5 text-primary" />
            <Label className="cursor-pointer text-xs font-medium">Smooth curves</Label>
            <Switch checked={smooth} onCheckedChange={setSmooth} />
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-soft">
            <Layers className="h-3.5 w-3.5 text-primary" />
            <Label className="cursor-pointer text-xs font-medium">Show all floors</Label>
            <Switch checked={showAllFloors} onCheckedChange={setShowAllFloors} />
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-soft">
            <Eye className="h-3.5 w-3.5 text-primary" />
            <Label className="cursor-pointer text-xs font-medium">Show hidden markers</Label>
            <Switch checked={showHidden} onCheckedChange={setShowHidden} />
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
        onDoubleClick={onCanvasDoubleClick}
      >
        <Button
          type="button"
          size="icon"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            setFullscreen((v) => !v);
          }}
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
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
          className="absolute inset-0 h-full w-full"
          style={{ pointerEvents: "none" }}
        >
          <g style={{ pointerEvents: "auto" }}>
            {visiblePaths.map(renderPathLine)}
          </g>

          {draft && draftSource && (
            <g>
              {(() => {
                const pts = [
                  { x: draftSource.x, y: draftSource.y },
                  ...draft.points,
                  ...(draftDest ? [{ x: draftDest.x, y: draftDest.y }] : []),
                ];
                if (pts.length < 2) return null;
                const d = pts
                  .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
                  .join(" ");
                const dCurve = (() => {
                  if (!smooth || pts.length < 3) return d;
                  let s = `M ${pts[0].x} ${pts[0].y}`;
                  for (let i = 1; i < pts.length - 1; i++) {
                    const mx = (pts[i].x + pts[i + 1].x) / 2;
                    const my = (pts[i].y + pts[i + 1].y) / 2;
                    s += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
                  }
                  const last = pts[pts.length - 1];
                  s += ` L ${last.x} ${last.y}`;
                  return s;
                })();
                return (
                  <path
                    d={dCurve}
                    fill="none"
                    stroke="hsl(var(--accent))"
                    strokeWidth={1.1}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="1.5 1.5"
                    vectorEffect="non-scaling-stroke"
                    style={{
                      filter: "drop-shadow(0 0 3px hsl(var(--accent)))",
                    }}
                  />
                );
              })()}
            </g>
          )}
        </svg>

        {visibleLocations.map((l) => {
          const isSrc = draft?.sourceId === l.id;
          const isDst = draft?.destId === l.id;
          const offFloor = (l.floor ?? 0) !== floor;
          return (
            <button
              key={l.id}
              type="button"
              aria-label={l.name.en}
              onClick={(e) => onMarkerClick(l, e)}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-125 cursor-pointer",
                offFloor && "opacity-40",
                l.hidden && "opacity-60",
                (isSrc || isDst) && "scale-125 z-20"
              )}
              style={{ left: `${l.x}%`, top: `${l.y}%`, touchAction: "none" }}
            >
              <span className="relative block">
                {(isSrc || isDst) && (
                  <span className="absolute inset-0 -m-2.5 rounded-full bg-accent/40 animate-pulse-dot" />
                )}
                <span
                  className={cn(
                    "relative block h-3.5 w-3.5 rounded-full ring-2 ring-background",
                    isSrc ? "bg-accent" : offFloor ? "bg-muted-foreground" : "bg-primary",
                    l.hidden && "border-2 border-dashed border-background bg-muted-foreground"
                  )}
                />
              </span>
              <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-background/85 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-foreground shadow-soft backdrop-blur">
                {l.name.en}
              </span>
            </button>
          );
        })}

        {draft &&
          draft.points.map((p, i) => (
            <div
              key={`draft-${i}`}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              <button
                type="button"
                aria-label={`Waypoint ${i + 1}`}
                onPointerDown={(e) => onHandlePointerDown(e, "draft", i)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  deletePointFromDraft(i);
                }}
                className="block cursor-grab active:cursor-grabbing"
                style={{ touchAction: "none" }}
                title="Drag to move · double-click to delete"
              >
                <span className="block h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-background shadow-soft" />
              </button>
              <button
                type="button"
                aria-label={`Delete waypoint ${i + 1}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  deletePointFromDraft(i);
                }}
                title="Delete this waypoint"
                className="absolute -right-3.5 -top-3.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-soft"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}

        {selectedPathId &&
          (() => {
            const p = visiblePaths.find((x) => x.id === selectedPathId);
            if (!p) return null;
            const pts = pointsFor(p);
            return pts.map((pt, i) => (
              <div
                key={`${p.id}-${i}`}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
              >
                <button
                  type="button"
                  aria-label={`Path point ${i + 1}`}
                  onPointerDown={(e) => onHandlePointerDown(e, p.id, i)}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    deletePointFromExisting(p.id, i);
                  }}
                  className="block cursor-grab active:cursor-grabbing"
                  style={{ touchAction: "none" }}
                  title="Drag to move · double-click to delete"
                >
                  <span className="block h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-background shadow-soft" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete path point ${i + 1}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePointFromExisting(p.id, i);
                  }}
                  title="Delete this waypoint"
                  className="absolute -right-3.5 -top-3.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-soft"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ));
          })()}
      </div>

      {selectedPathId && !draft && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-primary/60 bg-card p-3 shadow-soft">
          {(() => {
            const p = paths.find((x) => x.id === selectedPathId);
            if (!p) return null;
            const a = byId.get(p.source_id);
            const b = byId.get(p.destination_id);
            const pts = pointsFor(p);
            return (
              <>
                <div className="text-xs">
                  <span className="font-semibold">{a?.name.en ?? "?"}</span>
                  <span className="mx-1 text-muted-foreground">→</span>
                  <span className="font-semibold">{b?.name.en ?? "?"}</span>
                  <span className="ml-2 text-muted-foreground">
                    · {pts.length} waypoint{pts.length === 1 ? "" : "s"} · {p.type === "connector" ? `F${p.floor}↔F${p.to_floor}` : `F${p.floor}`}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTool("edit");
                      setDraft(null);
                      toast.message("Drag the waypoint dots, click a segment to add one, then Save edits.");
                    }}
                    className="gap-1.5"
                  >
                    <MousePointerClick className="h-4 w-4" /> Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setPathToDelete(p.id)}
                    className="gap-1.5"
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedPathId(null)}>
                    Cancel
                  </Button>
                </div>
              </>
            );
          })()}
        </div>
      )}


      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Markers / Saved paths
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" /> Active draft / waypoints
        </span>
        <span className="ml-auto">Tip: select a path to drag, add (click segment), or delete its waypoints.</span>
      </div>

      <Dialog open={!!pathToDelete} onOpenChange={(o) => !o && setPathToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this path?</DialogTitle>
            <DialogDescription>
              The edge will be removed from the navigation graph and any saved waypoints lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPathToDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={removePath}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
