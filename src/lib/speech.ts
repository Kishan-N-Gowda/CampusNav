import type { Language } from "@/data/locations";

/* -------------------------------------------------------------------------- */
/*  Voice preferences (persisted)                                             */
/* -------------------------------------------------------------------------- */

export type VoiceEngine = "auto" | "cloud" | "device";

export interface VoicePrefs {
  engine: VoiceEngine;
  // Per-language selected voice URIs for the browser SpeechSynthesis engine.
  deviceVoiceURI: Partial<Record<Language, string>>;
  rate: number; // 0.5 - 1.5
}

const PREF_KEY = "campusnav_voice_prefs";

export const defaultVoicePrefs: VoicePrefs = {
  engine: "auto",
  deviceVoiceURI: {},
  rate: 0.9,
};

export function loadVoicePrefs(): VoicePrefs {
  if (typeof window === "undefined") return defaultVoicePrefs;
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return defaultVoicePrefs;
    const parsed = JSON.parse(raw);
    return {
      ...defaultVoicePrefs,
      ...parsed,
      deviceVoiceURI: { ...defaultVoicePrefs.deviceVoiceURI, ...(parsed.deviceVoiceURI ?? {}) },
    };
  } catch {
    return defaultVoicePrefs;
  }
}

export function saveVoicePrefs(prefs: VoicePrefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {}
}

/* -------------------------------------------------------------------------- */
/*  Provider abstraction                                                      */
/*                                                                            */
/*  A TTSProvider isolates one synthesis backend. Swap in Google Cloud TTS    */
/*  or Azure Neural Voices later by adding a new provider class — the rest    */
/*  of the app calls speakText() and doesn't care which one runs.             */
/* -------------------------------------------------------------------------- */

export interface SpeakRequest {
  text: string;
  lang: Language;
  rate: number;
  onEnd?: () => void;
  onUnsupported?: (missing: Language) => void;
  onError?: (message: string) => void;
  runId: number;
}

export interface TTSProvider {
  readonly id: string;
  isAvailable(lang: Language): Promise<boolean>;
  speak(req: SpeakRequest): Promise<boolean>; // resolves true if it took over playback
  stop(): void;
}

/* --------------- 1) Cloud provider (Lovable AI Gateway) --------------- */

class CloudTTSProvider implements TTSProvider {
  readonly id = "cloud";
  private currentAudio: HTMLAudioElement | null = null;
  private pausedUntil = 0;
  private cache = new Map<string, string>();

  async isAvailable(_lang: Language) {
    return Date.now() >= this.pausedUntil;
  }

  private async fetchAudio(text: string, lang: Language): Promise<string | null> {
    if (Date.now() < this.pausedUntil) return null;
    try {
      const baseUrl =
        import.meta.env.VITE_SUPABASE_URL || "https://zqrkpfavuqnvwbqxwacc.supabase.co";
      const anon =
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!anon) {
        // No TTS backend key configured, gracefully fall back to device TTS
        return null;
      }
      const url = `${baseUrl.replace(/\/$/, "")}/functions/v1/tts`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anon,
          Authorization: `Bearer ${anon}`,
        },
        body: JSON.stringify({ text, lang }),
      });
      if (res.status === 204) {
        this.pausedUntil = Date.now() + 60_000;
        return null;
      }
      if (!res.ok) {
        this.pausedUntil = Date.now() + 30_000;
        return null;
      }
      const blob = await res.blob();
      if (!blob.size || !blob.type.startsWith("audio")) return null;
      const provider = res.headers.get("X-TTS-Provider") ?? "unknown";
      const voice = res.headers.get("X-TTS-Voice") ?? "unknown";
      console.info(`[tts] playing lang=${lang} provider=${provider} voice=${voice}`);
      return URL.createObjectURL(blob);
    } catch {
      this.pausedUntil = Date.now() + 30_000;
      return null;
    }
  }

  async speak(req: SpeakRequest): Promise<boolean> {
    const key = `${req.lang}::${req.text}`;
    let url = this.cache.get(key) ?? null;
    if (!url) {
      url = await this.fetchAudio(req.text, req.lang);
      if (url) this.cache.set(key, url);
    }
    if (!url) return false;
    if (req.runId !== currentRunId) return true; // superseded

    const audio = new Audio(url);
    audio.playbackRate = Math.max(0.5, Math.min(1.5, req.rate));
    this.currentAudio = audio;
    audio.onended = () => {
      if (this.currentAudio === audio) this.currentAudio = null;
      req.onEnd?.();
    };
    audio.onerror = () => {
      if (this.currentAudio === audio) this.currentAudio = null;
      req.onEnd?.();
    };
    try {
      await audio.play();
      return true;
    } catch {
      // Autoplay blocked etc.
      return false;
    }
  }

  stop() {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {}
      this.currentAudio = null;
    }
  }
}

/* --------------- 2) Browser SpeechSynthesis provider --------------- */

let voiceCache: SpeechSynthesisVoice[] | null = null;

function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve([]);
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now && now.length) return resolve(now);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.onvoiceschanged = null;
      resolve(synth.getVoices() ?? []);
    };
    synth.onvoiceschanged = finish;
    setTimeout(finish, timeoutMs);
  });
}

export async function listAvailableVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!voiceCache) voiceCache = await loadVoices();
  return voiceCache;
}

export async function listVoicesForLang(lang: Language): Promise<SpeechSynthesisVoice[]> {
  const all = await listAvailableVoices();
  const code = lang === "kn" ? "kn" : "en";
  return all.filter((v) => v.lang.toLowerCase().startsWith(code));
}

function pickKannadaVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const norm = (v: string) => v.toLowerCase().replace("_", "-");
  // Strict: only kn-IN (or bare kn). Never fall back to English for Kannada.
  return (
    voices.find((v) => norm(v.lang) === "kn-in") ||
    voices.find((v) => norm(v.lang) === "kn") ||
    voices.find((v) => norm(v.lang).startsWith("kn"))
  );
}

function pickEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const norm = (v: string) => v.toLowerCase().replace("_", "-");
  const order = ["en-in", "en-gb", "en-us", "en-au"];
  for (const w of order) {
    const hit = voices.find((v) => norm(v.lang) === w);
    if (hit) return hit;
  }
  return voices.find((v) => norm(v.lang).startsWith("en"));
}

async function pickPreferredVoice(
  lang: Language,
  preferredURI?: string,
): Promise<SpeechSynthesisVoice | undefined> {
  const all = await listAvailableVoices();
  if (preferredURI) {
    const chosen = all.find((v) => v.voiceURI === preferredURI);
    if (chosen && chosen.lang.toLowerCase().startsWith(lang === "kn" ? "kn" : "en")) {
      return chosen;
    }
  }
  const forLang = all.filter((v) =>
    v.lang.toLowerCase().startsWith(lang === "kn" ? "kn" : "en"),
  );
  return lang === "kn" ? pickKannadaVoice(forLang) : pickEnglishVoice(forLang);
}

export async function hasVoiceFor(lang: Language): Promise<boolean> {
  const list = await listVoicesForLang(lang);
  return list.length > 0;
}

class BrowserTTSProvider implements TTSProvider {
  readonly id = "device";

  async isAvailable(lang: Language) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    // For Kannada we specifically require a Kannada voice — no English fallback.
    if (lang === "kn") return (await listVoicesForLang("kn")).length > 0;
    return (await listVoicesForLang("en")).length > 0;
  }

  async speak(req: SpeakRequest): Promise<boolean> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      req.onEnd?.();
      return false;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    synth.resume();

    const prefs = loadVoicePrefs();
    const voice = await pickPreferredVoice(req.lang, prefs.deviceVoiceURI[req.lang]);

    if (req.lang === "kn" && !voice) {
      // Do NOT speak Kannada with an English voice. Signal unsupported.
      req.onUnsupported?.("kn");
      req.onEnd?.();
      return true;
    }

    // Split into sentences with natural pauses between them. Kannada uses
    // "।" or "." as sentence terminators.
    const sentences = req.text
      .split(/(?<=[.!?।])\s+|\n+/u)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!sentences.length) sentences.push(req.text);

    let remaining = sentences.length;
    const finishOne = () => {
      remaining -= 1;
      if (remaining <= 0) req.onEnd?.();
    };

    sentences.forEach((sentence, i) => {
      if (req.runId !== currentRunId) return;
      const utter = new SpeechSynthesisUtterance(sentence);
      utter.lang = voice?.lang ?? (req.lang === "kn" ? "kn-IN" : "en-IN");
      if (voice) utter.voice = voice;
      utter.rate = Math.max(0.5, Math.min(1.5, req.rate));
      utter.pitch = 1;
      // Small natural pause between instructions.
      const pauseText = i < sentences.length - 1 ? " " : "";
      utter.text = sentence + pauseText;
      utter.onend = finishOne;
      utter.onerror = finishOne;
      synth.speak(utter);
    });

    return true;
  }

  stop() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Registry — add Google Cloud TTS or Azure Neural here later                */
/* -------------------------------------------------------------------------- */

const cloudProvider = new CloudTTSProvider();
const deviceProvider = new BrowserTTSProvider();

let currentRunId = 0;
let activeProvider: TTSProvider | null = null;

function pickProviders(engine: VoiceEngine): TTSProvider[] {
  if (engine === "cloud") return [cloudProvider];
  if (engine === "device") return [deviceProvider];
  // "auto": prefer cloud (higher quality Kannada), fall back to device.
  return [cloudProvider, deviceProvider];
}

/**
 * Speak text using the highest-quality available provider for the given
 * language. For Kannada, only a native kn-IN voice is used; if none is
 * available on-device and the cloud provider is offline, `onUnsupported`
 * fires and nothing is spoken (we never mispronounce Kannada with an
 * English voice).
 */
export async function speakText(
  text: string,
  lang: Language,
  onEnd?: () => void,
  onUnsupported?: (missing: Language) => void,
  onError?: (message: string) => void,
) {
  stopSpeaking();
  const trimmed = text.trim();
  if (!trimmed) {
    onEnd?.();
    return;
  }
  const runId = ++currentRunId;
  const prefs = loadVoicePrefs();
  const providers = pickProviders(prefs.engine);

  for (const provider of providers) {
    if (runId !== currentRunId) return;
    const ok = await provider.isAvailable(lang);
    if (!ok) continue;
    activeProvider = provider;
    const took = await provider.speak({
      text: trimmed,
      lang,
      rate: prefs.rate,
      onEnd,
      onUnsupported,
      onError,
      runId,
    });
    if (took) return;
  }

  // No provider took over.
  if (lang === "kn") onUnsupported?.("kn");
  else onError?.("No voice engine available on this device.");
  onEnd?.();
}

/**
 * Admin preview: force a specific engine (usually "cloud") so the admin
 * hears exactly the provider/voice they just configured in the DB,
 * regardless of the user-level engine preference.
 */
export async function speakTextWithEngine(
  text: string,
  lang: Language,
  engine: VoiceEngine,
  onEnd?: () => void,
  onUnsupported?: (missing: Language) => void,
  onError?: (message: string) => void,
) {
  stopSpeaking();
  const trimmed = text.trim();
  if (!trimmed) { onEnd?.(); return; }
  const runId = ++currentRunId;
  const prefs = loadVoicePrefs();
  const providers = pickProviders(engine);

  for (const provider of providers) {
    if (runId !== currentRunId) return;
    const ok = await provider.isAvailable(lang);
    if (!ok) continue;
    activeProvider = provider;
    const took = await provider.speak({
      text: trimmed,
      lang,
      rate: prefs.rate,
      onEnd,
      onUnsupported,
      onError,
      runId,
    });
    if (took) return;
  }
  if (lang === "kn") onUnsupported?.("kn");
  else onError?.("Voice engine unavailable.");
  onEnd?.();
}

export function stopSpeaking() {
  currentRunId += 1;
  cloudProvider.stop();
  deviceProvider.stop();
  activeProvider = null;
}

/* -------------------------------------------------------------------------- */
/*  Voice recognition                                                          */
/* -------------------------------------------------------------------------- */

export interface VoiceRecognizer {
  start: () => void;
  stop: () => void;
  supported: boolean;
}

export function createRecognizer(
  lang: Language,
  onResult: (text: string) => void,
  onError?: (err: string) => void,
  onEnd?: () => void,
): VoiceRecognizer {
  const SR =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) {
    return {
      start: () => onError?.("Voice input is not supported in this browser."),
      stop: () => {},
      supported: false,
    };
  }

  const wanted = lang === "kn" ? "kn-IN" : "en-IN";
  const fallback = lang === "kn" ? "en-IN" : "en-US";
  let usingFallback = false;
  let rec: any = new SR();

  const configure = (instance: any, langCode: string) => {
    instance.lang = langCode;
    instance.interimResults = true;
    instance.maxAlternatives = 3;
    instance.continuous = false;

    let bestText = "";
    instance.onresult = (e: any) => {
      const alts: string[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        for (let j = 0; j < r.length; j++) alts.push(r[j].transcript);
      }
      const text = alts.reduce((a, b) => (b.length > a.length ? b : a), "");
      if (text) bestText = text;
      const isFinal = e.results[e.results.length - 1]?.isFinal;
      if (isFinal && bestText) onResult(bestText);
    };
    instance.onend = () => {
      if (bestText) {
        onResult(bestText);
        bestText = "";
      }
      onEnd?.();
    };
    instance.onerror = (e: any) => {
      const code = e?.error || "voice-error";
      if (
        !usingFallback &&
        (code === "language-not-supported" ||
          (code === "no-speech" && lang === "kn"))
      ) {
        usingFallback = true;
        try {
          rec = new SR();
          configure(rec, fallback);
          rec.start();
          onError?.(
            lang === "kn"
              ? "ಕನ್ನಡ ಧ್ವನಿ ಇನ್‌ಪುಟ್ ಈ ಸಾಧನದಲ್ಲಿ ಬೆಂಬಲಿತವಾಗಿಲ್ಲ. ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಪ್ರಯತ್ನಿಸಲಾಗುತ್ತಿದೆ."
              : "Kannada voice input isn't supported here — falling back to English.",
          );
        } catch {
          onError?.("Voice input failed.");
        }
        return;
      }
      onError?.(code);
    };
  };
  configure(rec, wanted);

  return {
    start: () => {
      try {
        rec.start();
      } catch {}
    },
    stop: () => {
      try {
        rec.stop();
      } catch {}
    },
    supported: true,
  };
}
