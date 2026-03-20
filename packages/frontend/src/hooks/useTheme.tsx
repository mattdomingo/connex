import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "connex_theme";

interface ThemeContextType {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

function getSystemPref(): ResolvedTheme {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function resolve(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? getSystemPref() : mode;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(
    () => (localStorage.getItem(STORAGE_KEY) as ThemeMode) || "system",
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(mode));

  const apply = useCallback((m: ThemeMode) => {
    const r = resolve(m);
    setResolved(r);
    document.documentElement.setAttribute("data-theme", r);
  }, []);

  useEffect(() => {
    apply(mode);
  }, [mode, apply]);

  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const listener = () => apply("system");
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [mode, apply]);

  const setMode = useCallback(
    (m: ThemeMode) => {
      localStorage.setItem(STORAGE_KEY, m);
      setModeState(m);
    },
    [],
  );

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
