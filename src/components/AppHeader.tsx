import { Moon, Sun, Languages, Shield, LogOut, LogIn } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAppSettings } from "@/hooks/useAppSettings";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SettingsSheet } from "@/components/SettingsSheet";

export function AppHeader() {
  const { lang, setLang, dark, toggleDark } = useAppSettings();
  const { session, isAdmin } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate("/auth");
  };

  return (
    <header className="flex items-center justify-between gap-3">
      <Link to="/" className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </span>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-lg font-bold gradient-text">{tr("appName", lang)}</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {tr("tagline", lang)}
          </span>
        </div>
      </Link>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle language"
          onClick={() => setLang(lang === "en" ? "kn" : "en")}
          className="h-10 w-10 rounded-xl"
        >
          <Languages className="h-4 w-4" />
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
          className="h-10 w-10 rounded-xl"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        {isAdmin && <SettingsSheet />}
        <Button
          asChild
          variant="ghost"
          size="icon"
          aria-label="Admin"
          className="h-10 w-10 rounded-xl"
        >
          <Link to="/admin"><Shield className="h-4 w-4" /></Link>
        </Button>
        {session && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            onClick={handleSignOut}
            className="h-10 w-10 rounded-xl"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
