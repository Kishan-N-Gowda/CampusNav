import * as Icons from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { floorLabel } from "@/components/FloorSelector";
import type { CampusLocation, Language } from "@/data/locations";

interface Props {
  location: CampusLocation | null;
  lang: Language;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigateHere?: (loc: CampusLocation) => void;
  onSetAsStart?: (loc: CampusLocation) => void;
  onNavigate?: (id: string) => void;
  onSetStart?: (id: string) => void;
}

const CATEGORY_NAMES: Record<string, { en: string; kn: string; emoji: string }> = {
  academic: { en: "Academic & Research", kn: "ಶೈಕ್ಷಣಿಕ ಮತ್ತು ಸಂಶೋಧನೆ", emoji: "🎓" },
  admin: { en: "Administrative Office", kn: "ಆಡಳಿತ ಕಚೇರಿ", emoji: "🏢" },
  facility: { en: "Campus Facility", kn: "ಕ್ಯಾಂಪಸ್ ಸೌಲಭ್ಯ", emoji: "🏛️" },
  entrance: { en: "Entrance & Reception", kn: "ಪ್ರವೇಶ ದ್ವಾರ", emoji: "🚪" },
  hostel: { en: "Hostel & Residence", kn: "ವಸತಿ ನಿಲಯ", emoji: "🏠" },
  library: { en: "Library & Study Zone", kn: "ಗ್ರಂಥಾಲಯ", emoji: "📚" },
  canteen: { en: "Food Court & Canteen", kn: "ಉಪಹಾರ ಗೃಹ", emoji: "🍽️" },
  sports: { en: "Sports & Fitness", kn: "ಕ್ರೀಡಾ ಸಂಕೀರ್ಣ", emoji: "🏃" },
  auditorium: { en: "Auditorium & Events", kn: "ಸಭಾಂಗಣ", emoji: "🎭" },
};

export function LocationDetailModal({
  location,
  lang,
  open,
  onOpenChange,
  onNavigateHere,
  onSetAsStart,
  onNavigate,
  onSetStart,
}: Props) {
  if (!location) return null;

  const IconComponent =
    (Icons as unknown as Record<string, Icons.LucideIcon>)[location.icon] ?? Icons.MapPin;

  const catMeta = CATEGORY_NAMES[location.category] ?? {
    en: location.category,
    kn: location.category,
    emoji: "📍",
  };

  const defaultDesc =
    lang === "kn"
      ? `${location.name.kn} (${floorLabel(location.floor)}) ಕ್ಯಾಂಪಸ್‌ನಲ್ಲಿದೆ. ಪ್ರವೇಶ ಮತ್ತು ಸೌಲಭ್ಯಗಳ ಮಾಹಿತಿಗಾಗಿ ಇಲ್ಲಿಗೆ ತಲುಪಬಹುದು.`
      : `${location.name.en} is located on ${floorLabel(
          location.floor
        )} of the campus block. Open for students, staff, parents, and visitors.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-6 shadow-2xl border border-border">
        <DialogHeader className="text-left space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-soft">
              <IconComponent className="h-6 w-6" />
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs font-semibold">
                {catMeta.emoji} {catMeta[lang]}
              </Badge>
              <Badge variant="outline" className="rounded-full border-primary/40 bg-primary/10 text-primary px-3 py-1 text-xs font-bold">
                {floorLabel(location.floor)}
              </Badge>
            </div>
          </div>

          <div>
            <DialogTitle className="font-display text-xl font-bold leading-tight text-foreground">
              {location.name[lang]}
            </DialogTitle>
            {lang === "en" && location.name.kn && (
              <p className="mt-0.5 text-xs text-muted-foreground font-medium">
                {location.name.kn}
              </p>
            )}
          </div>

          <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
            {location.description || defaultDesc}
          </DialogDescription>
        </DialogHeader>

        {/* Useful Parent / Visitor Highlights */}
        <div className="my-2 rounded-2xl bg-muted/50 p-3 text-xs space-y-2 border border-border/50">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium">
              <Icons.Layers className="h-3.5 w-3.5 text-primary" />
              {lang === "kn" ? "ಮಹಡಿ:" : "Floor:"}
            </span>
            <span className="font-bold text-foreground">{floorLabel(location.floor)}</span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium">
              <Icons.Footprints className="h-3.5 w-3.5 text-primary" />
              {lang === "kn" ? "ಪ್ರವೇಶ ಸಾಧ್ಯತೆ:" : "Accessibility:"}
            </span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {lang === "kn" ? "ಸಾರ್ವಜನಿಕ ಪ್ರವೇಶ" : "Visitor Accessible"}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <Button
            type="button"
            onClick={() => {
              if (onNavigateHere) onNavigateHere(location);
              else if (onNavigate) onNavigate(location.id);
              onOpenChange(false);
            }}
            className="flex-1 gap-2 rounded-2xl bg-gradient-primary text-primary-foreground font-semibold shadow-soft hover:opacity-95"
          >
            <Icons.Navigation className="h-4 w-4" />
            {lang === "kn" ? "ಇಲ್ಲಿಗೆ ದಾರಿ ತೋರಿಸಿ" : "Get Directions"}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (onSetAsStart) onSetAsStart(location);
              else if (onSetStart) onSetStart(location.id);
              onOpenChange(false);
            }}
            className="rounded-2xl border-border gap-1.5 font-medium text-xs sm:text-sm"
          >
            <Icons.MapPin className="h-4 w-4 text-primary" />
            {lang === "kn" ? "ಪ್ರಾರಂಭದ ಸ್ಥಳ" : "Set as Start"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
