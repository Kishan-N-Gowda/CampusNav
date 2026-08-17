import { useEffect, useState } from "react";
import { Volume2, VolumeX, Footprints, Ruler, ChevronLeft, ChevronRight, ArrowUpDown, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Language, LocationStep } from "@/data/locations";
import type { TurnInstruction } from "@/lib/navigationInstructions";
import { TurnByTurnCard } from "@/components/TurnByTurnCard";
import { speakText, stopSpeaking } from "@/lib/speech";
import { cn } from "@/lib/utils";

interface Props {
  steps: LocationStep[];
  turnInstructions?: TurnInstruction[];
  destinationName?: string;
  destinationFloorLabel?: string;
  offRoute?: boolean;
  arrived?: boolean;
  lang: Language;
  speakLabel: string;
  stopLabel: string;
  distanceMeters: number;
  walkingMin: number;
  distanceLabel: string;
  walkingLabel: string;
  activeStep?: number;
  onStepChange?: (index: number) => void;
  navigating?: boolean;
  onStartNavigation?: () => void;
  onStopNavigation?: () => void;
}

export function Directions({
  steps,
  turnInstructions,
  destinationName,
  destinationFloorLabel,
  offRoute = false,
  arrived = false,
  lang,
  speakLabel,
  stopLabel,
  distanceMeters,
  walkingMin,
  distanceLabel,
  walkingLabel,
  activeStep,
  onStepChange,
  navigating,
  onStartNavigation,
  onStopNavigation,
}: Props) {
  const [speaking, setSpeaking] = useState(false);
  const active = activeStep ?? 0;

  const safeSteps = Array.isArray(steps) ? steps.filter(Boolean) : [];
  const safeTurnInstructions = Array.isArray(turnInstructions) ? turnInstructions.filter(Boolean) : [];

  // Derive active instruction text for speech synthesis
  const activeInstructionText = (() => {
    if (safeTurnInstructions.length > 0) {
      const inst = safeTurnInstructions[Math.min(active, safeTurnInstructions.length - 1)];
      if (!inst) return "";
      let txt = inst.title ? (inst.title[lang] || inst.title.en || "") : "";
      if (inst.subtitle) {
        const sub = inst.subtitle[lang] || inst.subtitle.en || "";
        if (sub) txt += `. ${sub}`;
      }
      return txt;
    }
    const curStep = safeSteps[active];
    if (!curStep) return "";
    return curStep[lang] || curStep.en || "";
  })();

  const totalStepCount = safeTurnInstructions.length > 0
    ? safeTurnInstructions.length
    : safeSteps.length;

  useEffect(() => {
    return () => stopSpeaking();
  }, []);

  useEffect(() => {
    setSpeaking(false);
    stopSpeaking();
  }, [steps, turnInstructions]);

  // Turn-by-turn: auto-speak the active step while navigating.
  useEffect(() => {
    if (!navigating) return;
    if (!activeInstructionText) return;
    setSpeaking(true);
    speakText(
      activeInstructionText,
      lang,
      () => setSpeaking(false),
      (missing) => {
        if (missing === "kn") {
          toast.warning(
            "ಈ ಸಾಧನದಲ್ಲಿ ಕನ್ನಡ ಧ್ವನಿ ಲಭ್ಯವಿಲ್ಲ. — Kannada voice unavailable; using default."
          );
        }
      },
      (err) => toast.error(`Voice unavailable: ${err}`)
    );
    return () => stopSpeaking();
  }, [navigating, activeInstructionText, lang]);

  const speak = () => {
    setSpeaking(true);
    let script = "";
    if (safeTurnInstructions.length > 0) {
      script = safeTurnInstructions
        .map((t) => {
          const tit = t.title ? (t.title[lang] || t.title.en || "") : "";
          const sub = t.subtitle ? (t.subtitle[lang] || t.subtitle.en || "") : "";
          return sub ? `${tit}. ${sub}` : tit;
        })
        .filter(Boolean)
        .join(lang === "kn" ? "। " : ". ");
    } else {
      script = safeSteps
        .map((s) => s[lang] || s.en || "")
        .filter(Boolean)
        .join(lang === "kn" ? "। " : ". ");
    }

    speakText(
      script,
      lang,
      () => setSpeaking(false),
      (missing) => {
        if (missing === "kn") {
          toast.warning(
            "ಈ ಸಾಧನದಲ್ಲಿ ಕನ್ನಡ ಧ್ವನಿ ಲಭ್ಯವಿಲ್ಲ. ಡೀಫಾಲ್ಟ್ ಧ್ವನಿ ಬಳಸಲಾಗುತ್ತಿದೆ. — No Kannada voice installed on this device; using default voice."
          );
        }
      },
      (err) => {
        setSpeaking(false);
        toast.error(`Voice unavailable: ${err}`);
      }
    );
  };

  const stop = () => {
    stopSpeaking();
    setSpeaking(false);
  };

  const go = (i: number) => {
    if (!onStepChange) return;
    if (i < 0 || i >= totalStepCount) return;
    onStepChange(i);
  };

  return (
    <div className="space-y-4">
      {/* Turn-by-turn Preview Header Card (shown when not actively navigating) */}
      {!navigating && destinationName && turnInstructions && turnInstructions.length > 0 && (
        <TurnByTurnCard
          destinationName={destinationName}
          destinationFloorLabel={destinationFloorLabel}
          instructions={turnInstructions}
          activeIndex={active}
          navigating={!!navigating}
          offRoute={offRoute}
          arrived={arrived}
          lang={lang}
          onStartNavigation={onStartNavigation}
          onStopNavigation={onStopNavigation}
          onStepChange={onStepChange}
        />
      )}

      {/* Distance and Walking Time Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-muted/40 p-3">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Ruler className="h-3.5 w-3.5" /> {distanceLabel}
          </div>
          <div className="mt-1 font-display text-xl font-bold">
            {distanceMeters >= 1000
              ? `${(distanceMeters / 1000).toFixed(1)} km`
              : `${Math.round(distanceMeters)} m`}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-muted/40 p-3">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Footprints className="h-3.5 w-3.5" /> {walkingLabel}
          </div>
          <div className="mt-1 font-display text-xl font-bold">{walkingMin} min</div>
        </div>
      </div>

      {/* Start / Stop Navigation Primary Button */}
      {(onStartNavigation || onStopNavigation) && totalStepCount > 0 && (
        navigating ? (
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
            size="lg"
            onClick={onStopNavigation}
          >
            <Square className="h-4 w-4" />
            {lang === "kn" ? "ನ್ಯಾವಿಗೇಷನ್ ನಿಲ್ಲಿಸಿ" : "Stop navigation"}
          </Button>
        ) : (
          <Button
            type="button"
            className="w-full gap-2 bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-soft"
            size="lg"
            onClick={onStartNavigation}
          >
            <Play className="h-4 w-4 fill-current" />
            {lang === "kn" ? "ನ್ಯಾವಿಗೇಷನ್ ಪ್ರಾರಂಭಿಸಿ" : "Start navigation"}
          </Button>
        )
      )}

      {/* Step-by-Step Instructions List (Scrollable internally to prevent page height explosion) */}
      <ol className="max-h-64 sm:max-h-80 overflow-y-auto space-y-2.5 pr-1">
        {safeTurnInstructions.length > 0
          ? safeTurnInstructions.map((step, i) => {
              const isActive = onStepChange ? i === active : false;
              const isConnector = step.type === "connector";
              const isArrival = step.type === "arrive";
              const titleText = step.title ? (step.title[lang] || step.title.en || "") : "";
              const subText = step.subtitle ? (step.subtitle[lang] || step.subtitle.en || "") : "";

              return (
                <li
                  key={step.id ? `${step.id}-${i}` : `step-${i}`}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 animate-float-in transition-all",
                    isActive
                      ? "border-primary/60 bg-primary/10 shadow-soft ring-1 ring-primary/30"
                      : "border-border bg-muted/40",
                    onStepChange && "cursor-pointer hover:border-primary/40"
                  )}
                  style={{ animationDelay: `${i * 50}ms` }}
                  onClick={() => onStepChange && go(i)}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-soft",
                      isArrival
                        ? "bg-emerald-500 text-white"
                        : isConnector
                        ? "bg-amber-500 text-white"
                        : "bg-gradient-primary text-primary-foreground"
                    )}
                  >
                    {isConnector ? (
                      <ArrowUpDown className="h-4 w-4" />
                    ) : isArrival ? (
                      "🎯"
                    ) : (
                      i + 1
                    )}
                  </span>
                  <div className="pt-0.5 text-sm leading-relaxed">
                    <p className="font-semibold text-foreground">{titleText}</p>
                    {subText && (
                      <p className="text-xs text-muted-foreground mt-0.5 font-medium">
                        {subText}
                      </p>
                    )}
                  </div>
                </li>
              );
            })
          : safeSteps.map((step, i) => {
              const isActive = onStepChange ? i === active : false;
              const isConnector = step.kind === "connector";
              const stepText = step[lang] || step.en || "";
              return (
                <li
                  key={i}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 animate-float-in transition-colors",
                    isActive
                      ? "border-primary/60 bg-primary/10 shadow-soft"
                      : "border-border bg-muted/40",
                    onStepChange && "cursor-pointer hover:border-primary/40"
                  )}
                  style={{ animationDelay: `${i * 60}ms` }}
                  onClick={() => onStepChange && go(i)}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold shadow-soft",
                      isConnector
                        ? "bg-accent text-accent-foreground"
                        : "bg-gradient-primary text-primary-foreground"
                    )}
                  >
                    {isConnector ? <ArrowUpDown className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className="pt-1 text-sm leading-relaxed">{stepText}</span>
                </li>
              );
            })}
      </ol>

      {/* Prev / Next Step Navigation Controls */}
      {onStepChange && totalStepCount > 1 && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => go(active - 1)}
            disabled={active <= 0}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" /> {lang === "kn" ? "ಹಿಂದಿನ" : "Prev"}
          </Button>
          <span className="text-xs font-semibold text-muted-foreground">
            {active + 1} / {totalStepCount}
          </span>
          <Button
            type="button"
            size="sm"
            onClick={() => go(active + 1)}
            disabled={active >= totalStepCount - 1}
            className="gap-1 bg-gradient-primary text-primary-foreground hover:opacity-90"
          >
            {lang === "kn" ? "ಮುಂದಿನ" : "Next"} <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Voice Readout Button */}
      {speaking ? (
        <Button onClick={stop} variant="outline" className="w-full gap-2" size="lg">
          <VolumeX className="h-5 w-5 text-destructive" /> {stopLabel}
        </Button>
      ) : (
        <Button
          onClick={speak}
          className="w-full gap-2 bg-gradient-primary text-primary-foreground hover:opacity-90"
          size="lg"
        >
          <Volume2 className="h-5 w-5" /> {speakLabel}
        </Button>
      )}
    </div>
  );
}
