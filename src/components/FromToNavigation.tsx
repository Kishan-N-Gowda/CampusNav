import { useState, useRef, useEffect } from "react";
import {
  Navigation,
  MapPin,
  Search,
  Mic,
  ArrowLeftRight,
  Crosshair,
  QrCode,
  Check,
  X,
} from "lucide-react";
import type { CampusLocation, Language } from "@/data/locations";
import { getLocationName } from "@/data/locations";
import { cn } from "@/lib/utils";
import { createRecognizer } from "@/lib/speech";
import { tr } from "@/lib/i18n";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  locations: CampusLocation[];
  lang: Language;
  fromId: string | undefined;
  destId: string | undefined;
  isLiveMode: boolean;
  liveLocationName?: string | null;
  scannedLocationName?: string | null;
  gpsEnabled: boolean;
  onSelectFrom: (locationId: string | "live") => void;
  onSelectDest: (locationId: string) => void;
  onSwap: () => void;
  onEnableGps?: () => void;
  onOpenScanner?: () => void;
}

export function FromToNavigation({
  locations,
  lang,
  fromId,
  destId,
  isLiveMode,
  liveLocationName,
  scannedLocationName,
  gpsEnabled,
  onSelectFrom,
  onSelectDest,
  onSwap,
  onEnableGps,
  onOpenScanner,
}: Props) {
  const [activeField, setActiveField] = useState<"from" | "to" | null>(null);
  const [editableField, setEditableField] = useState<"from" | "to" | null>(null);
  const [query, setQuery] = useState("");
  const [listeningField, setListeningField] = useState<"from" | "to" | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);

  const safeLocations = Array.isArray(locations) ? locations : [];

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActiveField(null);
        setEditableField(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleFieldClick = (field: "from" | "to") => {
    if (activeField !== field) {
      // First click: open dropdown, keep virtual keyboard hidden
      setActiveField(field);
      setEditableField(null);
      setQuery("");
    } else {
      // Second click: enable text input and pop up keyboard
      setEditableField(field);
      if (field === "from") fromInputRef.current?.focus();
      if (field === "to") toInputRef.current?.focus();
    }
  };

  const selectedFrom = safeLocations.find((l) => l && l.id === fromId);
  const selectedTo = safeLocations.find((l) => l && l.id === destId);

  // Search filtering
  const q = query.trim().toLowerCase();
  const selectableLocations = safeLocations.filter((l) => l && !l.hidden);
  const filteredLocations = q
    ? selectableLocations.filter(
        (l) =>
          getLocationName(l, lang).toLowerCase().includes(q) ||
          getLocationName(l, "en").toLowerCase().includes(q) ||
          (l.slug && l.slug.toLowerCase().includes(q)) ||
          (l.category && l.category.toLowerCase().includes(q))
      )
    : selectableLocations;

  // Voice recognition logic
  const handleVoiceMatch = (text: string, targetField: "from" | "to") => {
    const lc = text.toLowerCase().trim();
    const cleaned = lc
      .replace(
        /^(please\s+)?(take me to|take me|go to|navigate to|navigate|directions to|show me|find|search for|where is|from|to|start at)\s+/i,
        ""
      )
      .trim();

    if (!cleaned) {
      toast.message("Didn't catch that — please try again.");
      return;
    }

    // Check if user said "my location" or "live location" for starting point
    if (
      targetField === "from" &&
      (cleaned.includes("live") ||
        cleaned.includes("my location") ||
        cleaned.includes("current location") ||
        cleaned.includes("here"))
    ) {
      onSelectFrom("live");
      setQuery("");
      setActiveField(null);
      toast.success("Set starting point to Live Location");
      return;
    }

    // Score location
    let best: { l: CampusLocation; s: number } | null = null;
    for (const l of selectableLocations) {
      const en = getLocationName(l, "en").toLowerCase();
      const kn = getLocationName(l, "kn").toLowerCase();
      let score = 0;
      if (en === cleaned || kn === cleaned) score = 100;
      else if (en.includes(cleaned) || kn.includes(cleaned)) score = 80;
      else if (cleaned.includes(en)) score = 70;
      if (score > 0 && (!best || score > best.s)) best = { l, s: score };
    }

    if (best) {
      if (targetField === "from") onSelectFrom(best.l.id);
      else onSelectDest(best.l.id);
      setQuery("");
      setActiveField(null);
      toast.success(`Set ${targetField === "from" ? "start" : "destination"}: ${getLocationName(best.l, lang)}`);
    } else {
      setQuery(cleaned);
      setActiveField(targetField);
      toast.message(`Searching: "${cleaned}"`);
    }
  };

  const startVoice = (targetField: "from" | "to") => {
    const rec = createRecognizer(
      lang,
      (text) => {
        setListeningField(null);
        handleVoiceMatch(text, targetField);
      },
      (err) => {
        setListeningField(null);
        toast.error(err);
      },
      () => setListeningField(null)
    );

    if (!rec.supported) {
      toast.error("Voice recognition not supported on this browser.");
      return;
    }

    setListeningField(targetField);
    rec.start();
  };

  // Field text representations
  const getFromDisplayValue = () => {
    if (locations.length === 0) return "Campus Navigation is temporarily unavailable";
    if (activeField === "from") return query;
    if (isLiveMode) {
      return liveLocationName
        ? `${tr("liveLocationLabel", lang)} (${liveLocationName})`
        : tr("useLiveLocation", lang);
    }
    if (scannedLocationName && !selectedFrom) {
      return `Scanned: ${scannedLocationName}`;
    }
    return selectedFrom ? getLocationName(selectedFrom, lang) : tr("chooseStart", lang);
  };

  const getToDisplayValue = () => {
    if (locations.length === 0) return "Campus Navigation is temporarily unavailable";
    if (activeField === "to") return query;
    return selectedTo ? getLocationName(selectedTo, lang) : "";
  };

  return (
    <div
      ref={containerRef}
      className="relative rounded-3xl border border-border bg-card p-4 sm:p-5 shadow-card w-full max-w-full min-w-0 overflow-hidden"
    >
      {/* Header Bar */}
      <div className="mb-3 flex items-center justify-between gap-2 px-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground shadow-soft shrink-0">
            <Navigation className="h-4 w-4" />
          </div>
          <span className="font-display text-sm font-bold tracking-tight text-foreground truncate">
            {lang === "kn" ? "ಮಾರ್ಗ ಸಂಚರಣೆ" : "Route Directions"}
          </span>
        </div>

        {/* Quick status pill */}
        {isLiveMode ? (
          <Badge
            variant="secondary"
            className="gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            {tr("useGPS", lang)}
          </Badge>
        ) : scannedLocationName ? (
          <Badge
            variant="secondary"
            className="gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary shrink-0"
          >
            <QrCode className="h-3 w-3" />
            QR Location
          </Badge>
        ) : null}
      </div>

      {/* From-To Input Panel */}
      <div className="relative flex items-center gap-2 sm:gap-3 w-full max-w-full min-w-0">
        {/* Visual Connector Line (From dot -> To dot) */}
        <div className="flex flex-col items-center py-2 shrink-0">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/30" />
          </div>
          <div className="my-1.5 h-7 w-0.5 border-r-2 border-dashed border-primary/40" />
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary">
            <MapPin className="h-3.5 w-3.5 fill-primary" />
          </div>
        </div>

        {/* Stack of Inputs */}
        <div className="flex-1 space-y-2.5 min-w-0">
          {/* FROM FIELD */}
          <div className="relative">
            <input
              ref={fromInputRef}
              type="text"
              readOnly={editableField !== "from"}
              inputMode={editableField === "from" ? "text" : "none"}
              value={getFromDisplayValue()}
              placeholder={tr("chooseStart", lang)}
              onClick={() => handleFieldClick("from")}
              onChange={(e) => {
                setActiveField("from");
                setEditableField("from");
                setQuery(e.target.value);
              }}
              className={cn(
                "w-full rounded-2xl border bg-background py-2.5 pl-3.5 pr-10 text-sm font-medium transition-all cursor-pointer",
                activeField === "from"
                  ? "border-primary ring-2 ring-primary/20 shadow-soft"
                  : isLiveMode
                  ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-900 dark:text-emerald-200"
                  : "border-border text-foreground hover:border-border/80"
              )}
            />
            {activeField === "from" && query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => startVoice("from")}
                aria-label="Voice input for starting point"
                className={cn(
                  "absolute right-2.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-primary transition-colors",
                  listeningField === "from" && "bg-destructive text-destructive-foreground animate-pulse"
                )}
              >
                <Mic className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* TO FIELD */}
          <div className="relative">
            <input
              ref={toInputRef}
              type="text"
              readOnly={editableField !== "to"}
              inputMode={editableField === "to" ? "text" : "none"}
              value={getToDisplayValue()}
              placeholder={tr("chooseDestination", lang)}
              onClick={() => handleFieldClick("to")}
              onChange={(e) => {
                setActiveField("to");
                setEditableField("to");
                setQuery(e.target.value);
              }}
              className={cn(
                "w-full rounded-2xl border bg-background py-2.5 pl-3.5 pr-10 text-sm font-medium transition-all cursor-pointer",
                activeField === "to"
                  ? "border-primary ring-2 ring-primary/20 shadow-soft"
                  : selectedTo
                  ? "border-primary/40 text-foreground"
                  : "border-border text-foreground hover:border-border/80"
              )}
            />
            {activeField === "to" && query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => startVoice("to")}
                aria-label="Voice input for destination"
                className={cn(
                  "absolute right-2.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-primary transition-colors",
                  listeningField === "to" && "bg-destructive text-destructive-foreground animate-pulse"
                )}
              >
                <Mic className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Actions Cluster (Swap & Scan QR) */}
        <div className="flex flex-col gap-1.5 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => {
              onSwap();
              setActiveField(null);
            }}
            className="h-9 w-9 rounded-xl border-border bg-background shadow-soft hover:bg-muted transition-all active:scale-95"
            title={tr("swapFromTo", lang)}
            aria-label={tr("swapFromTo", lang)}
          >
            <ArrowLeftRight className="h-4 w-4 text-primary" />
          </Button>

          {onOpenScanner && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                setActiveField(null);
                onOpenScanner();
              }}
              className="h-9 w-9 rounded-xl border-primary/40 bg-primary/5 text-primary shadow-soft hover:bg-primary/15 transition-all active:scale-95"
              title={lang === "kn" ? "ಕ್ಯೂಆರ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ" : "Scan Campus QR"}
              aria-label="Scan Campus QR"
            >
              <QrCode className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* DROPDOWN MENU FOR SELECTING LOCATIONS */}
      {activeField !== null && (
        <div className="absolute left-0 right-0 z-40 mt-3 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-float-in">
          <div className="border-b border-border/50 bg-muted/40 px-4 py-2 flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>
              {activeField === "from"
                ? tr("startingPoint", lang)
                : tr("destination", lang)}
            </span>
            <span>{filteredLocations.length} locations</span>
          </div>

          <ul className="max-h-64 overflow-y-auto divide-y divide-border/30">
            {/* Quick Option: Scan Campus QR Tag */}
            {onOpenScanner && (
              <li>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setActiveField(null);
                    onOpenScanner();
                  }}
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-primary/10 bg-primary/5 border-b border-primary/10"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft">
                      <QrCode className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                        {lang === "kn" ? "ಕ್ಯಾಂಪಸ್ ಕ್ಯೂಆರ್ ಟ್ಯಾಗ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ" : "Scan Campus QR Tag"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {activeField === "from"
                          ? lang === "kn" ? "ಪ್ರಾರಂಭಿಸಲು ಬೋರ್ಡ್ ಅಥವಾ ಕೋಣೆಯ ಕ್ಯೂಆರ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ" : "Scan plaque at your current spot to set start"
                          : lang === "kn" ? "ಗಮ್ಯಸ್ಥಾನವನ್ನು ಹೊಂದಿಸಲು ಕ್ಯೂಆರ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ" : "Scan destination tag or brochure QR"}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
                    Camera
                  </Badge>
                </button>
              </li>
            )}

            {/* Special Top Option for "FROM" field: USE LIVE LOCATION */}
            {activeField === "from" && (
              <li>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelectFrom("live");
                    if (onEnableGps && !gpsEnabled) onEnableGps();
                    setActiveField(null);
                    setQuery("");
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-emerald-500/10",
                    isLiveMode && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-soft">
                      <Crosshair className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                        {tr("useLiveLocation", lang)}
                        {isLiveMode && <Check className="h-4 w-4 text-emerald-600" />}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {liveLocationName
                          ? `Currently at: ${liveLocationName}`
                          : "Uses device GPS or nearest campus beacon"}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 text-[10px]">
                    GPS
                  </Badge>
                </button>
              </li>
            )}

            {/* Empty Search Result State */}
            {filteredLocations.length === 0 && (
              <li className="p-6 text-center text-sm text-muted-foreground">
                <Search className="mx-auto mb-2 h-6 w-6 text-muted-foreground/60" />
                {locations.length === 0
                  ? "Campus Navigation is temporarily unavailable."
                  : "No matching campus locations found."}
              </li>
            )}

            {/* List of Campus Locations */}
            {filteredLocations.map((loc) => {
              const isSelected =
                activeField === "from"
                  ? !isLiveMode && loc.id === fromId
                  : loc.id === destId;

              const locName = getLocationName(loc, lang);

              return (
                <li key={loc.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (activeField === "from") onSelectFrom(loc.id);
                      else onSelectDest(loc.id);
                      setActiveField(null);
                      setQuery("");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/70",
                      isSelected && "bg-primary/10 text-primary font-semibold"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-xl text-primary-foreground shadow-soft",
                          activeField === "from"
                            ? "bg-emerald-600"
                            : "bg-gradient-primary"
                        )}
                      >
                        <MapPin className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="text-sm font-semibold leading-tight text-foreground">
                          {locName}
                        </div>
                        {lang === "en" && loc.name && loc.name.kn && (
                          <div className="text-[11px] text-muted-foreground">
                            {loc.name.kn}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        Floor {loc.floor ?? 0}
                      </span>
                      {isSelected && <Check className="h-4 w-4 text-primary" />}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
