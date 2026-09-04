import { useEffect, useState } from "react";
import { Settings2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  listVoicesForLang,
  loadVoicePrefs,
  saveVoicePrefs,
  speakText,
  type VoiceEngine,
  type VoicePrefs,
} from "@/lib/speech";

const SAMPLE = {
  en: "Turn right at the next corridor and continue for 20 meters.",
  kn: "ಮುಂದಿನ ಕಾರಿಡಾರ್‌ನಲ್ಲಿ ಬಲಕ್ಕೆ ತಿರುಗಿ, ಇಪ್ಪತ್ತು ಮೀಟರ್ ಮುಂದೆ ಸಾಗಿ.",
};

export function SettingsSheet({ triggerClassName }: { triggerClassName?: string } = {}) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<VoicePrefs>(() => loadVoicePrefs());
  const [enVoices, setEnVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [knVoices, setKnVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const [en, kn] = await Promise.all([
        listVoicesForLang("en"),
        listVoicesForLang("kn"),
      ]);
      if (!alive) return;
      setEnVoices(en);
      setKnVoices(kn);
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  const update = (next: VoicePrefs) => {
    setPrefs(next);
    saveVoicePrefs(next);
  };

  const setEngine = (engine: VoiceEngine) => update({ ...prefs, engine });
  const setDeviceVoice = (lang: "en" | "kn", uri: string) =>
    update({
      ...prefs,
      deviceVoiceURI: { ...prefs.deviceVoiceURI, [lang]: uri },
    });
  const setRate = (rate: number) => update({ ...prefs, rate });

  const preview = (lang: "en" | "kn") => {
    speakText(SAMPLE[lang], lang);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Settings"
          className={triggerClassName || "h-8 w-8 rounded-lg sm:h-9 sm:w-9 sm:rounded-xl"}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-display">
            <Volume2 className="h-5 w-5" /> Navigation voice
          </SheetTitle>
          <SheetDescription>
            Choose how turn-by-turn directions sound. Kannada uses a native
            kn-IN voice — never an English fallback.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Engine */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Voice engine</Label>
            <RadioGroup
              value={prefs.engine}
              onValueChange={(v) => setEngine(v as VoiceEngine)}
              className="space-y-2"
            >
              {[
                { value: "auto", label: "Automatic (recommended)", hint: "Cloud voice with device fallback" },
                { value: "cloud", label: "Cloud voice", hint: "Natural, Google-Maps-like tone" },
                { value: "device", label: "Device voice", hint: "Works offline, uses system voices" },
              ].map((opt) => (
                <label
                  key={opt.value}
                  htmlFor={`engine-${opt.value}`}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/40 p-3 hover:border-primary/40"
                >
                  <RadioGroupItem id={`engine-${opt.value}`} value={opt.value} className="mt-1" />
                  <div>
                    <div className="text-sm font-semibold">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.hint}</div>
                  </div>
                </label>
              ))}
            </RadioGroup>
          </div>

          {/* Rate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Speech rate</Label>
              <span className="text-xs text-muted-foreground">{prefs.rate.toFixed(2)}x</span>
            </div>
            <Slider
              min={0.6}
              max={1.3}
              step={0.05}
              value={[prefs.rate]}
              onValueChange={([v]) => setRate(v)}
            />
          </div>

          {/* English voice */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">English (device) voice</Label>
              <Button size="sm" variant="outline" onClick={() => preview("en")}>
                Preview
              </Button>
            </div>
            <Select
              value={prefs.deviceVoiceURI.en ?? ""}
              onValueChange={(v) => setDeviceVoice("en", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Auto (best available)" />
              </SelectTrigger>
              <SelectContent>
                {enVoices.length === 0 && (
                  <SelectItem value="__none" disabled>
                    No English voices installed
                  </SelectItem>
                )}
                {enVoices.map((v) => (
                  <SelectItem key={v.voiceURI} value={v.voiceURI}>
                    {v.name} · {v.lang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Kannada voice */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Kannada (device) voice</Label>
              <Button size="sm" variant="outline" onClick={() => preview("kn")}>
                Preview
              </Button>
            </div>
            <Select
              value={prefs.deviceVoiceURI.kn ?? ""}
              onValueChange={(v) => setDeviceVoice("kn", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Auto (best kn-IN available)" />
              </SelectTrigger>
              <SelectContent>
                {knVoices.length === 0 && (
                  <SelectItem value="__none" disabled>
                    No Kannada voice on this device
                  </SelectItem>
                )}
                {knVoices.map((v) => (
                  <SelectItem key={v.voiceURI} value={v.voiceURI}>
                    {v.name} · {v.lang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {knVoices.length === 0 && (
              <p className="text-xs text-muted-foreground">
                This device doesn't have a Kannada TTS voice installed. The
                cloud voice will be used for Kannada when available.
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
