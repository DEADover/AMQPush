import { useState, useEffect, useCallback } from "react";

export type ThemeMode = "light" | "dark" | "system";

const KEY = "amqpush-theme";

function systemIsDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function effectiveTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (systemIsDark() ? "dark" : "light") : mode;
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.classList.toggle("dark", effectiveTheme(mode) === "dark");
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(
    () => (localStorage.getItem(KEY) as ThemeMode | null) ?? "system"
  );

  // Sync class when mode changes (initial class is already set by index.html script)
  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  // Follow OS preference changes when in "system" mode
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => {
    localStorage.setItem(KEY, m);
    setModeState(m);
  }, []);

  /** Cycle: system → light → dark → system */
  const cycleMode = useCallback(() => {
    setMode(mode === "system" ? "light" : mode === "light" ? "dark" : "system");
  }, [mode, setMode]);

  return { mode, effective: effectiveTheme(mode), setMode, cycleMode };
}
