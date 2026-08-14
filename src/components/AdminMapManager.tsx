import { useMemo, useRef, useState } from "react";
import { ImageUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAppConfig } from "@/hooks/useAppConfig";
import { floorLabel } from "@/components/FloorSelector";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ACCEPT = "image/png,image/jpeg,image/svg+xml";
const TYPES = ["image/png", "image/jpeg", "image/svg+xml"];

interface Props {
  canEdit: boolean;
  /** Floors that exist in the location data, so admins can map them. */
  floors?: number[];
}

export function AdminMapManager({ canEdit, floors = [] }: Props) {
  const { mapSrc, mapPath, floorMapPaths, floorMapSrcs, refresh } = useAppConfig();
  const [extraFloors, setExtraFloors] = useState<number[]>([]);
  const [newFloor, setNewFloor] = useState("");
  const [floor, setFloor] = useState<number>(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const floorList = useMemo(() => {
    const set = new Set<number>([0, 1, 2]);
    floors.forEach((f) => set.add(f));
    Object.keys(floorMapPaths).forEach((f) => set.add(Number(f)));
    extraFloors.forEach((f) => set.add(f));
    return Array.from(set).sort((a, b) => a - b);
  }, [floors, floorMapPaths, extraFloors]);

  const currentPath = floorMapPaths[String(floor)] ?? null;
  const currentSrc = floorMapSrcs[String(floor)] || mapSrc;

  const clearPick = () => {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const pick = (f: File | null) => {
    if (!f) return;
    if (!TYPES.includes(f.type)) {
      toast.error("Use a PNG, JPG or SVG image.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("Map must be smaller than 10 MB.");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  /** Read the current setting, merge in the new floor map, write back. */
  const writeFloors = async (nextFloors: Record<string, string | null>) => {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "campus_map")
      .maybeSingle();
    const value = (data?.value ?? {}) as { path?: string | null; floors?: Record<string, string | null> };
    const merged: Record<string, string | null> = { ...(value.floors ?? {}), ...nextFloors };
    for (const k of Object.keys(merged)) {
      if (!merged[k]) delete merged[k];
    }
    const { error } = await supabase
      .from("app_settings")
      .update({ value: { path: value.path ?? mapPath ?? null, floors: merged } })
      .eq("key", "campus_map");
    if (error) throw error;
  };

  const save = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `floors/${floor}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("campus-maps")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;

      await writeFloors({ [String(floor)]: path });

      if (currentPath && currentPath !== path) {
        await supabase.storage.from("campus-maps").remove([currentPath]);
      }
      toast.success(`${floorLabel(floor)} map updated for everyone`);
      clearPick();
      refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const removeFloorMap = async () => {
    if (!currentPath) return;
    setBusy(true);
    try {
      await writeFloors({ [String(floor)]: null });
      await supabase.storage.from("campus-maps").remove([currentPath]);
      toast.success(`${floorLabel(floor)} map removed — falls back to the default map`);
      refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Could not remove map");
    } finally {
      setBusy(false);
    }
  };

  const addFloor = () => {
    const n = Number(newFloor);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      toast.error("Enter a whole floor number, e.g. 3");
      return;
    }
    setExtraFloors((f) => Array.from(new Set([...f, n])));
    setNewFloor("");
    setFloor(n);
    clearPick();
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="mb-2 text-sm font-semibold">Floor maps</p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {floorList.map((f) => {
            const has = !!floorMapPaths[String(f)];
            return (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFloor(f);
                  clearPick();
                }}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  floor === f
                    ? "border-transparent bg-primary text-primary-foreground shadow-soft"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                )}
              >
                {floorLabel(f)}
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    has ? "bg-emerald-400" : "bg-muted-foreground/40"
                  )}
                />
              </button>
            );
          })}
        </div>
        {canEdit && (
          <div className="mt-3 flex items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-floor" className="text-xs">
                Add another floor
              </Label>
              <Input
                id="new-floor"
                value={newFloor}
                onChange={(e) => setNewFloor(e.target.value)}
                placeholder="3"
                inputMode="numeric"
                className="h-9 w-24"
              />
            </div>
            <Button variant="outline" size="sm" onClick={addFloor} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Add floor
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="map-file">
              Upload map for {floorLabel(floor)} (PNG, JPG, SVG)
            </Label>
            <input
              id="map-file"
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              disabled={!canEdit || busy}
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
              className="block w-full max-w-sm cursor-pointer rounded-xl border border-border bg-background p-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-secondary-foreground"
            />
          </div>
          {canEdit && (
            <>
              <Button onClick={save} disabled={!file || busy} className="gap-2">
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {currentPath ? "Replace map" : "Save map"}
              </Button>
              {file && (
                <Button variant="outline" onClick={clearPick} disabled={busy}>
                  Cancel
                </Button>
              )}
              {currentPath && !file && (
                <Button
                  variant="outline"
                  onClick={removeFloorMap}
                  disabled={busy}
                  className="gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete this floor's map
                </Button>
              )}
            </>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Each floor can have its own map. Floors without a map fall back to the
          default campus map. Markers and paths use percentage coordinates, so
          they stay aligned as long as each floor plan uses the same framing.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-semibold">
            Current map · {floorLabel(floor)}
            {!currentPath && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                (default map)
              </span>
            )}
          </p>
          <div className="overflow-hidden rounded-2xl border border-border bg-muted">
            <img
              src={currentSrc}
              alt={`Current map for ${floorLabel(floor)}`}
              className="h-64 w-full object-contain"
            />
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Preview</p>
          <div className="flex h-64 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-muted/40">
            {preview ? (
              <img
                src={preview}
                alt="New floor map preview"
                className="h-64 w-full object-contain"
              />
            ) : (
              <span className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                <ImageUp className="h-6 w-6" />
                Choose a file to preview it
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
