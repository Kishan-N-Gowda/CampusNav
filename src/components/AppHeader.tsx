import { Moon, Sun, Languages, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { useAppSettings } from "@/hooks/useAppSettings";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { SettingsSheet } from "@/components/SettingsSheet";

interface AppHeaderProps {
  onOpenScanner?: () => void;
}

export function AppHeader({ onOpenScanner: _onOpenScanner }: AppHeaderProps = {}) {
  const { lang, setLang, dark, toggleDark } = useAppSettings();
  const { isAdmin } = useAuth();

  return (
    <header className="flex w-full max-w-full items-center justify-between gap-2 sm:gap-3">
      <Link to="/" className="flex items-center gap-2 shrink-0">
        <span className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
          <svg viewBox="0 0 24 24" className="h-4 w-4 sm:h-5 sm:w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </span>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-base sm:text-lg font-bold gradient-text whitespace-nowrap">
            {tr("appName", lang)}
          </span>
          <span className="text-[9px] sm:text-[10px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap hidden sm:inline">
            {tr("tagline", lang)}
          </span>
        </div>
      </Link>

      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle language"
          onClick={() => setLang(lang === "en" ? "kn" : "en")}
          className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg sm:rounded-xl"
        >
          <Languages className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span className="sr-only">Language</span>
        </Button>
        <span className="hidden text-xs font-semibold text-muted-foreground sm:inline">
          {lang.toUpperCase()}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle dark mode"
          onClick={toggleDark}
          className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg sm:rounded-xl"
        >
          {dark ? <Sun className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Moon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
        </Button>
        {isAdmin && <SettingsSheet triggerClassName="h-8 w-8 sm:h-9 sm:w-9 rounded-lg sm:rounded-xl" />}
        <Button
          asChild
          variant="ghost"
          size="icon"
          aria-label="Admin"
          className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg sm:rounded-xl"
        >
          <Link to="/admin"><Shield className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></Link>
        </Button>
      </div>
    </header>
  );
}
