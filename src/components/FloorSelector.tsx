import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FloorOption {
  value: number;
  label: string;
  count: number;
}

interface Props {
  options: FloorOption[];
  value: number;
  onChange: (floor: number) => void;
  className?: string;
}

const FLOOR_LABELS: Record<number, string> = {
  0: "Ground",
  1: "1st",
  2: "2nd",
  3: "3rd",
  4: "4th",
  5: "5th",
};

export function floorLabel(n: number): string {
  return FLOOR_LABELS[n] ?? `${n}th`;
}

export function FloorSelector({ options, value, onChange, className }: Props) {
  if (options.length <= 1) return null;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-soft",
        className
      )}
      role="tablist"
      aria-label="Floor"
    >
      <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Layers className="inline h-3 w-3 -mt-0.5" /> Floor
      </span>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            size="sm"
            variant={active ? "default" : "ghost"}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-7 rounded-full px-3 text-xs",
              active &&
                "bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-90"
            )}
          >
            {o.label}
            <span
              className={cn(
                "ml-1 text-[10px] opacity-70",
                active && "opacity-90"
              )}
            >
              ({o.count})
            </span>
          </Button>
        );
      })}
    </div>
  );
}
