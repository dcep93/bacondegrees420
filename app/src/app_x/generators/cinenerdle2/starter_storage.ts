import { CINENERDLE_DAILY_STARTER_TITLES_STORAGE_KEY } from "./constants";
import { formatMoviePathLabel, normalizeTitle } from "./utils";

export type CinenerdleDailyStarterCacheEntry = {
  title: string;
  tmdbId: number | null;
};

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeStarterCacheEntry(
  value: unknown,
): CinenerdleDailyStarterCacheEntry | null {
  if (typeof value === "string") {
    const title = value.trim();
    return title
      ? {
          title,
          tmdbId: null,
        }
      : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const rawTitle = "title" in value ? value.title : "";
  const rawTmdbId = "tmdbId" in value ? value.tmdbId : null;
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  const tmdbId =
    typeof rawTmdbId === "number" && Number.isInteger(rawTmdbId) && rawTmdbId > 0
      ? rawTmdbId
      : null;

  return title
    ? {
        title,
        tmdbId,
      }
    : null;
}

export function readCinenerdleDailyStarterEntries(): CinenerdleDailyStarterCacheEntry[] {
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
      ? parsedValue.flatMap((value) => {
          const normalizedEntry = normalizeStarterCacheEntry(value);
          return normalizedEntry ? [normalizedEntry] : [];
        })
      : [];
  } catch {
    return [];
  }
}

export function writeCinenerdleDailyStarterEntries(
  entries: CinenerdleDailyStarterCacheEntry[],
): void {
  if (!canUseLocalStorage()) {
    return;
  }

  const uniqueEntries = Array.from(
    new Map(
      entries
        .map((entry) => normalizeStarterCacheEntry(entry))
        .filter((entry): entry is CinenerdleDailyStarterCacheEntry => entry !== null)
        .map((entry) => [normalizeTitle(entry.title), entry] as const),
    ).values(),
  );
  window.localStorage.setItem(
    CINENERDLE_DAILY_STARTER_TITLES_STORAGE_KEY,
    JSON.stringify(uniqueEntries),
  );
}

export function readCinenerdleDailyStarterTitles(): string[] {
  return readCinenerdleDailyStarterEntries().map((entry) => entry.title);
}

export function writeCinenerdleDailyStarterTitles(titles: string[]): void {
  writeCinenerdleDailyStarterEntries(
    titles.map((title) => ({
      title,
      tmdbId: null,
    })),
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
