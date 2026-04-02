import {
  getMovieConnectionEntityKey,
  getPersonConnectionEntityKey,
} from "./generators/cinenerdle2/connection_graph";
import {
  batchCinenerdleRecordsUpdatedEvents,
  getFilmRecordById,
  getFilmRecordByTitleAndYear,
  getPersonRecordById,
  getPersonRecordByName,
} from "./generators/cinenerdle2/indexed_db";
import {
  hasMovieFullState,
  hasPersonFullState,
  prepareConnectionEntityForPreview,
  type PreviewConnectionEntityHydrationTarget,
} from "./generators/cinenerdle2/tmdb";
import {
  getValidTmdbEntityId,
  parseMoviePathLabel,
} from "./generators/cinenerdle2/utils";
import {
  resolveConnectionBoostPreview,
  type ConnectionBoostPreview,
  type ConnectionBoostPreviewEntity,
} from "./connection_boost_preview";
import {
  resolveConnectionMatchupPreview,
  type ConnectionMatchupPreview,
  type ConnectionMatchupPreviewEntity,
  type YoungestSelectedCard,
} from "./connection_matchup_preview";

const DEFAULT_MAX_PREVIEW_HYDRATION_PASSES = 4;

export type StableConnectionPreviewResolution = {
  boostPreview: ConnectionBoostPreview | null;
  matchupPreview: ConnectionMatchupPreview | null;
};

export type ResolveStableConnectionPreviewsOptions = {
  maxPasses?: number;
  shouldCancel?: () => boolean;
};

type PreviewBubbleEntity =
  | ConnectionBoostPreviewEntity
  | ConnectionMatchupPreviewEntity;

function shouldCancelResolution(
  options: ResolveStableConnectionPreviewsOptions,
): boolean {
  return Boolean(options.shouldCancel?.());
}

function getSelectedPersonTmdbId(
  selectedCard: Extract<YoungestSelectedCard, { kind: "person" }>,
): number | null {
  const recordTmdbId = getValidTmdbEntityId(selectedCard.record?.tmdbId ?? selectedCard.record?.id);
  if (recordTmdbId !== null) {
    return recordTmdbId;
  }

  const keyMatch = selectedCard.key.match(/^person:(\d+)$/);
  return keyMatch ? getValidTmdbEntityId(keyMatch[1]) : null;
}

function getSelectedEntityKeys(
  youngestSelectedCard: YoungestSelectedCard | null,
): Set<string> {
  const selectedKeys = new Set<string>();
  if (!youngestSelectedCard || youngestSelectedCard.kind === "cinenerdle") {
    return selectedKeys;
  }

  selectedKeys.add(youngestSelectedCard.key);
  if (youngestSelectedCard.kind === "movie") {
    selectedKeys.add(
      getMovieConnectionEntityKey(youngestSelectedCard.name, youngestSelectedCard.year),
    );
    return selectedKeys;
  }

  const tmdbId = getSelectedPersonTmdbId(youngestSelectedCard);
  selectedKeys.add(getPersonConnectionEntityKey(youngestSelectedCard.name));
  if (tmdbId !== null) {
    selectedKeys.add(getPersonConnectionEntityKey(youngestSelectedCard.name, tmdbId));
  }

  return selectedKeys;
}

function collectPreviewEntities(
  resolution: StableConnectionPreviewResolution,
): PreviewConnectionEntityHydrationTarget[] {
  const entities: PreviewBubbleEntity[] = [];

  if (resolution.boostPreview) {
    entities.push(
      resolution.boostPreview.distanceTwo,
      resolution.boostPreview.sharedConnection,
    );
  }

  if (resolution.matchupPreview) {
    entities.push(resolution.matchupPreview.counterpart);
    if (resolution.matchupPreview.kind === "versus") {
      entities.push(resolution.matchupPreview.spoiler);
    }
  }

  const entitiesByKey = new Map<string, PreviewConnectionEntityHydrationTarget>();
  entities.forEach((entity) => {
    if (!entity.key || entitiesByKey.has(entity.key)) {
      return;
    }

    entitiesByKey.set(entity.key, {
      key: entity.key,
      kind: entity.kind,
      name: entity.name,
    });
  });

  return [...entitiesByKey.values()];
}

async function isPreviewEntityFullyHydrated(
  target: PreviewConnectionEntityHydrationTarget,
): Promise<boolean> {
  if (target.kind === "movie") {
    const parsedMovie = parseMoviePathLabel(target.name);
    const movieTitle = parsedMovie.name || target.name;
    const movieYear = target.year ?? parsedMovie.year;
    const tmdbId = getValidTmdbEntityId(target.tmdbId);
    const localMovieRecord =
      (tmdbId !== null ? await getFilmRecordById(tmdbId) : null) ??
      (await getFilmRecordByTitleAndYear(movieTitle, movieYear));
    return hasMovieFullState(localMovieRecord);
  }

  const tmdbId = getValidTmdbEntityId(target.tmdbId) ??
    (() => {
      const keyMatch = target.key.match(/^person:(\d+)$/);
      return keyMatch ? getValidTmdbEntityId(keyMatch[1]) : null;
    })();
  const localPersonRecord = tmdbId !== null
    ? await getPersonRecordById(tmdbId)
    : await getPersonRecordByName(target.name);
  return hasPersonFullState(localPersonRecord);
}

async function resolvePreviewPass(
  youngestSelectedCard: YoungestSelectedCard | null,
): Promise<StableConnectionPreviewResolution> {
  const [
    boostPreview,
    matchupPreview,
  ] = await Promise.all([
    resolveConnectionBoostPreview(youngestSelectedCard),
    resolveConnectionMatchupPreview(youngestSelectedCard),
  ]);

  return {
    boostPreview,
    matchupPreview,
  };
}

export async function resolveStableConnectionPreviews(
  youngestSelectedCard: YoungestSelectedCard | null,
  options: ResolveStableConnectionPreviewsOptions = {},
): Promise<StableConnectionPreviewResolution> {
  const maxPasses = Math.max(1, options.maxPasses ?? DEFAULT_MAX_PREVIEW_HYDRATION_PASSES);
  const selectedEntityKeys = getSelectedEntityKeys(youngestSelectedCard);
  const attemptedHydrationKeys = new Set<string>();
  let latestResolution: StableConnectionPreviewResolution = {
    boostPreview: null,
    matchupPreview: null,
  };
  let didHydrateInLastPass = false;

  for (let passIndex = 0; passIndex < maxPasses; passIndex += 1) {
    if (shouldCancelResolution(options)) {
      return latestResolution;
    }

    latestResolution = await resolvePreviewPass(youngestSelectedCard);
    if (shouldCancelResolution(options)) {
      return latestResolution;
    }

    const nextHydrationTargets: PreviewConnectionEntityHydrationTarget[] = [];
    for (const target of collectPreviewEntities(latestResolution)) {
      if (
        selectedEntityKeys.has(target.key) ||
        attemptedHydrationKeys.has(target.key) ||
        await isPreviewEntityFullyHydrated(target)
      ) {
        continue;
      }

      nextHydrationTargets.push(target);
    }

    if (nextHydrationTargets.length === 0) {
      return latestResolution;
    }

    nextHydrationTargets.forEach((target) => {
      attemptedHydrationKeys.add(target.key);
    });
    didHydrateInLastPass = true;

    await batchCinenerdleRecordsUpdatedEvents(async () => {
      await Promise.allSettled(
        nextHydrationTargets.map((target) => prepareConnectionEntityForPreview(target)),
      );
    });
  }

  if (didHydrateInLastPass && !shouldCancelResolution(options)) {
    return resolvePreviewPass(youngestSelectedCard);
  }

  return latestResolution;
}
