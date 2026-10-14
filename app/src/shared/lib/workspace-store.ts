import { create } from "zustand";

export type LabelFilter = "all" | "active" | "inactive";
export type DomainFilter = "all" | "in" | "out";
export type Theme = "system" | "light" | "dark";
export type AddTab = "paste" | "file" | "draw" | "example";

type WorkspaceState = {
  /** Which tab the new-prediction dialog opened on, or null when it is closed. */
  adding: AddTab | null;
  openAdd: (tab?: AddTab) => void;
  closeAdd: () => void;
  selected: number | null;
  /** Threshold being edited for the open run, before it is saved. */
  threshold: number | null;
  label: LabelFilter;
  domain: DomainFilter;
  errorsOnly: boolean;
  search: string;
  theme: Theme;
  select: (index: number | null) => void;
  setThreshold: (t: number | null) => void;
  setLabel: (l: LabelFilter) => void;
  setDomain: (d: DomainFilter) => void;
  setErrorsOnly: (v: boolean) => void;
  setSearch: (s: string) => void;
  setTheme: (t: Theme) => void;
  resetForRun: () => void;
};

function storedTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  adding: null,
  openAdd: (tab = "paste") => set({ adding: tab }),
  closeAdd: () => set({ adding: null }),
  selected: null,
  threshold: null,
  label: "all",
  domain: "all",
  errorsOnly: false,
  search: "",
  theme: storedTheme(),
  select: (selected) => set({ selected }),
  setThreshold: (threshold) => set({ threshold }),
  setLabel: (label) => set({ label }),
  setDomain: (domain) => set({ domain }),
  setErrorsOnly: (errorsOnly) => set({ errorsOnly }),
  setSearch: (search) => set({ search }),
  setTheme: (theme) => {
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Storage may be unavailable; the choice still applies for this session.
    }
    set({ theme });
  },
  resetForRun: () =>
    set({ selected: null, threshold: null, label: "all", domain: "all", errorsOnly: false, search: "" }),
}));
