import { normalizeName, normalizeTitle } from "./utils";

export const CINENERDLE_ITEM_ATTRS_STORAGE_KEY = "bacondegrees420.cinenerdle-item-attrs.v1";
export const CINENERDLE_ITEM_ATTRS_UPDATED_EVENT = "cinenerdle-item-attrs-updated";

export type CinenerdleItemAttrBucket = "film" | "person";

export type CinenerdleItemAttrs = {
  film: Record<string, string[]>;
  person: Record<string, string[]>;
};

export type CinenerdleItemAttrTarget = {
  bucket: CinenerdleItemAttrBucket;
  id: string;
  name: string;
};

export type CinenerdleItemAttrsMutationResult = {
  changedTargets: CinenerdleItemAttrTarget[];
  nextItemAttrsSnapshot: CinenerdleItemAttrs;
};

function canUseLocalStorage(): boolean {
  return getLocalStorage() !== null;
}

function getLocalStorage(): Storage | null {
  if (
    typeof window !== "undefined" &&
    typeof window.localStorage !== "undefined" &&
    typeof window.localStorage.getItem === "function" &&
    typeof window.localStorage.setItem === "function"
  ) {
    return window.localStorage;
  }

  if (
    typeof globalThis !== "undefined" &&
    "localStorage" in globalThis &&
    globalThis.localStorage &&
    typeof globalThis.localStorage.getItem === "function" &&
    typeof globalThis.localStorage.setItem === "function"
  ) {
    return globalThis.localStorage;
  }

  return null;
}

export function createEmptyItemAttrs(): CinenerdleItemAttrs {
  return {
    film: {},
    person: {},
  };
}

function getGraphemeSegments(value: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
      ({ segment }) => segment,
    );
  }

  return Array.from(value);
}

export function getFirstItemAttrChar(value: string): string | null {
  const firstChar = getGraphemeSegments(value).find((segment) => segment.trim().length > 0) ?? null;
  return firstChar && firstChar.trim().length > 0 ? firstChar : null;
}

export function normalizeItemAttrChars(value: unknown): string[] {
  const rawChars =
    typeof value === "string"
      ? getGraphemeSegments(value)
      : Array.isArray(value)
        ? value.flatMap((entry) => (typeof entry === "string" ? getGraphemeSegments(entry) : []))
        : [];
  const seenChars = new Set<string>();
  const normalizedChars: string[] = [];

  rawChars.forEach((candidateChar) => {
    if (!candidateChar || candidateChar.trim().length === 0 || seenChars.has(candidateChar)) {
      return;
    }

    seenChars.add(candidateChar);
    normalizedChars.push(candidateChar);
  });

  return normalizedChars;
}

function normalizeBucketEntries(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string[]>>((entries, [key, rawChars]) => {
    const normalizedKey = typeof key === "string" ? key.trim() : "";
    const normalizedChars = normalizeItemAttrChars(rawChars);
    if (!normalizedKey || normalizedChars.length === 0) {
      return entries;
    }

    entries[normalizedKey] = normalizedChars;
    return entries;
  }, {});
}

function dispatchItemAttrsUpdatedEvent(detail: CinenerdleItemAttrsMutationResult) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(CINENERDLE_ITEM_ATTRS_UPDATED_EVENT, {
    detail,
  }));
}

export function readCinenerdleItemAttrs(): CinenerdleItemAttrs {
  if (!canUseLocalStorage()) {
    return createEmptyItemAttrs();
  }

  const localStorage = getLocalStorage();
  if (!localStorage) {
    return createEmptyItemAttrs();
  }

  const rawValue = localStorage.getItem(CINENERDLE_ITEM_ATTRS_STORAGE_KEY);
  if (!rawValue) {
    return createEmptyItemAttrs();
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    if (!parsedValue || typeof parsedValue !== "object") {
      return createEmptyItemAttrs();
    }

    return {
      film: normalizeBucketEntries("film" in parsedValue ? parsedValue.film : {}),
      person: normalizeBucketEntries("person" in parsedValue ? parsedValue.person : {}),
    };
  } catch {
    return createEmptyItemAttrs();
  }
}

export function normalizeCinenerdleItemAttrs(
  nextItemAttrs: CinenerdleItemAttrs,
): CinenerdleItemAttrs {
  return {
    film: normalizeBucketEntries(nextItemAttrs.film),
    person: normalizeBucketEntries(nextItemAttrs.person),
  };
}

export function writeCinenerdleItemAttrs(
  nextItemAttrs: CinenerdleItemAttrs,
  changedTargets: CinenerdleItemAttrTarget[] = [],
): CinenerdleItemAttrs {
  const normalizedItemAttrs = normalizeCinenerdleItemAttrs(nextItemAttrs);

  if (!canUseLocalStorage()) {
    return normalizedItemAttrs;
  }

  getLocalStorage()?.setItem(
    CINENERDLE_ITEM_ATTRS_STORAGE_KEY,
    JSON.stringify(normalizedItemAttrs),
  );
  dispatchItemAttrsUpdatedEvent({
    changedTargets,
    nextItemAttrsSnapshot: normalizedItemAttrs,
  });
  return normalizedItemAttrs;
}

export function encodeItemAttrToken(value: string): string {
  return encodeURIComponent(value.trim().replace(/\s+/g, " "))
    .replace(/%20/g, "+")
    .replace(/%3A/gi, ":");
}

export function decodeItemAttrToken(value: string): string {
  return decodeURIComponent(value.replaceAll("+", "%20"));
}

export function getCinenerdleItemAttrTargetFromCard(args: {
  key: string;
  kind: "movie" | "person";
  name: string;
}): CinenerdleItemAttrTarget | null {
  const delimiterIndex = args.key.indexOf(":");
  const keyPrefix = delimiterIndex >= 0 ? args.key.slice(0, delimiterIndex) : "";
  const rawId = delimiterIndex >= 0 ? args.key.slice(delimiterIndex + 1) : "";

  if (!rawId) {
    return null;
  }

  if (args.kind === "movie" && keyPrefix === "movie") {
    return {
      bucket: "film",
      id: rawId || normalizeTitle(args.name),
      name: args.name,
    };
  }

  if (args.kind === "person" && keyPrefix === "person") {
    return {
      bucket: "person",
      id: rawId || normalizeName(args.name),
      name: args.name,
    };
  }

  return null;
}

export function getItemAttrsForTargetFromSnapshot(
  itemAttrsSnapshot: CinenerdleItemAttrs,
  target: CinenerdleItemAttrTarget,
): string[] {
  return itemAttrsSnapshot[target.bucket][target.id] ?? [];
}

export function getItemAttrsForTarget(target: CinenerdleItemAttrTarget): string[] {
  return getItemAttrsForTargetFromSnapshot(readCinenerdleItemAttrs(), target);
}

function getUniqueChangedTargets(
  targets: CinenerdleItemAttrTarget[],
): CinenerdleItemAttrTarget[] {
  const seenTargets = new Set<string>();

  return targets.filter((target) => {
    const fingerprint = `${target.bucket}:${target.id}`;
    if (seenTargets.has(fingerprint)) {
      return false;
    }

    seenTargets.add(fingerprint);
    return true;
  });
}

export function addItemAttrToSnapshot(
  itemAttrsSnapshot: CinenerdleItemAttrs,
  target: CinenerdleItemAttrTarget,
  candidateChar: string,
): CinenerdleItemAttrsMutationResult {
  const normalizedChar = getFirstItemAttrChar(candidateChar);
  if (!normalizedChar) {
    return {
      changedTargets: [],
      nextItemAttrsSnapshot: itemAttrsSnapshot,
    };
  }

  const currentChars = getItemAttrsForTargetFromSnapshot(itemAttrsSnapshot, target);
  if (currentChars.includes(normalizedChar)) {
    return {
      changedTargets: [],
      nextItemAttrsSnapshot: itemAttrsSnapshot,
    };
  }

  return {
    changedTargets: [target],
    nextItemAttrsSnapshot: normalizeCinenerdleItemAttrs({
      ...itemAttrsSnapshot,
      [target.bucket]: {
        ...itemAttrsSnapshot[target.bucket],
        [target.id]: [...currentChars, normalizedChar],
      },
    }),
  };
}

export function removeItemAttrFromSnapshot(
  itemAttrsSnapshot: CinenerdleItemAttrs,
  target: CinenerdleItemAttrTarget,
  candidateChar: string,
): CinenerdleItemAttrsMutationResult {
  const normalizedChar = getFirstItemAttrChar(candidateChar);
  if (!normalizedChar) {
    return {
      changedTargets: [],
      nextItemAttrsSnapshot: itemAttrsSnapshot,
    };
  }

  const currentChars = getItemAttrsForTargetFromSnapshot(itemAttrsSnapshot, target);
  const nextChars = currentChars.filter((itemAttr) => itemAttr !== normalizedChar);
  if (nextChars.length === currentChars.length) {
    return {
      changedTargets: [],
      nextItemAttrsSnapshot: itemAttrsSnapshot,
    };
  }

  const nextBucketEntries = { ...itemAttrsSnapshot[target.bucket] };
  if (nextChars.length > 0) {
    nextBucketEntries[target.id] = nextChars;
  } else {
    delete nextBucketEntries[target.id];
  }

  return {
    changedTargets: [target],
    nextItemAttrsSnapshot: normalizeCinenerdleItemAttrs({
      ...itemAttrsSnapshot,
      [target.bucket]: nextBucketEntries,
    }),
  };
}

export function replaceItemAttrsInSnapshotForReferencedTargets(
  itemAttrsSnapshot: CinenerdleItemAttrs,
  referencedTargets: CinenerdleItemAttrTarget[],
  replacementItemAttrs: CinenerdleItemAttrs,
): CinenerdleItemAttrsMutationResult {
  const nextItemAttrs: CinenerdleItemAttrs = {
    film: { ...itemAttrsSnapshot.film },
    person: { ...itemAttrsSnapshot.person },
  };
  const changedTargets = getUniqueChangedTargets(referencedTargets);

  changedTargets.forEach((target) => {
    const nextChars = normalizeItemAttrChars(replacementItemAttrs[target.bucket][target.id] ?? []);
    if (nextChars.length > 0) {
      nextItemAttrs[target.bucket][target.id] = nextChars;
      return;
    }

    delete nextItemAttrs[target.bucket][target.id];
  });

  return {
    changedTargets,
    nextItemAttrsSnapshot: normalizeCinenerdleItemAttrs(nextItemAttrs),
  };
}

export function addItemAttrToTarget(
  target: CinenerdleItemAttrTarget,
  candidateChar: string,
): string[] {
  const currentItemAttrs = readCinenerdleItemAttrs();
  const result = addItemAttrToSnapshot(currentItemAttrs, target, candidateChar);
  if (result.nextItemAttrsSnapshot !== currentItemAttrs) {
    writeCinenerdleItemAttrs(result.nextItemAttrsSnapshot, result.changedTargets);
  }

  return getItemAttrsForTargetFromSnapshot(result.nextItemAttrsSnapshot, target);
}

export function removeItemAttrFromTarget(
  target: CinenerdleItemAttrTarget,
  candidateChar: string,
): string[] {
  const currentItemAttrs = readCinenerdleItemAttrs();
  const result = removeItemAttrFromSnapshot(currentItemAttrs, target, candidateChar);
  if (result.nextItemAttrsSnapshot !== currentItemAttrs) {
    writeCinenerdleItemAttrs(result.nextItemAttrsSnapshot, result.changedTargets);
  }

  return getItemAttrsForTargetFromSnapshot(result.nextItemAttrsSnapshot, target);
}

export function replaceItemAttrsForReferencedTargets(
  referencedTargets: CinenerdleItemAttrTarget[],
  replacementItemAttrs: CinenerdleItemAttrs,
): CinenerdleItemAttrs {
  const currentItemAttrs = readCinenerdleItemAttrs();
  const result = replaceItemAttrsInSnapshotForReferencedTargets(
    currentItemAttrs,
    referencedTargets,
    replacementItemAttrs,
  );
  return writeCinenerdleItemAttrs(result.nextItemAttrsSnapshot, result.changedTargets);
}
