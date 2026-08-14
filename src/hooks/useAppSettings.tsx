import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Language } from "@/data/locations";

interface AppSettings {
  lang: Language;
  setLang: (l: Language) => void;
  dark: boolean;
  toggleDark: () => void;
}

const Ctx = createContext<AppSettings | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(
    () => (localStorage.getItem("campusnav_lang") as Language) || "en"
  );
  const [dark, setDark] = useState<boolean>(
    () => localStorage.getItem("campusnav_dark") === "1"
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("campusnav_dark", dark ? "1" : "0");
  }, [dark]);

  const setLang = (l: Language) => {
    setLangState(l);
    localStorage.setItem("campusnav_lang", l);
  };

  return (
    <Ctx.Provider value={{ lang, setLang, dark, toggleDark: () => setDark((d) => !d) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAppSettings() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppSettings outside provider");
  return v;
}
