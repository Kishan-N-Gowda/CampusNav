import { useEffect, useMemo, useState } from "react";
import * as Icons from "lucide-react";
import { GripVertical, Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { QUICK_ACCESS_COUNTS, useAppConfig } from "@/hooks/useAppConfig";
import type { CampusLocation } from "@/data/locations";
import { getLocationName } from "@/data/locations";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  locations: CampusLocation[];
  canEdit: boolean;
}

export function AdminQuickAccess({ locations = [], canEdit }: Props) {
  const safeLocations = useMemo(
    () => (Array.isArray(locations) ? locations.filter(Boolean) : []),
    [locations]
  );
  const { quickAccess, refresh } = useAppConfig();
  const [count, setCount] = useState(quickAccess.count);
  const [ids, setIds] = useState<string[]>(quickAccess.location_ids);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    setCount(quickAccess.count);
    setIds(quickAccess.location_ids);
  }, [quickAccess.count, quickAccess.location_ids]);

  const byId = useMemo(
    () => new Map(safeLocations.map((l) => [l.id, l])),
    [safeLocations]
  );
  const selected = ids.filter((id) => byId.has(id));
  const available = safeLocations.filter((l) => !ids.includes(l.id));

  const add = (id: string) => {
    if (!id || ids.includes(id)) return;
    if (ids.length >= count) {
      toast.error(`Limit reached — increase the tile count to add more.`);
      return;
    }
    setIds([...ids, id]);
  };

  const remove = (id: string) => setIds(ids.filter((x) => x !== id));

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setIds(next);
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .update({ value: { count, location_ids: ids.slice(0, count) } })
      .eq("key", "quick_access");
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Quick Access saved");
    refresh();
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label>Number of tiles</Label>
            <Select
              value={String(count)}
              disabled={!canEdit}
              onValueChange={(v) => {
                const n = Number(v);
                setCount(n);
                setIds((prev) => prev.slice(0, n));
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUICK_ACCESS_COUNTS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} tiles
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Add a location</Label>
            <Select value="" disabled={!canEdit} onValueChange={add}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select location…" />
              </SelectTrigger>
              <SelectContent>
                {available.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {getLocationName(l, "en")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {canEdit && (
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {canEdit
            ? "Drag the tiles to reorder. The order here is the order users see."
            : "Only a super admin can change these settings."}
        </p>
      </div>

      <div className="space-y-2">
        {selected.length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No tiles selected — the app will pick locations automatically.
          </p>
        )}
        {selected.map((id, i) => {
          const loc = byId.get(id);
          if (!loc) return null;
          const locName = getLocationName(loc, "en");
          const Icon =
            (Icons as unknown as Record<string, Icons.LucideIcon>)[loc.icon] ??
            Icons.MapPin;
          return (
            <div
              key={id}
              draggable={canEdit}
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== i) {
                  move(dragIndex, i);
                  setDragIndex(i);
                }
              }}
              onDragEnd={() => setDragIndex(null)}
              className={cn(
                "flex items-center gap-3 rounded-xl border border-border bg-card p-3",
                canEdit && "cursor-grab active:cursor-grabbing",
                dragIndex === i && "opacity-60 ring-2 ring-primary"
              )}
            >
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{locName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  Floor {loc.floor}
                </p>
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                #{i + 1}
              </span>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => remove(id)}
                  aria-label="Remove tile"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
