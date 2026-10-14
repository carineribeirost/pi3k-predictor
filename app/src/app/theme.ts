import { useEffect, useSyncExternalStore } from "react";
import { useWorkspace } from "../shared/lib/workspace-store";

const media = window.matchMedia("(prefers-color-scheme: dark)");
const subscribe = (cb: () => void) => {
  media.addEventListener("change", cb);
  return () => media.removeEventListener("change", cb);
};

/** "light" or "dark": the theme currently in effect. */
export function useThemeKey(): string {
  const theme = useWorkspace((s) => s.theme);
  const systemDark = useSyncExternalStore(subscribe, () => media.matches);
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

/** Applies the chosen theme to the document. */
export function useApplyTheme() {
  const theme = useWorkspace((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
}
