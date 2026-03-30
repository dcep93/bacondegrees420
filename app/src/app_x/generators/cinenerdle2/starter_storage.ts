import { CINENERDLE_DAILY_STARTER_TITLES_STORAGE_KEY } from "./constants";
import { formatMoviePathLabel, normalizeTitle } from "./utils";

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readCinenerdleDailyStarterTitles(): string[] {
  if (!canUseLocalStorage()) {
    return [];
  }

  const rawValue = window.localStorage.getItem(CINENERDLE_DAILY_STARTER_TITLES_STORAGE_KEY);
  if (!rawValue) {
    return [];
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue)
      ? parsedValue.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeCinenerdleDailyStarterTitles(titles: string[]): void {
  if (!canUseLocalStorage()) {
    return;
  }

  const uniqueTitles = Array.from(
    new Set(
      titles
        .map((title) => title.trim())
        .filter(Boolean),
    ),
  );
  window.localStorage.setItem(
    CINENERDLE_DAILY_STARTER_TITLES_STORAGE_KEY,
    JSON.stringify(uniqueTitles),
  );
}

export function isCinenerdleDailyStarterTitle(title: string): boolean {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) {
    return false;
  }

  return readCinenerdleDailyStarterTitles().some(
    (starterTitle) => normalizeTitle(starterTitle) === normalizedTitle,
  );
}

export function isCinenerdleDailyStarterFilm(title: string, year = ""): boolean {
  return isCinenerdleDailyStarterTitle(formatMoviePathLabel(title, year));
}
