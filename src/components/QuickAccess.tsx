import * as Icons from "lucide-react";
import type { CampusLocation, Language } from "@/data/locations";
import { getLocationName } from "@/data/locations";
import { cn } from "@/lib/utils";

interface Props {
  locations: CampusLocation[];
  lang: Language;
  onPick: (id: string) => void;
  config?: { count: number; location_ids: string[] };
}

const gradients = [
  "from-primary to-accent",
  "from-secondary to-accent",
  "from-accent to-primary",
  "from-primary to-secondary",
];

export function QuickAccess({ locations = [], lang, onPick, config }: Props) {
  const safeLocations = Array.isArray(locations) ? locations.filter(Boolean) : [];
  const limit = Math.max(1, config?.count ?? 4);
  const picks: CampusLocation[] = [];

  const configured = (config?.location_ids ?? [])
    .map((id) => safeLocations.find((l) => l.id === id))
    .filter((l): l is CampusLocation => !!l);

  if (configured.length > 0) {
    picks.push(...configured.slice(0, limit));
  } else {
    // Fallback: pick representative locations across categories
    const visibleLocations = safeLocations.filter((l) => !l.hidden);
    const seen = new Set<string>();
    for (const l of visibleLocations) {
      if (l.category === "entrance") continue;
      if (seen.has(l.category)) continue;
      seen.add(l.category);
      picks.push(l);
      if (picks.length >= limit) break;
    }
    while (picks.length < Math.min(limit, visibleLocations.length)) {
      const fallback = visibleLocations.find((l) => !picks.includes(l) && l.category !== "entrance");
      if (!fallback) break;
      picks.push(fallback);
    }
  }

  if (picks.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {picks.map((loc, i) => {
        const Icon =
          (Icons as unknown as Record<string, Icons.LucideIcon>)[loc.icon] ?? Icons.MapPin;
        const name = getLocationName(loc, lang);
        return (
          <button
            key={loc.id}
            type="button"
            onClick={() => onPick(loc.id)}
            className={cn(
              "group flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-4 text-center",
              "shadow-soft transition-smooth hover:-translate-y-1 hover:shadow-glow active:scale-95",
              "min-h-[96px]"
            )}
          >
            <span
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-soft",
                gradients[i % gradients.length]
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <span className="line-clamp-2 text-xs font-semibold leading-tight">
              {name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
