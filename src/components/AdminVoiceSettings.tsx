import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Volume2 } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { speakTextWithEngine, stopSpeaking } from "@/lib/speech";
import { toast } from "sonner";

type Provider = "lovable" | "elevenlabs" | "google" | "azure";

interface Row {
  lang: "en" | "kn";
  provider: Provider;
  voice_id: string;
  model: string | null;
  rate: number;
}

const providerLabels: Record<Provider, string> = {
  lovable: "Lovable AI (built-in)",
  elevenlabs: "ElevenLabs",
  google: "Google Cloud TTS",
  azure: "Azure Neural Voices",
};

const providerHints: Record<Provider, { voice: string; model: string; secretHint: string }> = {
  lovable: {
    voice: "onyx / alloy / nova / shimmer / echo / fable",
    model: "openai/gpt-4o-mini-tts",
    secretHint: "No API key needed — uses your Lovable AI credits.",
  },
  elevenlabs: {
    voice: "Voice ID (e.g. 21m00Tcm4TlvDq8ikWAM)",
    model: "eleven_multilingual_v2",
    secretHint: "Requires ELEVENLABS_API_KEY secret.",
  },
  google: {
    voice: "kn-IN-Wavenet-A / en-IN-Neural2-D",
    model: "(not used)",
    secretHint: "Requires GOOGLE_TTS_API_KEY secret.",
  },
  azure: {
    voice: "kn-IN-GaganNeural / en-IN-PrabhatNeural",
    model: "(not used)",
    secretHint: "Requires AZURE_TTS_KEY and AZURE_TTS_REGION secrets.",
  },
};

const defaults: Record<"en" | "kn", Row> = {
  en: { lang: "en", provider: "lovable", voice_id: "onyx", model: "openai/gpt-4o-mini-tts", rate: 0.9 },
  kn: { lang: "kn", provider: "lovable", voice_id: "onyx", model: "openai/gpt-4o-mini-tts", rate: 0.9 },
};

export function AdminVoiceSettings() {
  const [rows, setRows] = useState<Record<"en" | "kn", Row>>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"en" | "kn" | null>(null);
  const [previewing, setPreviewing] = useState<"en" | "kn" | null>(null);
  const savingRef = useRef<"en" | "kn" | null>(null);
  savingRef.current = saving;

  const load = useCallback(async () => {
    const { data, error } = await (supabase as any).from("tts_settings").select("*");
    if (!error && data) {
      const next = { ...defaults };
      for (const r of data as Row[]) {
        if (r.lang === "en" || r.lang === "kn") next[r.lang] = { ...defaults[r.lang], ...r };
      }
      setRows(next);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`tts-settings-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tts_settings" },
        () => {
          // Don't clobber a form the admin is mid-save on.
          if (!savingRef.current) load();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);


  const update = (lang: "en" | "kn", patch: Partial<Row>) =>
    setRows((prev) => ({ ...prev, [lang]: { ...prev[lang], ...patch } }));

  const save = async (lang: "en" | "kn") => {
    setSaving(lang);
    const row = rows[lang];
    const { error } = await (supabase as any)
      .from("tts_settings")
      .upsert(
        {
          lang,
          provider: row.provider,
          voice_id: row.voice_id.trim(),
          model: row.model?.trim() || null,
          rate: row.rate,
        },
        { onConflict: "lang" },
      );
    setSaving(null);
    if (error) toast.error(error.message);
    else toast.success(`${lang === "kn" ? "Kannada" : "English"} voice saved`);
  };

  const preview = async (lang: "en" | "kn") => {
    setPreviewing(lang);
    stopSpeaking();
    const sample =
      lang === "kn"
        ? "ಮುಂದೆ ಇಪ್ಪತ್ತು ಮೀಟರ್ ನೇರ ಸಾಗಿ. ನಂತರ ಬಲಕ್ಕೆ ತಿರುಗಿ."
        : "In twenty metres, turn right toward the main entrance.";
    await speakTextWithEngine(
      sample,
      lang,
      "cloud",
      () => setPreviewing(null),
      (missing) => {
        if (missing === "kn") toast.warning("No Kannada voice available from cloud provider.");
      },
      (err) => {
        setPreviewing(null);
        toast.error(`Preview failed: ${err}`);
      },
    );
    setTimeout(() => setPreviewing(null), 8000);
  };

  if (loading) {
    return <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
        <h3 className="font-display text-base font-semibold">Navigation voice</h3>
        <p className="text-xs text-muted-foreground">
          Pick which text-to-speech service pronounces turn-by-turn directions for each language.
          To use a third-party service, add its API key in project secrets — the edge function reads it at runtime.
        </p>
      </div>

      {(["en", "kn"] as const).map((lang) => {
        const row = rows[lang];
        const hint = providerHints[row.provider];
        return (
          <div key={lang} className="rounded-2xl border border-border bg-card p-4 shadow-soft space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-display text-sm font-semibold">
                {lang === "kn" ? "Kannada (ಕನ್ನಡ)" : "English"}
              </h4>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {lang}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select
                  value={row.provider}
                  onValueChange={(v) => update(lang, { provider: v as Provider })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(providerLabels) as Provider[]).map((p) => (
                      <SelectItem key={p} value={p}>{providerLabels[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Voice ID</Label>
                <Input
                  value={row.voice_id}
                  onChange={(e) => update(lang, { voice_id: e.target.value })}
                  placeholder={hint.voice}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Model (optional)</Label>
                <Input
                  value={row.model ?? ""}
                  onChange={(e) => update(lang, { model: e.target.value })}
                  placeholder={hint.model}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Speech rate</Label>
                <Input
                  type="number"
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  value={row.rate}
                  onChange={(e) => update(lang, { rate: Number(e.target.value) || 0.9 })}
                />
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">{hint.secretHint}</p>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => save(lang)}
                disabled={saving === lang}
                className="bg-gradient-primary text-primary-foreground hover:opacity-90"
              >
                {saving === lang ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <Button
                variant="outline"
                onClick={() => preview(lang)}
                disabled={previewing === lang}
                className="gap-1.5"
              >
                <Volume2 className="h-4 w-4" />
                {previewing === lang ? "Playing…" : "Preview"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
