import { useState } from "react";
import { Search, MapPin, Mic } from "lucide-react";
import type { CampusLocation, Language } from "@/data/locations";
import { getLocationName } from "@/data/locations";
import { cn } from "@/lib/utils";
import { createRecognizer } from "@/lib/speech";
import { toast } from "sonner";

interface Props {
  locations: CampusLocation[];
  lang: Language;
  value?: string;
  onSelect: (id: string) => void;
  placeholder: string;
  enableVoice?: boolean;
  voiceLabel?: string;
}

export function DestinationSearch({
  locations,
  lang,
  value,
  onSelect,
  placeholder,
  enableVoice = false,
  voiceLabel = "Voice",
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);

  const safeLocations = Array.isArray(locations) ? locations : [];
  const q = query.trim().toLowerCase();
  const selectable = safeLocations.filter((l) => l && !l.hidden);
  const filtered = q
    ? selectable.filter(
        (l) =>
          getLocationName(l, lang).toLowerCase().includes(q) ||
          getLocationName(l, "en").toLowerCase().includes(q) ||
          (l.slug && l.slug.toLowerCase().includes(q)) ||
          (l.category && l.category.toLowerCase().includes(q))
      )
    : selectable.slice(0, 8);

  const selected = safeLocations.find((l) => l && l.id === value);

  const tryMatch = (text: string) => {
    const lc = text.toLowerCase().trim();
    // strip common command prefixes in EN + KN
    const cleaned = lc
      .replace(
        /^(please\s+)?(take me to|take me|go to|navigate to|navigate|directions to|show me|find|search for|where is|to)\s+/i,
        "",
      )
      .replace(/^(ನನ್ನನ್ನು\s+)?(ಗೆ\s+ಕರೆದೊಯ್ಯಿರಿ|ಕಡೆಗೆ\s+ಕರೆದೊಯ್ಯಿರಿ|ಗೆ\s+ಹೋಗು|ಎಲ್ಲಿ)\s*/i, "")
      .replace(/[?.!,]+$/g, "")
      .trim();

    if (!cleaned) {
      toast.message("Didn't catch that — please try again.");
      return;
    }

    const tokens = cleaned.split(/\s+/).filter(Boolean);

    // Score each location against the spoken phrase.
    const score = (l: CampusLocation) => {
      const en = getLocationName(l, "en").toLowerCase();
      const kn = getLocationName(l, "kn").toLowerCase();
      const slug = (l.slug || "").toLowerCase();
      const cat = (l.category || "").toLowerCase();
      if (en === cleaned || kn === cleaned || slug === cleaned) return 100;
      if (en.includes(cleaned) || kn.includes(cleaned) || slug.includes(cleaned)) return 80;
      if (cleaned.includes(en) || cleaned.includes(kn)) return 70;
      let s = 0;
      for (const tok of tokens) {
        if (tok.length < 2) continue;
        if (en.includes(tok) || slug.includes(tok)) s += 20;
        else if (kn.includes(tok)) s += 18;
        else if (cat.includes(tok)) s += 8;
      }
      return s;
    };

    let best: { l: CampusLocation; s: number } | null = null;
    for (const l of selectable) {
      const s = score(l);
      if (s > 0 && (!best || s > best.s)) best = { l, s };
    }

    if (best && best.s >= 20) {
      onSelect(best.l.id);
      setQuery("");
      toast.success(`→ ${getLocationName(best.l, lang)}`);
    } else {
      setQuery(cleaned);
      setOpen(true);
      toast.message(`Searching: "${cleaned}"`);
    }
  };

  const startVoice = () => {
    const rec = createRecognizer(
      lang,
      (text) => tryMatch(text),
      (err) => {
        setListening(false);
        toast.error(err);
      },
      () => setListening(false)
    );
    if (!rec.supported) {
      toast.error("Voice input not supported in this browser");
      return;
    }
    setListening(true);
    rec.start();
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-primary/70" />
        <input
          type="text"
          value={query}
          placeholder={selected ? getLocationName(selected, lang) : placeholder}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          className={cn(
            "w-full rounded-2xl border border-border bg-card/80 py-4 pl-12 pr-14 text-base shadow-soft backdrop-blur",
            "placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30",
            "transition-smooth"
          )}
        />
        {enableVoice && (
          <button
            type="button"
            onClick={startVoice}
            aria-label={voiceLabel}
            className={cn(
              "absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl transition-smooth",
              listening
                ? "bg-destructive text-destructive-foreground animate-pulse"
                : "bg-primary/10 text-primary hover:bg-primary/20"
            )}
          >
            <Mic className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-border bg-card shadow-card animate-float-in">
          <ul className="max-h-72 overflow-auto py-1">
            {filtered.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">No matches</li>
            )}
            {filtered.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(l.id);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-smooth hover:bg-muted"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground">
                    <MapPin className="h-4 w-4" />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold">{getLocationName(l, lang)}</span>
                    <span className="text-[11px] text-muted-foreground">
                      Floor {l.floor ?? 0}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
