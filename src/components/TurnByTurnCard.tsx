import React, { useState } from "react";
import {
  ArrowUp,
  ArrowRight,
  ArrowLeft,
  CornerUpRight,
  CornerUpLeft,
  ArrowUpDown,
  CheckCircle2,
  Navigation,
  AlertTriangle,
  RotateCcw,
  Footprints,
  Compass,
  ChevronUp,
  ChevronDown,
  Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TurnInstruction } from "@/lib/navigationInstructions";
import type { Language } from "@/data/locations";

interface TurnByTurnCardProps {
  destinationName: string;
  destinationFloorLabel?: string;
  instructions: TurnInstruction[];
  activeIndex: number;
  navigating: boolean;
  offRoute?: boolean;
  arrived?: boolean;
  lang: Language;
  onStartNavigation?: () => void;
  onStopNavigation?: () => void;
  onStepChange?: (index: number) => void;
  className?: string;
}

export const TurnByTurnCard: React.FC<TurnByTurnCardProps> = ({
  destinationName,
  destinationFloorLabel,
  instructions,
  activeIndex,
  navigating,
  offRoute = false,
  arrived = false,
  lang,
  onStartNavigation,
  onStopNavigation,
  onStepChange,
  className,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!Array.isArray(instructions) || instructions.length === 0) return null;

  const activeIdx = Math.min(Math.max(0, activeIndex || 0), instructions.length - 1);
  const currentInst = instructions[activeIdx];
  if (!currentInst) return null;

  const nextInst = activeIdx < instructions.length - 1 ? instructions[activeIdx + 1] : null;

  const getTitle = (inst?: TurnInstruction | null) => {
    if (!inst || !inst.title) return "";
    return inst.title[lang] || inst.title.en || "";
  };

  const getSubtitle = (inst?: TurnInstruction | null) => {
    if (!inst || !inst.subtitle) return "";
    return inst.subtitle[lang] || inst.subtitle.en || "";
  };

  const getInstructionIcon = (type: TurnInstruction["type"], sizeClass: string = "h-5 w-5") => {
    switch (type) {
      case "start":
        return <Navigation className={cn(sizeClass, "text-primary animate-pulse")} />;
      case "straight":
        return <ArrowUp className={cn(sizeClass, "text-primary")} />;
      case "right":
        return <CornerUpRight className={cn(sizeClass, "text-primary")} />;
      case "left":
        return <CornerUpLeft className={cn(sizeClass, "text-primary")} />;
      case "slight_right":
        return <ArrowRight className={cn(sizeClass, "text-primary -rotate-12")} />;
      case "slight_left":
        return <ArrowLeft className={cn(sizeClass, "text-primary rotate-12")} />;
      case "sharp_right":
        return <ArrowRight className={cn(sizeClass, "text-primary")} />;
      case "sharp_left":
        return <ArrowLeft className={cn(sizeClass, "text-primary")} />;
      case "connector":
        return <ArrowUpDown className={cn(sizeClass, "text-amber-500 dark:text-amber-400")} />;
      case "arrive":
        return <CheckCircle2 className={cn(sizeClass, "text-emerald-500")} />;
      default:
        return <Footprints className={cn(sizeClass, "text-primary")} />;
    }
  };

  if (arrived || currentInst.type === "arrive") {
    return (
      <div className={cn("rounded-2xl border border-emerald-500/40 bg-card/95 backdrop-blur-md p-3.5 shadow-card", className)}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-soft">
              <span className="text-lg">🎯</span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                {lang === "kn" ? "ನೀವು ತಲುಪಿದ್ದೀರಿ" : "You have arrived"}
              </span>
              <h3 className="font-display text-base font-bold text-foreground">
                {destinationName || "Destination"}
              </h3>
              {destinationFloorLabel && (
                <p className="text-[11px] text-muted-foreground font-medium">
                  {destinationFloorLabel}
                </p>
              )}
            </div>
          </div>
          {onStopNavigation && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onStopNavigation}
              className="h-8 border-border text-xs"
            >
              {lang === "kn" ? "ಮುಕ್ತಾಯ" : "Done"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const currentTitle = getTitle(currentInst);
  const currentSubtitle = getSubtitle(currentInst);

  // Collapsed View (compact banner)
  if (!isExpanded) {
    return (
      <div className={cn("rounded-2xl border border-primary/30 bg-card/95 backdrop-blur-md p-2.5 shadow-card transition-all", className)}>
        {offRoute && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 animate-pulse text-amber-500" />
              <span>{lang === "kn" ? "ಮಾರ್ಗದಿಂದ ಹೊರಗಿದ್ದೀರಿ" : "Off route"}</span>
            </div>
            <RotateCcw className="h-3 w-3 animate-spin" />
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          {/* Main instruction tap area to expand */}
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="flex-1 flex items-center gap-2.5 min-w-0 text-left hover:opacity-90 transition-opacity"
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
              {getInstructionIcon(currentInst.type, "h-5 w-5")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-display text-sm font-bold text-foreground truncate">
                  {currentTitle}
                </span>
                <span className="text-[11px] font-semibold text-primary shrink-0">
                  {activeIdx + 1}/{instructions.length}
                </span>
              </div>
              {currentSubtitle && (
                <p className="text-[11px] font-medium text-muted-foreground truncate">
                  {currentSubtitle}
                </p>
              )}
            </div>
          </button>

          {/* Controls */}
          <div className="flex items-center gap-1 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted"
              onClick={() => setIsExpanded(true)}
              aria-label="Expand instructions"
              title="Expand instructions"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            {onStopNavigation && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10"
                onClick={onStopNavigation}
                aria-label="Stop navigation"
                title="Stop navigation"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Expanded View
  return (
    <div className={cn("space-y-3 rounded-2xl border border-primary/30 bg-card/95 backdrop-blur-md p-3.5 shadow-card transition-all max-h-[75vh] sm:max-h-[80vh] flex flex-col", className)}>
      {/* Off-route banner */}
      {offRoute && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-xs font-bold text-amber-700 dark:text-amber-300 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 animate-pulse text-amber-500" />
            <span>{lang === "kn" ? "ನೀವು ಮಾರ್ಗದಿಂದ ಹೊರಗಿದ್ದೀರಿ" : "You are off route"}</span>
          </div>
          <span className="flex items-center gap-1 text-[11px] font-normal opacity-80">
            <RotateCcw className="h-3 w-3 animate-spin" />
            {lang === "kn" ? "ಮರುಲೆಕ್ಕಾಚಾರ..." : "Re-routing..."}
          </span>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <Badge variant="outline" className="gap-1.5 border-primary/30 bg-primary/10 text-primary font-bold text-xs truncate">
          <Compass className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {lang === "kn" ? `ನ್ಯಾವಿಗೇಟ್: ${destinationName || ""}` : `Navigating to ${destinationName || ""}`}
          </span>
        </Badge>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs font-semibold text-muted-foreground mr-1">
            {activeIdx + 1} / {instructions.length}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted"
            onClick={() => setIsExpanded(false)}
            aria-label="Collapse instructions"
            title="Collapse instructions"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          {onStopNavigation && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10"
              onClick={onStopNavigation}
              aria-label="Stop navigation"
              title="Stop navigation"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          )}
        </div>
      </div>

      {/* Primary Active Step */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 shrink-0">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-background border border-primary/30 shadow-soft">
          {getInstructionIcon(currentInst.type, "h-5 w-5")}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-display text-sm font-bold text-foreground leading-snug">
            {currentTitle}
          </h4>
          {currentSubtitle && (
            <p className="mt-0.5 text-xs font-semibold text-primary">
              {currentSubtitle}
            </p>
          )}
        </div>
      </div>

      {/* Next Step Preview */}
      {nextInst && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-xs shrink-0">
          <span className="font-bold text-muted-foreground uppercase tracking-wider text-[10px] shrink-0">
            {lang === "kn" ? "ನಂತರ" : "Then"}
          </span>
          <span className="truncate text-foreground font-medium">
            {getTitle(nextInst)}
          </span>
        </div>
      )}

      {/* Scrollable List of All Steps */}
      <div className="overflow-y-auto max-h-48 pr-1 space-y-1.5 border-t border-border/50 pt-2 shrink min-h-0">
        {instructions.map((inst, i) => {
          const isActive = i === activeIdx;
          const instTitle = getTitle(inst);
          return (
            <button
              key={inst.id ? `${inst.id}-${i}` : `inst-step-${i}`}
              type="button"
              onClick={() => onStepChange && onStepChange(i)}
              className={cn(
                "w-full text-left flex items-center gap-2.5 rounded-lg p-2 text-xs transition-colors",
                isActive
                  ? "bg-primary/10 font-semibold text-primary border border-primary/20"
                  : "hover:bg-muted/50 text-muted-foreground"
              )}
            >
              <span className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
                {i + 1}
              </span>
              <span className="truncate flex-1">{instTitle}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
