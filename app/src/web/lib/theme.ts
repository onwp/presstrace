export type ThemeChoice = "light" | "dark" | "system";
const KEY = "pt-theme";

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(choice: ThemeChoice): void {
  const dark = choice === "dark" || (choice === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage can be unavailable (private mode); the choice still applies to this page.
  }
  applyTheme(choice);
}

/** Keeps "system" in sync when the OS theme changes. */
export function watchSystemTheme(): () => void {
  const m = media();
  const onChange = () => {
    if (getThemeChoice() === "system") applyTheme("system");
  };
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}
