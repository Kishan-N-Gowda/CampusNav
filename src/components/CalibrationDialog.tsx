import { useMemo, useState } from "react";
import { Crosshair, MapPin, Plus, Trash2, Satellite, CheckCircle2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { CampusLocation } from "@/data/locations";
import type { GpsAnchor, Projection } from "@/lib/geo";
import type { LiveGeo } from "@/hooks/useGeolocation";
import { haversine } from "@/lib/geo";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchors: GpsAnchor[];
  setAnchors: (a: GpsAnchor[]) => void;
  locations: CampusLocation[];
  livePosition: LiveGeo | null;
  projection: Projection | null;
  /** Tell parent to enter "tap on map" mode for a manual (x,y) pick. */
  onRequestMapPick?: (label: string, lat: number, lng: number) => void;
}

export function CalibrationDialog({
  open,
  onOpenChange,
  anchors,
  setAnchors,
  locations,
  livePosition,
  projection,
}: Props) {
  const [pickedLocId, setPickedLocId] = useState<string>("");
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [manualLabel, setManualLabel] = useState("");

  const pickedLoc = useMemo(
    () => locations.find((l) => l.id === pickedLocId),
    [locations, pickedLocId]
  );

  const addFromCurrentGps = () => {
    if (!livePosition) {
      toast.error("No GPS signal yet — enable location and wait a few seconds.");
      return;
    }
    if (!pickedLoc) {
      toast.error("Pick the landmark you are standing at.");
      return;
    }
    const newAnchor: GpsAnchor = {
      id: `${pickedLoc.id}-${Date.now()}`,
      label: pickedLoc.name.en,
      lat: livePosition.lat,
      lng: livePosition.lng,
      x: pickedLoc.x,
      y: pickedLoc.y,
    };
    setAnchors([...anchors.filter((a) => a.label !== pickedLoc.name.en), newAnchor]);
    setPickedLocId("");
    toast.success(`Anchor saved: ${pickedLoc.name.en}`);
  };

  const addManual = () => {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (!pickedLoc) {
      toast.error("Pick the matching landmark on your map.");
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast.error("Enter valid latitude and longitude.");
      return;
    }
    const newAnchor: GpsAnchor = {
      id: `${pickedLoc.id}-${Date.now()}`,
      label: manualLabel || pickedLoc.name.en,
      lat,
      lng,
      x: pickedLoc.x,
      y: pickedLoc.y,
    };
    setAnchors([...anchors.filter((a) => a.label !== newAnchor.label), newAnchor]);
    setManualLat("");
    setManualLng("");
    setManualLabel("");
    setPickedLocId("");
    toast.success(`Anchor saved: ${newAnchor.label}`);
  };

  const remove = (id: string) => {
    setAnchors(anchors.filter((a) => a.id !== id));
  };

  // Calibration quality estimate: residual error in metres for similarity fits.
  const quality = useMemo(() => {
    if (!projection || projection.anchorCount < 2) return null;
    let total = 0;
    for (const a of anchors) {
      const { x, y } = projection.toMap(a.lat, a.lng);
      const dx = (x - a.x) * projection.metersPerCoord;
      const dy = (y - a.y) * projection.metersPerCoord;
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total / anchors.length;
  }, [projection, anchors]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Satellite className="h-5 w-5 text-primary" /> GPS Calibration
          </DialogTitle>
          <DialogDescription>
            Anchor real-world GPS to your campus map. 2+ anchors enable
            rotation & scale; 3+ improves accuracy.
          </DialogDescription>
        </DialogHeader>

        {/* Status */}
        <div className="rounded-2xl border border-border bg-muted/40 p-3 text-sm">
          {projection ? (
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <div className="font-semibold">
                  {projection.kind === "similarity"
                    ? `Calibrated (${projection.anchorCount} anchors)`
                    : "Single-anchor mode (north-up)"}
                </div>
                <div className="text-xs text-muted-foreground">
                  ≈ {projection.metersPerCoord.toFixed(2)} m per map unit
                  {quality != null && ` · avg error ${quality.toFixed(1)} m`}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <div>
                <div className="font-semibold">Not calibrated</div>
                <div className="text-xs">Add at least one anchor to enable GPS.</div>
              </div>
            </div>
          )}
        </div>

        {/* Add anchor — current GPS */}
        <div className="space-y-3 rounded-2xl border border-border p-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Crosshair className="h-3.5 w-3.5" /> Add anchor at my location
          </div>
          <div className="text-xs text-muted-foreground">
            Stand exactly at a known landmark, pick it below, then tap Save.
            {livePosition && (
              <span className="mt-1 block font-mono text-[10px] text-foreground/70">
                GPS: {livePosition.lat.toFixed(6)}, {livePosition.lng.toFixed(6)} (±{Math.round(livePosition.accuracy)}m)
              </span>
            )}
          </div>
          <Select value={pickedLocId} onValueChange={setPickedLocId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick the landmark…" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name.en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            onClick={addFromCurrentGps}
            disabled={!livePosition || !pickedLoc}
            className="w-full gap-2 bg-gradient-primary text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Save anchor at current GPS
          </Button>
        </div>

        {/* Add anchor — manual GPS */}
        <details className="rounded-2xl border border-border p-3">
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Add anchor manually (paste lat/lng)
          </summary>
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Latitude</Label>
                <Input
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  placeholder="13.054300"
                  inputMode="decimal"
                />
              </div>
              <div>
                <Label className="text-xs">Longitude</Label>
                <Input
                  value={manualLng}
                  onChange={(e) => setManualLng(e.target.value)}
                  placeholder="77.581623"
                  inputMode="decimal"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Landmark on map</Label>
              <Select value={pickedLocId} onValueChange={setPickedLocId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick landmark…" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name.en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={addManual}
              disabled={!pickedLoc || !manualLat || !manualLng}
              className="w-full gap-2"
            >
              <Plus className="h-4 w-4" /> Save manual anchor
            </Button>
          </div>
        </details>

        {/* Anchor list */}
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Saved anchors ({anchors.length})
          </div>
          {anchors.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No anchors yet.
            </div>
          )}
          <ul className="space-y-1.5">
            {anchors.map((a) => {
              // Residual for this anchor
              let residualM: number | null = null;
              if (projection && projection.anchorCount >= 2) {
                const p = projection.toMap(a.lat, a.lng);
                const dx = (p.x - a.x) * projection.metersPerCoord;
                const dy = (p.y - a.y) * projection.metersPerCoord;
                residualM = Math.sqrt(dx * dx + dy * dy);
              }
              const liveDist = livePosition ? haversine(livePosition, a) : null;
              return (
                <li
                  key={a.id}
                  className="flex items-start justify-between gap-2 rounded-xl border border-border bg-muted/30 p-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      <MapPin className="h-3.5 w-3.5 text-primary" />
                      <span className="truncate">{a.label}</span>
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {a.lat.toFixed(6)}, {a.lng.toFixed(6)} → ({a.x.toFixed(1)}, {a.y.toFixed(1)})
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {residualM != null && (
                        <Badge variant="secondary" className="text-[10px]">
                          fit ±{residualM.toFixed(1)}m
                        </Badge>
                      )}
                      {liveDist != null && (
                        <Badge variant="outline" className="text-[10px]">
                          {liveDist < 1000
                            ? `${Math.round(liveDist)}m from you`
                            : `${(liveDist / 1000).toFixed(1)}km from you`}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => remove(a.id)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
