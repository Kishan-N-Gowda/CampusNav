import React from "react";
import { Navigation, Layers, Compass, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCampusDistance } from "@/lib/geo";

export type NavMode = "campus" | "outdoor";

interface NavigationModeBarProps {
  mode: NavMode;
  onModeChange: (mode: NavMode) => void;
  offCampus: boolean;
  distanceToCampusM: number | null;
  roadDistanceMeters?: number | null;
  lang: "en" | "kn";
}

export const NavigationModeBar: React.FC<NavigationModeBarProps> = ({
  mode,
  onModeChange,
  offCampus,
  distanceToCampusM,
  roadDistanceMeters,
  lang,
}) => {
  const effectiveDistance = roadDistanceMeters ?? distanceToCampusM;
  const formattedDistance = effectiveDistance != null ? formatCampusDistance(effectiveDistance, lang) : null;

  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 rounded-2xl bg-card p-2 border border-border/80 shadow-soft">
      {/* Mode Status Pill */}
      <div className="flex items-center gap-2 px-2">
        <Badge
          variant={offCampus ? "outline" : "default"}
          className={`gap-1.5 font-bold text-xs py-1.5 px-3 rounded-xl transition-all ${
            offCampus
              ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "bg-emerald-600 text-white dark:bg-emerald-600/90"
          }`}
        >
          {offCampus ? (
            <>
              <Compass className="h-3.5 w-3.5 animate-spin-slow" />
              {lang === "kn" ? "ಕ್ಯಾಂಪಸ್ ಹೊರಗೆ" : "Outdoor Mode"}
              {formattedDistance && ` • ${formattedDistance}`}
            </>
          ) : (
            <>
              <MapPin className="h-3.5 w-3.5" />
              {lang === "kn" ? "ಕ್ಯಾಂಪಸ್ ಒಳಗೆ" : "Campus Navigation Active"}
            </>
          )}
        </Badge>
        <span className="text-xs text-muted-foreground hidden md:inline">
          {offCampus
            ? lang === "kn"
              ? "ಕ್ಯಾಂಪಸ್ ತಲುಪಲು ಗೂಗಲ್ ಮ್ಯಾಪ್ಸ್ ಬಳಸಿ"
              : "Use Google Maps to reach campus"
            : lang === "kn"
              ? "10 ಜಿಪಿಎಸ್ ಆಂಕರ್‌ಗಳಿಂದ ನಿಖರ ಸ್ಥಳ"
              : "Calibrated with 10 GPS anchors"}
        </span>
      </div>

      {/* Segmented Switcher */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/80 p-1 border border-border/50">
        <Button
          size="sm"
          variant={mode === "campus" ? "default" : "ghost"}
          onClick={() => onModeChange("campus")}
          className={`h-8 gap-1.5 rounded-lg text-xs font-semibold transition-all ${
            mode === "campus"
              ? "bg-background text-foreground shadow-xs font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Layers className="h-3.5 w-3.5 text-primary" />
          {lang === "kn" ? "ಕ್ಯಾಂಪಸ್ ಮ್ಯಾಪ್" : "Campus Map"}
        </Button>

        <Button
          size="sm"
          variant={mode === "outdoor" ? "default" : "ghost"}
          onClick={() => onModeChange("outdoor")}
          className={`h-8 gap-1.5 rounded-lg text-xs font-semibold transition-all ${
            mode === "outdoor"
              ? "bg-background text-foreground shadow-xs font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Navigation className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          {lang === "kn" ? "ಗೂಗಲ್ ಮ್ಯಾಪ್ಸ್" : "Google Maps"}
        </Button>
      </div>
    </div>
  );
};
