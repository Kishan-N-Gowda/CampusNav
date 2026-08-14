import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  Loader2,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  QrCode,
  Trash2,
  Upload,
  Network,
  Move,
  Eye,
  EyeOff,
  Check,
} from "lucide-react";
import { AdminQuickAccess } from "@/components/AdminQuickAccess";
import { AdminMapManager } from "@/components/AdminMapManager";
import { useAppConfig } from "@/hooks/useAppConfig";
import { MapPathEditor } from "@/components/MapPathEditor";
import { PathDrawEditor } from "@/components/PathDrawEditor";
import { AdminUsers } from "@/components/AdminUsers";
import { AdminVoiceSettings } from "@/components/AdminVoiceSettings";
import QRCode from "qrcode";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import { useCampusData } from "@/hooks/useCampusData";
import { useAuth } from "@/hooks/useAuth";
import type { CampusLocation } from "@/data/locations";
import { toast } from "sonner";

const CATEGORIES = ["academic", "admin", "facility", "entrance"] as const;
type Category = (typeof CATEGORIES)[number];

interface FormState {
  id?: string;
  slug: string;
  name_en: string;
  name_kn: string;
  category: Category;
  floor: number;
  icon: string;
  description: string;
  hidden: boolean;
  x: number;
  y: number;
}

const emptyForm: FormState = {
  slug: "",
  name_en: "",
  name_kn: "",
  category: "facility",
  floor: 0,
  icon: "MapPin",
  description: "",
  hidden: false,
  x: 50,
  y: 50,
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function AdminInner() {
  const navigate = useNavigate();
  const { user, isSuperAdmin } = useAuth();
  const { locations, paths, loading } = useCampusData();
  const { mapSrc: campusMap, floorMapSrcs } = useAppConfig();
  const [tab, setTab] = useState("locations");
  const [editing, setEditing] = useState<FormState | null>(null);
  const [showDelete, setShowDelete] = useState<CampusLocation | null>(null);
  const [qrFor, setQrFor] = useState<CampusLocation | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Path editor state
  const [pathFrom, setPathFrom] = useState<string>("");
  const [pathTo, setPathTo] = useState<string>("");
  const [pathDistance, setPathDistance] = useState<string>("");
  const [pathType, setPathType] = useState<"walk" | "connector">("walk");
  const [pathFloor, setPathFloor] = useState<number>(0);
  const [pathToDelete, setPathToDelete] = useState<string | null>(null);
  const [distanceEdits, setDistanceEdits] = useState<Record<string, string>>({});
  const [savingDistance, setSavingDistance] = useState<string | null>(null);

  // Marker visibility
  const [showHiddenMarkers, setShowHiddenMarkers] = useState(false);

  const toggleHidden = async (loc: CampusLocation) => {
    const next = !loc.hidden;
    const { error } = await supabase.from("locations").update({ hidden: next }).eq("id", loc.id);
    if (error) return toast.error(error.message);
    toast.success(next ? `"${loc.name.en}" hidden from maps (still routable)` : `"${loc.name.en}" is visible again`);
  };

  const saveDistance = async (id: string) => {
    const raw = distanceEdits[id];
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return toast.error("Distance must be greater than 0 metres");
    if (value > 2000) return toast.error("Distance looks too large (>2000 m)");
    setSavingDistance(id);
    const { error } = await supabase.from("paths").update({ distance: value }).eq("id", id);
    setSavingDistance(null);
    if (error) return toast.error(error.message);
    setDistanceEdits((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    toast.success(`Distance set to ${value} m`);
  };

  // Connector helper state
  const [connSource, setConnSource] = useState<string>("");
  const [connTargetFloor, setConnTargetFloor] = useState<string>("");
  const [connTargetId, setConnTargetId] = useState<string>("");
  const [connDistance, setConnDistance] = useState<string>("4");
  const [connCreating, setConnCreating] = useState(false);

  const stats = useMemo(
    () => ({
      total: locations.length,
      qrLinks: locations.length,
      paths: paths.length,
      categories: new Set(locations.map((l) => l.category)).size,
    }),
    [locations, paths]
  );

  const startNew = () => setEditing({ ...emptyForm });

  const startEdit = (loc: CampusLocation) =>
    setEditing({
      id: loc.id,
      slug: loc.slug,
      name_en: loc.name.en,
      name_kn: loc.name.kn,
      category: (loc.category as Category) ?? "facility",
      floor: loc.floor ?? 0,
      icon: loc.icon || "MapPin",
      description: loc.description ?? "",
      hidden: !!loc.hidden,
      x: loc.x,
      y: loc.y,
    });

  const submitForm = async () => {
    if (!editing) return;
    if (!editing.name_en.trim()) return toast.error("Name (English) is required");
    const slug = editing.slug.trim() || slugify(editing.name_en);
    const payload = {
      slug,
      name_en: editing.name_en.trim(),
      name_kn: editing.name_kn.trim() || editing.name_en.trim(),
      category: editing.category,
      floor: Number.isFinite(editing.floor) ? editing.floor : 0,
      icon: editing.icon || "MapPin",
      description: editing.description?.trim() || null,
      hidden: !!editing.hidden,
      x: Math.min(100, Math.max(0, Number(editing.x))),
      y: Math.min(100, Math.max(0, Number(editing.y))),
    };
    setSaving(true);
    let res;
    if (editing.id) {
      res = await supabase.from("locations").update(payload).eq("id", editing.id);
    } else {
      res = await supabase.from("locations").insert(payload);
    }
    setSaving(false);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    toast.success(editing.id ? "Location updated" : "Location added");
    setEditing(null);
  };

  const removeLocation = async () => {
    if (!showDelete) return;
    const { error } = await supabase.from("locations").delete().eq("id", showDelete.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Deleted");
    setShowDelete(null);
  };

  const generateQR = async (loc: CampusLocation) => {
    setQrFor(loc);
    const url = `${window.location.origin}/?location=${encodeURIComponent(loc.slug)}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 512, margin: 1 });
    setQrDataUrl(dataUrl);
  };

  const downloadQR = () => {
    if (!qrDataUrl || !qrFor) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `qr-${qrFor.slug}.png`;
    a.click();
  };

  const exportCSV = () => {
    const csv = Papa.unparse(
      locations.map((l) => ({
        slug: l.slug,
        name_en: l.name.en,
        name_kn: l.name.kn,
        category: l.category,
        floor: l.floor,
        icon: l.icon,
        description: l.description ?? "",
        hidden: l.hidden ? "true" : "false",
        x: l.x,
        y: l.y,
      }))
    );
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "campusnav-locations.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data
          .map((r) => ({
            slug: (r.slug || slugify(r.name_en || "")).trim(),
            name_en: (r.name_en || "").trim(),
            name_kn: (r.name_kn || r.name_en || "").trim(),
            category: (CATEGORIES.includes((r.category || "facility") as Category)
              ? r.category
              : "facility") as Category,
            floor: Number(r.floor) || 0,
            icon: r.icon?.trim() || "MapPin",
            description: r.description?.trim() || null,
            hidden: String(r.hidden ?? "").trim().toLowerCase() === "true",
            x: Math.min(100, Math.max(0, Number(r.x) || 50)),
            y: Math.min(100, Math.max(0, Number(r.y) || 50)),
          }))
          .filter((r) => r.name_en && r.slug);

        if (rows.length === 0) {
          toast.error("No valid rows in CSV");
          return;
        }
        const { error } = await supabase
          .from("locations")
          .upsert(rows, { onConflict: "slug" });
        if (error) toast.error(error.message);
        else toast.success(`Imported ${rows.length} locations`);
      },
      error: (err) => toast.error(err.message),
    });
    e.target.value = "";
  };

  const autoDistance = useMemo(() => {
    if (!pathFrom || !pathTo || pathFrom === pathTo) return null;
    const a = locations.find((l) => l.id === pathFrom);
    const b = locations.find((l) => l.id === pathTo);
    if (!a || !b) return null;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return +(Math.sqrt(dx * dx + dy * dy) * 4).toFixed(1); // 1 unit ≈ 4m
  }, [pathFrom, pathTo, locations]);

  const useAutoDistance = () => {
    if (autoDistance != null) setPathDistance(String(autoDistance));
  };

  const fromLoc = locations.find((l) => l.id === pathFrom);
  const toLoc = locations.find((l) => l.id === pathTo);
  const sameFloor = fromLoc && toLoc ? (fromLoc.floor ?? 0) === (toLoc.floor ?? 0) : null;

  // When endpoints are picked, auto-fill floor (walk) or auto-flip to connector.
  useEffect(() => {
    if (!fromLoc || !toLoc) return;
    if ((fromLoc.floor ?? 0) === (toLoc.floor ?? 0)) {
      setPathType("walk");
      setPathFloor(fromLoc.floor ?? 0);
    } else {
      setPathType("connector");
      setPathFloor(fromLoc.floor ?? 0);
    }
  }, [fromLoc, toLoc]);

  const addPath = async () => {
    if (!pathFrom || !pathTo) return toast.error("Pick both endpoints");
    if (pathFrom === pathTo) return toast.error("Endpoints must differ");
    const distance = Number(pathDistance);
    if (!Number.isFinite(distance) || distance <= 0)
      return toast.error("Distance must be greater than 0 metres");
    if (distance > 2000)
      return toast.error("Distance looks too large (>2000 m). Double-check.");

    const fFloor = fromLoc?.floor ?? 0;
    const tFloor = toLoc?.floor ?? 0;
    if (pathType === "walk" && fFloor !== tFloor) {
      return toast.error(
        "Cannot connect locations across different floors directly. Use stairs/lift connectors."
      );
    }
    if (pathType === "connector" && fFloor === tFloor) {
      return toast.error("Connectors must link two different floors.");
    }

    // Duplicate check (same pair, same type)
    const dup = paths.find(
      (p) =>
        p.type === pathType &&
        ((p.source_id === pathFrom && p.destination_id === pathTo) ||
          (p.source_id === pathTo && p.destination_id === pathFrom))
    );
    if (dup) return toast.error("This path already exists.");

    const payload = {
      source_id: pathFrom,
      destination_id: pathTo,
      distance,
      type: pathType,
      floor: fFloor,
      to_floor: pathType === "connector" ? tFloor : null,
    };
    const { error } = await supabase.from("paths").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(pathType === "connector" ? "Connector added" : "Path added");
    setPathDistance("");
  };

  const removePath = async () => {
    if (!pathToDelete) return;
    const { error } = await supabase.from("paths").delete().eq("id", pathToDelete);
    if (error) toast.error(error.message);
    else toast.success("Path removed");
    setPathToDelete(null);
  };

  const connSourceLoc = locations.find((l) => l.id === connSource);
  const connTargetFloorNum = connTargetFloor === "" ? null : Number(connTargetFloor);
  const connFloorOptions = useMemo(() => {
    const floors = new Set<number>();
    locations.forEach((l) => floors.add(l.floor ?? 0));
    // Always offer 0..3 plus any existing
    [0, 1, 2, 3].forEach((f) => floors.add(f));
    return Array.from(floors).sort((a, b) => a - b);
  }, [locations]);
  const connTargetCandidates = useMemo(() => {
    if (!connSourceLoc || connTargetFloorNum == null) return [] as CampusLocation[];
    return locations.filter(
      (l) => l.id !== connSourceLoc.id && (l.floor ?? 0) === connTargetFloorNum
    );
  }, [locations, connSourceLoc, connTargetFloorNum]);

  const addConnectorQuick = async () => {
    if (!connSourceLoc) return toast.error("Pick a source location");
    if (connTargetFloorNum == null) return toast.error("Pick a target floor");
    if (connTargetFloorNum === (connSourceLoc.floor ?? 0))
      return toast.error("Target floor must differ from source floor");
    const distance = Number(connDistance);
    if (!Number.isFinite(distance) || distance <= 0)
      return toast.error("Distance must be greater than 0 metres");

    setConnCreating(true);
    try {
      let targetId = connTargetId;

      // Auto-create matching stairs node on target floor if none selected
      if (!targetId) {
        const baseSlug = `stairs-f${connTargetFloorNum}`;
        let slug = baseSlug;
        let i = 2;
        while (locations.some((l) => l.slug === slug)) {
          slug = `${baseSlug}-${i++}`;
        }
        const newLoc = {
          slug,
          name_en: `Stairs (F${connTargetFloorNum})`,
          name_kn: `ಮೆಟ್ಟಿಲು (F${connTargetFloorNum})`,
          category: "facility",
          floor: connTargetFloorNum,
          icon: "MoveVertical",
          x: connSourceLoc.x,
          y: connSourceLoc.y,
        };
        const { data, error } = await supabase
          .from("locations")
          .insert(newLoc)
          .select("id")
          .single();
        if (error) throw error;
        targetId = data.id;
      }

      const fFloor = connSourceLoc.floor ?? 0;
      const tFloor = connTargetFloorNum;

      // Check existing connector pair
      const exists = paths.find(
        (p) =>
          p.type === "connector" &&
          ((p.source_id === connSourceLoc.id && p.destination_id === targetId) ||
            (p.source_id === targetId && p.destination_id === connSourceLoc.id))
      );
      if (exists) {
        toast.error("A connector between these nodes already exists.");
        return;
      }

      // Insert both directions so routing works either way
      const { error: insErr } = await supabase.from("paths").insert([
        {
          source_id: connSourceLoc.id,
          destination_id: targetId,
          distance,
          type: "connector",
          floor: fFloor,
          to_floor: tFloor,
        },
        {
          source_id: targetId,
          destination_id: connSourceLoc.id,
          distance,
          type: "connector",
          floor: tFloor,
          to_floor: fFloor,
        },
      ]);
      if (insErr) throw insErr;

      toast.success(`Connector added: F${fFloor} ↔ F${tFloor}`);
      setConnTargetId("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add connector");
    } finally {
      setConnCreating(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="mx-auto min-h-dvh w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to map
        </Link>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <div className="mt-4">
        <h1 className="font-display text-3xl font-bold gradient-text">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Manage locations, paths, and generate campus QR codes.
        </p>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Locations", value: stats.total, icon: MapPin },
          { label: "QR codes", value: stats.qrLinks, icon: QrCode },
          { label: "Paths", value: stats.paths, icon: Network },
          { label: "Categories", value: stats.categories, icon: Plus },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-border bg-card p-4 shadow-soft"
          >
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <s.icon className="h-3.5 w-3.5" /> {s.label}
            </div>
            <div className="mt-1 font-display text-2xl font-bold">
              {loading ? <Skeleton className="h-7 w-12" /> : s.value}
            </div>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="inline-flex w-max">
            <TabsTrigger value="locations">Locations</TabsTrigger>
            <TabsTrigger value="paths">Paths</TabsTrigger>
            <TabsTrigger value="draw" className="gap-1.5">
              ✏️ Draw
            </TabsTrigger>
            <TabsTrigger value="editor" className="gap-1.5">
              <Move className="h-3.5 w-3.5" /> Map editor
            </TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="quick">Quick Access</TabsTrigger>
            <TabsTrigger value="map">Floor Maps</TabsTrigger>
            {isSuperAdmin && <TabsTrigger value="admins">Admins</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="locations" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={startNew} className="gap-1.5 bg-gradient-primary text-primary-foreground hover:opacity-90">
              <Plus className="h-4 w-4" /> Add location
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-1.5">
              <Upload className="h-4 w-4" /> Import CSV
            </Button>
            <Button variant="outline" onClick={exportCSV} className="gap-1.5" disabled={!locations.length}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onCSVUpload}
            />
            <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-soft">
              {showHiddenMarkers ? (
                <Eye className="h-3.5 w-3.5 text-primary" />
              ) : (
                <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <Label htmlFor="show-hidden" className="cursor-pointer text-xs font-medium">
                Show hidden markers
              </Label>
              <Switch id="show-hidden" checked={showHiddenMarkers} onCheckedChange={setShowHiddenMarkers} />
            </div>
          </div>

          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : locations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
              No locations yet. Add one or import a CSV with columns:
              <code className="ml-1 rounded bg-muted px-1 py-0.5 text-[11px]">
                slug,name_en,name_kn,category,floor,icon,description,x,y
              </code>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {locations
                .filter((loc) => showHiddenMarkers || !loc.hidden)
                .map((loc) => (
                <div
                  key={loc.id}
                  className="rounded-2xl border border-border bg-card p-4 shadow-soft"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-lg font-semibold truncate">
                        {loc.name.en}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {loc.name.kn}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-muted px-2 py-0.5 capitalize">
                          {loc.category}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5">
                          F{loc.floor}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5">
                          {loc.x.toFixed(1)}, {loc.y.toFixed(1)}
                        </span>
                        {loc.hidden && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 font-semibold text-accent-foreground">
                            <EyeOff className="h-3 w-3" /> Hidden on map
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => generateQR(loc)}
                        aria-label="QR code"
                      >
                        <QrCode className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleHidden(loc)}
                        aria-label={loc.hidden ? "Show marker on map" : "Hide marker from map"}
                        title={loc.hidden ? "Show marker on map" : "Hide marker from map (stays routable)"}
                      >
                        {loc.hidden ? (
                          <EyeOff className="h-4 w-4 text-accent-foreground" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => startEdit(loc)}
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowDelete(loc)}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="paths" className="mt-4 space-y-4">
          {/* Connector helper */}
          <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-semibold">Add connector (stairs / lift)</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                Helper
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Quickly link a stairs/lift node to another floor. Leave the target empty to auto-create a matching
              <strong> Stairs (F#)</strong> node at the same map position. Creates the connector in both directions.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <Select value={connSource} onValueChange={(v) => { setConnSource(v); setConnTargetId(""); }}>
                <SelectTrigger><SelectValue placeholder="Source node" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name.en} <span className="ml-1 text-xs text-muted-foreground">F{l.floor}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={connTargetFloor}
                onValueChange={(v) => { setConnTargetFloor(v); setConnTargetId(""); }}
              >
                <SelectTrigger><SelectValue placeholder="Target floor" /></SelectTrigger>
                <SelectContent>
                  {connFloorOptions
                    .filter((f) => !connSourceLoc || f !== (connSourceLoc.floor ?? 0))
                    .map((f) => (
                      <SelectItem key={f} value={String(f)}>
                        Floor {f}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>

              <Select
                value={connTargetId || "__auto__"}
                onValueChange={(v) => setConnTargetId(v === "__auto__" ? "" : v)}
                disabled={connTargetFloorNum == null || !connSourceLoc}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Target node (auto-create)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">
                    ➕ Auto-create Stairs (F{connTargetFloorNum ?? "?"})
                  </SelectItem>
                  {connTargetCandidates.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name.en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  step="0.5"
                  placeholder="Distance (m)"
                  value={connDistance}
                  onChange={(e) => setConnDistance(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={addConnectorQuick}
                  disabled={connCreating}
                  className="flex-1 bg-gradient-primary text-primary-foreground hover:opacity-90"
                >
                  {connCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </Button>
              </div>
            </div>

            {connSourceLoc && connTargetFloorNum != null && (
              <p className="mt-2 text-xs text-muted-foreground">
                F{connSourceLoc.floor} ↔ F{connTargetFloorNum} —{" "}
                {connTargetId
                  ? `links to ${locations.find((l) => l.id === connTargetId)?.name.en}`
                  : `will create a new node at (${connSourceLoc.x.toFixed(1)}, ${connSourceLoc.y.toFixed(1)})`}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h3 className="font-display text-base font-semibold">Add a path</h3>
            <p className="text-xs text-muted-foreground">
              Paths form the navigation graph used by Dijkstra's shortest-path algorithm.
              Walk paths must stay on a single floor; use a <strong>connector</strong> for stairs/lifts between floors.
            </p>

            {/* Type toggle */}
            <div className="mt-3 inline-flex rounded-full border border-border bg-muted/40 p-1 text-xs">
              <button
                type="button"
                onClick={() => setPathType("walk")}
                className={`rounded-full px-3 py-1 font-semibold ${pathType === "walk" ? "bg-gradient-primary text-primary-foreground shadow-soft" : "text-muted-foreground"}`}
              >
                Walk path
              </button>
              <button
                type="button"
                onClick={() => setPathType("connector")}
                className={`rounded-full px-3 py-1 font-semibold ${pathType === "connector" ? "bg-gradient-primary text-primary-foreground shadow-soft" : "text-muted-foreground"}`}
              >
                Stairs / Lift
              </button>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <Select value={pathFrom} onValueChange={setPathFrom}>
                <SelectTrigger><SelectValue placeholder="From" /></SelectTrigger>
                <SelectContent>
                  {locations
                    .filter((l) =>
                      pathType === "walk" && !pathFrom && !pathTo
                        ? (l.floor ?? 0) === pathFloor
                        : true
                    )
                    .map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name.en} <span className="ml-1 text-xs text-muted-foreground">F{l.floor}</span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Select value={pathTo} onValueChange={setPathTo}>
                <SelectTrigger><SelectValue placeholder="To" /></SelectTrigger>
                <SelectContent>
                  {locations
                    .filter((l) => {
                      if (pathFrom === l.id) return false;
                      if (!fromLoc) return true;
                      return pathType === "walk"
                        ? (l.floor ?? 0) === (fromLoc.floor ?? 0)
                        : (l.floor ?? 0) !== (fromLoc.floor ?? 0);
                    })
                    .map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name.en} <span className="ml-1 text-xs text-muted-foreground">F{l.floor}</span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                step="0.1"
                placeholder={
                  autoDistance != null ? `Distance (m) — auto: ${autoDistance}` : "Distance (m)"
                }
                value={pathDistance}
                onChange={(e) => setPathDistance(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={useAutoDistance}
                  disabled={autoDistance == null}
                  title="Use computed distance from coordinates"
                  className="flex-1"
                >
                  Auto
                </Button>
                <Button onClick={addPath} className="flex-1 bg-gradient-primary text-primary-foreground hover:opacity-90">
                  Add
                </Button>
              </div>
            </div>

            {fromLoc && toLoc && (
              <div className="mt-2 text-xs">
                {pathType === "walk" && sameFloor === false && (
                  <span className="text-destructive">
                    ⚠ Endpoints sit on different floors — use a connector instead.
                  </span>
                )}
                {pathType === "connector" && sameFloor === true && (
                  <span className="text-destructive">
                    ⚠ Connectors must link two different floors.
                  </span>
                )}
                {pathType === "walk" && sameFloor && (
                  <span className="text-muted-foreground">
                    Floor: <strong>F{fromLoc.floor}</strong> (auto)
                  </span>
                )}
                {pathType === "connector" && sameFloor === false && fromLoc && toLoc && (
                  <span className="text-muted-foreground">
                    Connector: F{fromLoc.floor} ↔ F{toLoc.floor}
                  </span>
                )}
              </div>
            )}
          </div>

          {paths.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              No paths yet. Without paths, the navigator falls back to a same-floor Euclidean graph.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">From</th>
                    <th className="px-4 py-2">To</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Floor</th>
                    <th className="px-4 py-2">Distance</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {paths.map((p) => {
                    const a = locations.find((l) => l.id === p.source_id);
                    const b = locations.find((l) => l.id === p.destination_id);
                    const isConnector = p.type === "connector";
                    return (
                      <tr key={p.id} className="border-t border-border">
                        <td className="px-4 py-2">{a?.name.en ?? "—"}</td>
                        <td className="px-4 py-2">{b?.name.en ?? "—"}</td>
                        <td className="px-4 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${isConnector ? "bg-accent/15 text-accent-foreground" : "bg-primary/10 text-primary"}`}>
                            {isConnector ? "Stairs/Lift" : "Walk"}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">
                          {isConnector ? (
                            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold">
                              Multi-floor (F{p.floor} ↔ F{p.to_floor})
                            </span>
                          ) : (
                            `F${p.floor}`
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={0.1}
                              step="0.1"
                              value={distanceEdits[p.id] ?? String(p.distance)}
                              onChange={(e) =>
                                setDistanceEdits((d) => ({ ...d, [p.id]: e.target.value }))
                              }
                              className="h-8 w-24"
                              aria-label="Path distance in metres"
                            />
                            <span className="text-xs text-muted-foreground">m</span>
                            {distanceEdits[p.id] != null &&
                              distanceEdits[p.id] !== String(p.distance) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => saveDistance(p.id)}
                                  disabled={savingDistance === p.id}
                                  aria-label="Save distance"
                                >
                                  {savingDistance === p.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Check className="h-4 w-4 text-primary" />
                                  )}
                                </Button>
                              )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setPathToDelete(p.id)}
                            aria-label="Delete path"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="draw" className="mt-4">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h3 className="font-display text-base font-semibold">Manual path drawing</h3>
            <p className="text-xs text-muted-foreground">
              Click a marker to start drawing. Click on the map to add waypoints exactly where the path should turn.
              Click a destination marker to finish, then save. Drag any waypoint to reshape, or click a saved path to edit/delete it.
            </p>
            <div className="mt-4">
              {loading ? (
                <Skeleton className="aspect-[3/2] w-full rounded-2xl" />
              ) : locations.length < 2 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
                  Add at least two locations before drawing paths.
                </div>
              ) : (
                <PathDrawEditor mapSrc={campusMap} floorMaps={floorMapSrcs} locations={locations} paths={paths} />
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="editor" className="mt-4">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h3 className="font-display text-base font-semibold">Visual map editor</h3>
            <p className="text-xs text-muted-foreground">
              Drag any waypoint on the campus map. Coordinates update in real time and
              are saved to the database when you click <strong>Save changes</strong>.
            </p>
            <div className="mt-4">
              {loading ? (
                <Skeleton className="aspect-[3/2] w-full rounded-2xl" />
              ) : locations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
                  Add at least one location before using the editor.
                </div>
              ) : (
                <MapPathEditor mapSrc={campusMap} floorMaps={floorMapSrcs} locations={locations} paths={paths} />
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="quick" className="mt-4">
          <AdminQuickAccess locations={locations} canEdit={isSuperAdmin} />
        </TabsContent>

        <TabsContent value="map" className="mt-4">
          <AdminMapManager canEdit floors={Array.from(new Set(locations.map((l) => l.floor ?? 0)))} />
        </TabsContent>

        <TabsContent value="voice" className="mt-4">
          <AdminVoiceSettings />
        </TabsContent>

        {isSuperAdmin && (
          <TabsContent value="admins" className="mt-4">
            <AdminUsers />
          </TabsContent>
        )}
      </Tabs>

      {/* Add / Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit location" : "Add location"}</DialogTitle>
            <DialogDescription>
              Coordinates are 0–100 percent of the campus map image.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Name (English)</Label>
                  <Input
                    value={editing.name_en}
                    onChange={(e) =>
                      setEditing({ ...editing, name_en: e.target.value, slug: editing.slug || slugify(e.target.value) })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Name (Kannada)</Label>
                  <Input
                    value={editing.name_kn}
                    onChange={(e) => setEditing({ ...editing, name_kn: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Slug (URL)</Label>
                  <Input
                    value={editing.slug}
                    onChange={(e) => setEditing({ ...editing, slug: slugify(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select
                    value={editing.category}
                    onValueChange={(v) => setEditing({ ...editing, category: v as Category })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Floor</Label>
                  <Input
                    type="number"
                    value={editing.floor}
                    onChange={(e) => setEditing({ ...editing, floor: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Icon (lucide)</Label>
                  <Input
                    value={editing.icon}
                    onChange={(e) => setEditing({ ...editing, icon: e.target.value })}
                    placeholder="MapPin"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>X (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={editing.x}
                    onChange={(e) => setEditing({ ...editing, x: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Y (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={editing.y}
                    onChange={(e) => setEditing({ ...editing, y: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-3 py-2">
                <div>
                  <Label htmlFor="edit-hidden" className="cursor-pointer">Hide from maps</Label>
                  <p className="text-xs text-muted-foreground">
                    Marker won't be drawn for users or admins, but stays usable for routing and floor changes.
                  </p>
                </div>
                <Switch
                  id="edit-hidden"
                  checked={editing.hidden}
                  onCheckedChange={(v) => setEditing({ ...editing, hidden: v })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              onClick={submitForm}
              disabled={saving}
              className="bg-gradient-primary text-primary-foreground hover:opacity-90"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!showDelete} onOpenChange={(o) => !o && setShowDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{showDelete?.name.en}"?</DialogTitle>
            <DialogDescription>
              This also removes any paths that connect to this location. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={removeLocation}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete path confirm */}
      <Dialog open={!!pathToDelete} onOpenChange={(o) => !o && setPathToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this path?</DialogTitle>
            <DialogDescription>
              This removes the edge from the navigation graph. Routes using it will be recomputed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPathToDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={removePath}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR dialog */}
      <Dialog open={!!qrFor} onOpenChange={(o) => !o && (setQrFor(null), setQrDataUrl(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>QR for {qrFor?.name.en}</DialogTitle>
            <DialogDescription className="break-all">
              {qrFor && `${window.location.origin}/?location=${qrFor.slug}`}
            </DialogDescription>
          </DialogHeader>
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR code for ${qrFor?.name.en}`}
              className="mx-auto h-64 w-64 rounded-xl border border-border bg-white p-2"
            />
          ) : (
            <Skeleton className="mx-auto h-64 w-64" />
          )}
          <DialogFooter>
            <Button onClick={downloadQR} disabled={!qrDataUrl} className="gap-1.5">
              <Download className="h-4 w-4" /> Download PNG
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Admin() {
  return (
    <ProtectedRoute>
      <AdminInner />
    </ProtectedRoute>
  );
}
