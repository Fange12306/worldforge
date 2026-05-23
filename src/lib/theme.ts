// Theme utility — switches between dark/light by toggling .light class on <html>
import { useStore } from "./store";

export function applyTheme(theme: "dark" | "light") {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.remove("light");
  } else {
    root.classList.add("light");
  }
}

export function useTheme() {
  return useStore((s) => s.theme);
}
