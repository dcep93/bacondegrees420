/* eslint-disable react-refresh/only-export-components */
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createAssociatedEntityCard, type ResolvedAssociatedEntity } from "../associated_entity_cards";
import { enrichCinenerdleCardWithItemAttrs } from "../generators/cinenerdle2/card_item_attrs";
import {
  createCinenerdleRootCard,
  createMovieRootCard,
  createPersonRootCard,
} from "../generators/cinenerdle2/cards";
import { CINENERDLE_ICON_URL, TMDB_ICON_URL } from "../generators/cinenerdle2/constants";
import {
  CinenerdleEntityCard,
  type RenderableCinenerdleEntityCard,
} from "../generators/cinenerdle2/entity_card";
import type { ConnectionEntity } from "../generators/cinenerdle2/connection_graph";
import {
  getFilmRecordById,
  getFilmRecordByTitleAndYear,
  getPersonRecordById,
  getPersonRecordByName,
} from "../generators/cinenerdle2/indexed_db";
import {
  addItemAttrToTarget,
  CINENERDLE_ITEM_ATTRS_UPDATED_EVENT,
  getCinenerdleItemAttrTargetFromCard,
  readCinenerdleItemAttrs,
  removeItemAttrFromTarget,
  type CinenerdleItemAttrs,
  type CinenerdleItemAttrsMutationResult,
} from "../generators/cinenerdle2/item_attrs";
import { getResolvedPersonMovieConnectionKeys } from "../generators/cinenerdle2/records";
import type { FilmRecord, PersonRecord } from "../generators/cinenerdle2/types";
import type { CinenerdleCard } from "../generators/cinenerdle2/view_types";
import {
  formatMoviePathLabel,
  getValidTmdbEntityId,
  normalizeName,
} from "../generators/cinenerdle2/utils";
import {
  createCardViewModel,
  getCardTmdbRowTooltipText,
  getParentMovieRankForPerson,
  getParentPersonRankForMovie,
} from "../generators/cinenerdle2/view_model";
import { joinClassNames } from "./ui_utils";

type ConnectionCardEntity = Extract<CinenerdleCard, { kind: "cinenerdle" | "movie" | "person" }>;

type ResolvedConnectionCardEntity = {
  entity: ConnectionEntity;
  card: ConnectionCardEntity;
  movieRecord: FilmRecord | null;
  personRecord: PersonRecord | null;
};

function createConnectionCardSources(entity: ConnectionEntity) {
  if (entity.kind === "cinenerdle") {
    return [{ iconUrl: CINENERDLE_ICON_URL, label: "Cinenerdle" }];
  }

  return entity.hasCachedTmdbSource
    ? [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }]
    : [];
}

function createFallbackConnectionCard(entity: ConnectionEntity): ConnectionCardEntity {
  if (entity.kind === "cinenerdle") {
    return createCinenerdleRootCard(entity.connectionCount) as Extract<
      CinenerdleCard,
      { kind: "cinenerdle" }
    >;
  }

  const creditLines =
    entity.associationCreditLines && entity.associationCreditLines.length > 0
      ? entity.associationCreditLines
      : undefined;
  const sharedCardProps = {
    key: entity.key,
    name: entity.name,
    imageUrl: entity.imageUrl ?? null,
    popularity: entity.popularity ?? 0,
    popularitySource: null,
    connectionCount: entity.connectionCount,
    connectionRank: entity.connectionRank ?? null,
    connectionOrder: null,
    connectionParentLabel: entity.connectionParentLabel ?? null,
    creditLines,
    sources: createConnectionCardSources(entity),
    status: null,
  } satisfies Omit<ConnectionCardEntity, "kind" | "subtitle" | "subtitleDetail" | "record">;

  if (entity.kind === "movie") {
    return {
      ...sharedCardProps,
      kind: "movie",
      year: entity.year,
      subtitle: entity.associationSubtitle ?? (entity.year || "Movie"),
      subtitleDetail: entity.associationSubtitleDetail ?? "",
      voteAverage: null,
      voteCount: null,
      record: null,
    };
  }

  return {
    ...sharedCardProps,
    kind: "person",
    subtitle: entity.associationSubtitle ?? "Person",
    subtitleDetail: entity.associationSubtitleDetail ?? "",
    record: null,
  };
}

async function getMovieRecordForConnectionEntity(
  entity: ConnectionEntity,
): Promise<FilmRecord | null> {
  if (entity.kind !== "movie") {
    return null;
  }

  const validMovieId = getValidTmdbEntityId(entity.tmdbId);
  if (validMovieId !== null) {
    const movieRecord = await getFilmRecordById(validMovieId);
    if (movieRecord) {
      return movieRecord;
    }
  }

  return getFilmRecordByTitleAndYear(entity.name, entity.year);
}

async function getPersonRecordForConnectionEntity(
  entity: ConnectionEntity,
): Promise<PersonRecord | null> {
  if (entity.kind !== "person") {
    return null;
  }

  const validPersonId = getValidTmdbEntityId(entity.tmdbId);
  if (validPersonId !== null) {
    const personRecord = await getPersonRecordById(validPersonId);
    if (personRecord) {
      return personRecord;
    }
  }

  return getPersonRecordByName(normalizeName(entity.name));
}

async function resolveConnectionCardEntity(
  entity: ConnectionEntity,
): Promise<ResolvedConnectionCardEntity> {
  if (entity.kind === "cinenerdle") {
    return {
      entity,
      card: createFallbackConnectionCard(entity),
      movieRecord: null,
      personRecord: null,
    };
  }

  if (entity.kind === "movie") {
    const movieRecord = await getMovieRecordForConnectionEntity(entity);
    const rootCard = movieRecord
      ? createMovieRootCard(movieRecord, entity.name)
      : createFallbackConnectionCard(entity);
    return {
      entity,
      card: {
        ...rootCard,
        connectionRank: entity.connectionRank ?? null,
        connectionParentLabel: entity.connectionParentLabel ?? null,
      } as Extract<CinenerdleCard, { kind: "movie" }>,
      movieRecord,
      personRecord: null,
    };
  }

  const personRecord = await getPersonRecordForConnectionEntity(entity);
  const rootCard = personRecord
    ? createPersonRootCard(personRecord, entity.name)
    : createFallbackConnectionCard(entity);
  return {
    entity,
    card: {
      ...rootCard,
      connectionRank: entity.connectionRank ?? null,
      connectionParentLabel: entity.connectionParentLabel ?? null,
    } as Extract<CinenerdleCard, { kind: "person" }>,
    movieRecord: null,
    personRecord,
  };
}

function getResolvedConnectionCount(resolvedEntity: ResolvedConnectionCardEntity): number {
  return typeof resolvedEntity.card.connectionCount === "number"
    ? resolvedEntity.card.connectionCount
    : Math.max(resolvedEntity.entity.connectionCount, 1);
}

function toResolvedAssociatedConnectionEntity(
  resolvedEntity: ResolvedConnectionCardEntity,
): ResolvedAssociatedEntity {
  return {
    kind: resolvedEntity.entity.kind,
    name: resolvedEntity.entity.name,
    year: resolvedEntity.entity.year,
    tmdbId: resolvedEntity.entity.kind === "person" ? resolvedEntity.entity.tmdbId : null,
    connectionCount: getResolvedConnectionCount(resolvedEntity),
    movieRecord: resolvedEntity.movieRecord,
    personRecord: resolvedEntity.personRecord,
  };
}

async function buildPopularityByMovieKey(
  personRecord: PersonRecord | null,
): Promise<Map<number, number>> {
  if (!personRecord) {
    return new Map();
  }

  const movieKeys = Array.from(new Set(
    getResolvedPersonMovieConnectionKeys(personRecord).flatMap((movieId) => {
      const validMovieId = getValidTmdbEntityId(movieId);
      return validMovieId === null ? [] : [validMovieId];
    }),
  ));
  const movieRecords = await Promise.all(
    movieKeys.map(async (movieKey) => [movieKey, await getFilmRecordById(movieKey)] as const),
  );

  return new Map(
    movieRecords.map(([movieKey, movieRecord]) => [movieKey, movieRecord?.popularity ?? 0] as const),
  );
}

async function buildPopularityByPersonId(
  movieRecord: FilmRecord | null,
): Promise<Map<number, number>> {
  if (!movieRecord) {
    return new Map();
  }

  const personIds = Array.from(new Set(
    movieRecord.personConnectionKeys.flatMap((personId) => {
      const validPersonId = getValidTmdbEntityId(personId);
      return validPersonId === null ? [] : [validPersonId];
    }),
  ));
  const personRecords = await Promise.all(
    personIds.map(async (personId) => [personId, await getPersonRecordById(personId)] as const),
  );

  return new Map(
    personRecords.map(([personId, personRecord]) => [
      personId,
      personRecord?.rawTmdbPerson?.popularity ?? 0,
    ] as const),
  );
}

async function createAssociatedConnectionCard(
  previousEntity: ResolvedConnectionCardEntity | null,
  entity: ResolvedConnectionCardEntity,
): Promise<ConnectionCardEntity> {
  if (!previousEntity) {
    return entity.card;
  }

  if (previousEntity.card.kind === "person" && entity.card.kind === "movie") {
    const associatedCard = createAssociatedEntityCard(
      toResolvedAssociatedConnectionEntity(previousEntity),
      toResolvedAssociatedConnectionEntity(entity),
    );
    if (!associatedCard || associatedCard.card.kind !== "movie") {
      return entity.card;
    }

    const popularityByPersonId = await buildPopularityByPersonId(entity.movieRecord);
    return {
      ...associatedCard.card,
      connectionOrder: associatedCard.connectionOrder,
      connectionParentLabel: previousEntity.card.name,
      connectionRank: getParentPersonRankForMovie(
        entity.movieRecord,
        previousEntity.personRecord,
        popularityByPersonId,
      ),
    };
  }

  if (previousEntity.card.kind === "movie" && entity.card.kind === "person") {
    const associatedCard = createAssociatedEntityCard(
      toResolvedAssociatedConnectionEntity(previousEntity),
      toResolvedAssociatedConnectionEntity(entity),
    );
    if (!associatedCard || associatedCard.card.kind !== "person") {
      return entity.card;
    }

    const popularityByMovieKey = await buildPopularityByMovieKey(entity.personRecord);
    return {
      ...associatedCard.card,
      connectionOrder: associatedCard.connectionOrder,
      connectionParentLabel: formatMoviePathLabel(previousEntity.card.name, previousEntity.card.year),
      connectionRank: getParentMovieRankForPerson(
        previousEntity.movieRecord,
        entity.personRecord,
        popularityByMovieKey,
      ),
    };
  }

  return entity.card;
}

function createRenderableResolvedConnectionCard(
  card: ConnectionCardEntity,
  entity: ConnectionEntity,
  selectedAncestorCards: CinenerdleCard[],
): RenderableCinenerdleEntityCard {
  const viewModel = createCardViewModel(card, {
    isSelected: false,
  });

  if (viewModel.kind === "break" || viewModel.kind === "dbinfo") {
    throw new Error("Connection rows cannot render non-entity cards");
  }

  return {
    ...viewModel,
    hasCachedTmdbSource: entity.kind === "cinenerdle"
      ? false
      : entity.hasCachedTmdbSource || viewModel.hasCachedTmdbSource,
    onExplicitTmdbRowClick: null,
    onTmdbRowClick: null,
    tmdbTooltipText: card.kind === "movie" || card.kind === "person"
      ? getCardTmdbRowTooltipText(card, selectedAncestorCards)
      : null,
  };
}

function createFallbackRenderableConnectionCard(
  entity: ConnectionEntity,
  options?: {
    itemAttrsSnapshot?: CinenerdleItemAttrs;
    previousEntity?: ConnectionEntity | null;
  },
): RenderableCinenerdleEntityCard {
  const fallbackCard = createFallbackConnectionCard(entity);
  const enrichedCard = enrichCinenerdleCardWithItemAttrs(
    fallbackCard,
    options?.itemAttrsSnapshot ?? readCinenerdleItemAttrs(),
  ) as ConnectionCardEntity;
  const ancestorCards = options?.previousEntity
    ? [createFallbackConnectionCard(options.previousEntity)]
    : [];

  return createRenderableResolvedConnectionCard(enrichedCard, entity, ancestorCards);
}

export async function buildRenderableConnectionCard(
  entity: ConnectionEntity,
  options?: {
    itemAttrsSnapshot?: CinenerdleItemAttrs;
    previousEntity?: ConnectionEntity | null;
  },
): Promise<RenderableCinenerdleEntityCard> {
  const itemAttrsSnapshot = options?.itemAttrsSnapshot ?? readCinenerdleItemAttrs();
  const resolvedEntity = await resolveConnectionCardEntity(entity);
  const resolvedPreviousEntity = options?.previousEntity
    ? await resolveConnectionCardEntity(options.previousEntity)
    : null;
  const nextCard = enrichCinenerdleCardWithItemAttrs(
    await createAssociatedConnectionCard(resolvedPreviousEntity, resolvedEntity),
    itemAttrsSnapshot,
  ) as ConnectionCardEntity;

  return createRenderableResolvedConnectionCard(
    nextCard,
    entity,
    resolvedPreviousEntity ? [resolvedPreviousEntity.card] : [],
  );
}

export default function ConnectionEntityCard({
  entity,
  dimmed,
  onCardClick,
  onNameClick,
  previousEntity = null,
}: {
  entity: ConnectionEntity;
  dimmed?: boolean;
  onCardClick?: () => void;
  onNameClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  previousEntity?: ConnectionEntity | null;
}) {
  const [renderableCard, setRenderableCard] = useState<RenderableCinenerdleEntityCard>(() =>
    createFallbackRenderableConnectionCard(entity, {
      itemAttrsSnapshot: readCinenerdleItemAttrs(),
      previousEntity,
    })
  );
  const buildRequestIdRef = useRef(0);

  const requestRenderableCardBuild = useEffectEvent((itemAttrsSnapshot?: CinenerdleItemAttrs) => {
    const snapshot = itemAttrsSnapshot ?? readCinenerdleItemAttrs();
    const requestId = buildRequestIdRef.current + 1;
    buildRequestIdRef.current = requestId;

    void buildRenderableConnectionCard(entity, {
      itemAttrsSnapshot: snapshot,
      previousEntity,
    })
      .then((nextCard) => {
        if (buildRequestIdRef.current !== requestId) {
          return;
        }

        startTransition(() => {
          setRenderableCard(nextCard);
        });
      })
      .catch(() => {
        if (buildRequestIdRef.current !== requestId) {
          return;
        }

        startTransition(() => {
          setRenderableCard(createFallbackRenderableConnectionCard(entity, {
            itemAttrsSnapshot: snapshot,
            previousEntity,
          }));
        });
      });
  });

  useEffect(() => {
    const snapshot = readCinenerdleItemAttrs();
    startTransition(() => {
      setRenderableCard(createFallbackRenderableConnectionCard(entity, {
        itemAttrsSnapshot: snapshot,
        previousEntity,
      }));
    });
    requestRenderableCardBuild(snapshot);
  }, [entity, previousEntity]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleCinenerdleItemAttrsUpdated(event: Event) {
      const itemAttrsSnapshot =
        (event as CustomEvent<CinenerdleItemAttrsMutationResult>).detail?.nextItemAttrsSnapshot;
      requestRenderableCardBuild(itemAttrsSnapshot);
    }

    window.addEventListener(CINENERDLE_ITEM_ATTRS_UPDATED_EVENT, handleCinenerdleItemAttrsUpdated);
    return () => {
      window.removeEventListener(
        CINENERDLE_ITEM_ATTRS_UPDATED_EVENT,
        handleCinenerdleItemAttrsUpdated,
      );
    };
  }, []);

  let itemAttrTarget: ReturnType<typeof getCinenerdleItemAttrTargetFromCard> = null;
  if (renderableCard.kind === "movie" || renderableCard.kind === "person") {
    itemAttrTarget = getCinenerdleItemAttrTargetFromCard({
      key: renderableCard.key,
      kind: renderableCard.kind,
      name: renderableCard.name,
    });
  }

  return (
    <CinenerdleEntityCard
      card={renderableCard}
      className={joinClassNames(
        onCardClick && "bacon-connection-node-clickable",
        dimmed && "bacon-connection-node-dimmed",
      )}
      onAddItemAttr={itemAttrTarget
        ? (nextChar) => {
            addItemAttrToTarget(itemAttrTarget, nextChar);
          }
        : undefined}
      onCardClick={onCardClick}
      onRemoveItemAttr={itemAttrTarget
        ? (itemAttr) => {
            removeItemAttrFromTarget(itemAttrTarget, itemAttr);
          }
        : undefined}
      onTitleClick={onNameClick
        ? (event) => {
            onNameClick(event as MouseEvent<HTMLButtonElement>);
          }
        : undefined}
      titleElement="button"
    />
  );
}
