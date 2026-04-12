import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const indexedDbMock = vi.hoisted(() => ({
  getFilmRecordById: vi.fn(),
  getFilmRecordByTitleAndYear: vi.fn(),
  getPersonRecordById: vi.fn(),
  getPersonRecordByName: vi.fn(),
}));

vi.mock("../generators/cinenerdle2/indexed_db", async () => {
  const actual = await vi.importActual("../generators/cinenerdle2/indexed_db");
  return {
    ...actual,
    ...indexedDbMock,
  };
});

import ConnectionEntityCard, {
  buildRenderableConnectionCard,
} from "../components/connection_entity_card";
import { CINENERDLE_ITEM_ATTRS_STORAGE_KEY } from "../generators/cinenerdle2/item_attrs";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonRecord,
  makeTmdbMovieSearchResult,
  makeTmdbPersonSearchResult,
} from "../generators/cinenerdle2/__tests__/factories";
import type { ConnectionEntity } from "../generators/cinenerdle2/connection_graph";

function makeConnectionEntity(
  overrides: Partial<ConnectionEntity> = {},
): ConnectionEntity {
  return {
    key: "movie:heat:1995",
    kind: "movie",
    name: "Heat",
    year: "1995",
    tmdbId: 321,
    label: "Heat (1995)",
    connectionCount: 12,
    hasCachedTmdbSource: true,
    imageUrl: null,
    popularity: 62.46,
    connectionRank: null,
    ...overrides,
  };
}

describe("ConnectionEntityCard", () => {
  beforeEach(() => {
    indexedDbMock.getFilmRecordById.mockReset();
    indexedDbMock.getFilmRecordByTitleAndYear.mockReset();
    indexedDbMock.getPersonRecordById.mockReset();
    indexedDbMock.getPersonRecordByName.mockReset();

    indexedDbMock.getFilmRecordById.mockResolvedValue(null);
    indexedDbMock.getFilmRecordByTitleAndYear.mockResolvedValue(null);
    indexedDbMock.getPersonRecordById.mockResolvedValue(null);
    indexedDbMock.getPersonRecordByName.mockResolvedValue(null);

    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        clear: () => {
          storage.clear();
        },
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => {
          storage.delete(key);
        },
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });
  });

  it("renders direct attrs from storage in the connection card extra row", () => {
    globalThis.localStorage.setItem(CINENERDLE_ITEM_ATTRS_STORAGE_KEY, JSON.stringify({
      film: {
        "heat:1995": ["🔥"],
      },
      person: {},
    }));

    const html = renderToStaticMarkup(
      <ConnectionEntityCard entity={makeConnectionEntity()} />,
    );

    expect(html).toContain("cinenerdle-card-extra-row");
    expect(html).toContain("Remove 🔥 from Heat");
  });

  it("uses the shared read-only footer tooltip overlay for connection cards", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard entity={makeConnectionEntity()} />,
    );

    expect(html).toContain("cinenerdle-card-chip-tooltip-anchor cinenerdle-card-footer-tooltip-anchor");
    expect(html).toContain("cinenerdle-card-footer-tooltip-panel");
    expect(html).not.toContain("TMDb movie popularity from the cached movie record.");
    expect(html.match(/role="tooltip"/g)).toHaveLength(1);
  });

  it("builds record-backed association cards with inherited attrs", async () => {
    const heatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      popularity: 66,
      personConnectionKeys: [60],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 321,
        title: "Heat",
        release_date: "1995-12-15",
        popularity: 66,
      }),
    });
    const pacinoRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: [321],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 60,
        name: "Al Pacino",
        popularity: 88,
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 321,
            title: "Heat",
            release_date: "1995-12-15",
            popularity: 66,
            character: "Neil McCauley",
          }),
        ],
        crew: [],
      },
    });

    indexedDbMock.getFilmRecordById.mockImplementation(async (tmdbId: number | string) =>
      Number(tmdbId) === 321 ? heatRecord : null,
    );
    indexedDbMock.getFilmRecordByTitleAndYear.mockImplementation(async (title: string, year: string) =>
      title === "Heat" && year === "1995" ? heatRecord : null,
    );
    indexedDbMock.getPersonRecordById.mockImplementation(async (tmdbId: number | string) =>
      Number(tmdbId) === 60 ? pacinoRecord : null,
    );
    indexedDbMock.getPersonRecordByName.mockImplementation(async (personName: string) =>
      personName === "al pacino" ? pacinoRecord : null,
    );

    const renderableCard = await buildRenderableConnectionCard(
      makeConnectionEntity({
        associationSubtitle: "1995 • Cast as",
        associationSubtitleDetail: "Neil McCauley",
      }),
      {
        itemAttrsSnapshot: {
          film: {
            "321": ["🔥"],
          },
          person: {
            "60": ["⭐"],
          },
        },
        previousEntity: makeConnectionEntity({
          key: "person:60",
          kind: "person",
          name: "Al Pacino",
          year: "",
          tmdbId: 60,
          label: "Al Pacino",
          connectionCount: 1,
          hasCachedTmdbSource: true,
          popularity: 88,
        }),
      },
    );

    expect(renderableCard).toMatchObject({
      kind: "movie",
      subtitle: "1995 • Cast as",
      subtitleDetail: "Neil McCauley",
      itemAttrs: ["🔥"],
      inheritedItemAttrs: ["⭐"],
      connectedItemAttrs: ["⭐"],
      itemAttrCounts: {
        activeCount: 1,
        passiveCount: 1,
      },
      connectionParentLabel: "Al Pacino",
      connectionOrder: 1,
      connectionRank: 1,
    });
  });
});
