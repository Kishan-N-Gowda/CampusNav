// Text-to-speech proxy. Reads per-language provider config from
// public.tts_settings and dispatches to the chosen provider.
// Falls back to 204 (browser TTS) when no provider is usable.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-TTS-Provider, X-TTS-Voice, X-TTS-Fallback",
};

type Provider = "lovable" | "elevenlabs" | "google" | "azure";

interface Settings {
  provider: Provider;
  voice_id: string;
  model: string | null;
  rate: number;
}

const fallback204 = () =>
  new Response(null, {
    status: 204,
    headers: { ...corsHeaders, "X-TTS-Fallback": "browser" },
  });

async function callLovable(text: string, lang: string, s: Settings) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    console.warn("LOVABLE_API_KEY not set");
    return null;
  }
  const instructions =
    lang === "kn"
      ? "Speak clearly in Kannada with a calm, neutral male navigator tone. Pronounce Kannada words naturally; keep pacing steady and confident."
      : "Speak clearly in Indian English with a calm, neutral male navigator tone. Keep pacing steady and confident.";
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: s.model || "openai/gpt-4o-mini-tts",
        input: text.slice(0, 4000),
        voice: s.voice_id || "alloy",
        instructions,
        response_format: "mp3",
      }),
    });
    console.log("lovable tts status", r.status, "ct", r.headers.get("Content-Type"));
    return r;
  } catch (e) {
    console.error("lovable fetch threw", e);
    return null;
  }
}

async function callElevenLabs(text: string, s: Settings) {
  const key = Deno.env.get("ELEVENLABS_API_KEY");
  if (!key) return null;
  const voice = s.voice_id || "21m00Tcm4TlvDq8ikWAM";
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: text.slice(0, 4000),
        model_id: s.model || "eleven_multilingual_v2",
      }),
    },
  );
  return r;
}

async function callGoogle(text: string, lang: string, s: Settings) {
  const key = Deno.env.get("GOOGLE_TTS_API_KEY");
  if (!key) return null;
  const languageCode = lang === "kn" ? "kn-IN" : "en-IN";
  const r = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: text.slice(0, 4000) },
        voice: { languageCode, name: s.voice_id || undefined },
        audioConfig: { audioEncoding: "MP3", speakingRate: s.rate || 0.9 },
      }),
    },
  );
  if (!r.ok) return r;
  const j = await r.json();
  const bytes = Uint8Array.from(atob(j.audioContent), (c) => c.charCodeAt(0));
  return new Response(bytes, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
}

async function callAzure(text: string, lang: string, s: Settings) {
  const key = Deno.env.get("AZURE_TTS_KEY");
  const region = Deno.env.get("AZURE_TTS_REGION");
  if (!key || !region) return null;
  const voice = s.voice_id || (lang === "kn" ? "kn-IN-GaganNeural" : "en-IN-PrabhatNeural");
  const langCode = lang === "kn" ? "kn-IN" : "en-IN";
  const ssml = `<speak version='1.0' xml:lang='${langCode}'><voice xml:lang='${langCode}' name='${voice}'>${text
    .replace(/[<&>]/g, "")
    .slice(0, 4000)}</voice></speak>`;
  const r = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      },
      body: ssml,
    },
  );
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, lang } = await req.json();
    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "text required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const language = lang === "kn" ? "kn" : "en";

    // Load per-language settings (defaults to lovable/onyx if missing).
    let settings: Settings = {
      provider: "lovable",
      voice_id: "onyx",
      model: "openai/gpt-4o-mini-tts",
      rate: 0.9,
    };
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (url && anon) {
      try {
        const sb = createClient(url, anon);
        const { data } = await sb
          .from("tts_settings")
          .select("provider, voice_id, model, rate")
          .eq("lang", language)
          .maybeSingle();
        if (data) settings = { ...settings, ...(data as any) };
      } catch (_) {
        // fall through with defaults
      }
    }

    console.log(
      `[tts] active provider=${settings.provider} voice=${settings.voice_id} model=${settings.model ?? "-"} lang=${language} rate=${settings.rate}`,
    );

    let upstream: Response | null = null;
    let usedProvider: Provider = settings.provider;
    switch (settings.provider) {
      case "elevenlabs":
        upstream = await callElevenLabs(text, settings);
        break;
      case "google":
        upstream = await callGoogle(text, language, settings);
        break;
      case "azure":
        upstream = await callAzure(text, language, settings);
        break;
      case "lovable":
      default:
        upstream = await callLovable(text, language, settings);
        break;
    }

    // Only fall back to Lovable when the SELECTED provider actually failed
    // (missing key = null upstream, or non-OK HTTP status). A successful
    // response from the selected provider is always used as-is.
    if ((!upstream || !upstream.ok) && settings.provider !== "lovable") {
      console.warn(
        `[tts] selected provider ${settings.provider} failed (${upstream?.status ?? "no-key"}); falling back to lovable`,
      );
      const lovableSettings: Settings = {
        ...settings,
        provider: "lovable",
        voice_id: "alloy",
        model: "openai/gpt-4o-mini-tts",
      };
      upstream = await callLovable(text, language, lovableSettings);
      usedProvider = "lovable";
    } else if (upstream && upstream.ok) {
      console.log(`[tts] served by selected provider=${settings.provider} voice=${settings.voice_id}`);
    }

    if (!upstream) return fallback204();
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      console.warn("TTS upstream unavailable", settings.provider, upstream.status, errText);
      return fallback204();
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg",
        "Cache-Control": "public, max-age=3600",
        "X-TTS-Provider": usedProvider,
        "X-TTS-Voice": settings.voice_id,
      },
    });
  } catch (e) {
    console.error("tts error", e);
    return fallback204();
  }
});
