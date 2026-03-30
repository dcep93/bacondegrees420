import { describe, expect, it } from "vitest";
import {
  createCinenerdleOnlyPersonCard,
  createCinenerdleRootCard,
  createDailyStarterFilmRecord,
  createDailyStarterMovieCard,
  createMovieAssociationCard,
  createMovieRootCard,
  createPersonAssociationCard,
  createPersonRootCard,
  createRootDatabaseInfoCard,
} from "../cards";
import { CINENERDLE_ICON_URL, TMDB_ICON_URL, TMDB_POSTER_BASE_URL } from "../constants";
import type { DbInfoCard } from "../view_types";
import { getMovieCardKey, getPersonCardKey } from "../utils";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
  makeStarter,
  makeTmdbMovieSearchResult,
  makeTmdbPersonSearchResult,
} from "./factories";

function getSummaryItemValue(
  card: DbInfoCard,
  label: string,
) {
  return card.summaryItems.find((item) => item.label === label)?.value;
}

describe("root cards", () => {
  it("creates the cinenerdle root card", () => {
    expect(createCinenerdleRootCard(7)).toEqual({
      key: "cinenerdle",
      kind: "cinenerdle",
      name: "cinenerdle",
      popularity: 0,
      popularitySource: "Cinenerdle root cards do not have a popularity score.",
      imageUrl: CINENERDLE_ICON_URL,
      subtitle: "Daily starters",
      subtitleDetail: "Open today’s board",
      connectionCount: 7,
      sources: [{ iconUrl: CINENERDLE_ICON_URL, label: "Cinenerdle" }],
      status: null,
      record: null,
    });
  });

  it("creates movie and person root cards with a minimum connection count of one", () => {
    const movieRecord = makeFilmRecord({
      id: 101,
      title: "",
      year: "1995",
      popularity: 20,
      personConnectionKeys: [],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 101,
        title: "Heat",
        poster_path: "/heat.jpg",
        vote_average: 8.3,
        vote_count: 6000,
      }),
    });
    const personRecord = makePersonRecord({
      id: 202,
      name: "",
      movieConnectionKeys: [],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 202,
        name: "Al Pacino",
        profile_path: "/al.jpg",
        popularity: 42,
      }),
    });

    expect(createMovieRootCard(movieRecord, "Requested Heat")).toEqual({
      key: getMovieCardKey("Requested Heat", "1995", 101),
      kind: "movie",
      name: "Requested Heat",
      year: "1995",
      popularity: 20,
      popularitySource: "TMDb movie popularity from the cached movie record.",
      imageUrl: `${TMDB_POSTER_BASE_URL}/w185/heat.jpg`,
      subtitle: "1995",
      subtitleDetail: "",
      connectionCount: 1,
      sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
      status: null,
      voteAverage: 8.3,
      voteCount: 6000,
      record: movieRecord,
    });

    expect(createPersonRootCard(personRecord, "Requested Person")).toEqual({
      key: getPersonCardKey("Requested Person", 202),
      kind: "person",
      name: "Requested Person",
      popularity: 42,
      popularitySource: "TMDb person popularity from the cached person record.",
      imageUrl: `${TMDB_POSTER_BASE_URL}/w185/al.jpg`,
      subtitle: "",
      subtitleDetail: "",
      connectionCount: 1,
      sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
      status: null,
      record: personRecord,
    });
  });
});

describe("daily starter records and cards", () => {
  it("builds a starter film record with parsed title/year and deduped normalized people", () => {
    const filmRecord = createDailyStarterFilmRecord(
      makeStarter({
        id: null,
        title: "Heat (1995)",
        cast: ["Al Pacino", " al pacino ", "Robert De Niro"],
        directors: ["Michael Mann"],
        writers: ["MICHAEL MANN"],
        composers: ["Elliot Goldenthal"],
      }),
    );

    expect(filmRecord).toEqual({
      id: "heat (1995)",
      tmdbId: null,
      lookupKey: "heat (1995)",
      title: "Heat",
      titleLower: "heat",
      year: "1995",
      titleYear: "heat (1995)",
      popularity: 0,
      personConnectionKeys: [],
    });
  });

  it("handles starter titles without a year", () => {
    const filmRecord = createDailyStarterFilmRecord(
      makeStarter({
        id: "starter-plain",
        title: "Heat",
      }),
    );

    expect(filmRecord.title).toBe("Heat");
    expect(filmRecord.year).toBe("");
    expect(filmRecord.lookupKey).toBe("starter-plain");
    expect(filmRecord.titleYear).toBe("heat");
  });

  it("creates a daily starter movie card using TMDb poster data and no starter genre summary", () => {
    const filmRecord = makeFilmRecord({
      id: "starter-1",
      popularity: 12,
      personConnectionKeys: [],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        vote_average: 8.4,
        vote_count: 5500,
        poster_path: "/tmdb-heat.jpg",
      }),
    });

    expect(createDailyStarterMovieCard(filmRecord)).toEqual({
      key: "movie:10",
      kind: "movie",
      name: "Heat",
      year: "1995",
      popularity: 12,
      popularitySource: "TMDb movie popularity from the cached movie record.",
      imageUrl: `${TMDB_POSTER_BASE_URL}/w185/tmdb-heat.jpg`,
      subtitle: "1995",
      subtitleDetail: "",
      connectionCount: 1,
      sources: [
        { iconUrl: TMDB_ICON_URL, label: "TMDb" },
        { iconUrl: CINENERDLE_ICON_URL, label: "Cinenerdle daily starter" },
      ],
      status: null,
      voteAverage: 8.4,
      voteCount: 5500,
      record: filmRecord,
    });
  });

  it("falls back to a generic movie subtitle and empty detail when year is missing", () => {
    const filmRecord = makeFilmRecord({
      year: "",
      personConnectionKeys: ["al pacino", "robert de niro"],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        poster_path: "/heat.jpg",
        vote_average: undefined,
        vote_count: undefined,
      }),
    });

    expect(createDailyStarterMovieCard(filmRecord)).toEqual({
      key: "movie:10",
      kind: "movie",
      name: "Heat",
      year: "",
      popularity: 66,
      popularitySource: "TMDb movie popularity from the cached movie record.",
      imageUrl: `${TMDB_POSTER_BASE_URL}/w185/heat.jpg`,
      subtitle: "Movie",
      subtitleDetail: "",
      connectionCount: 2,
      sources: [
        { iconUrl: TMDB_ICON_URL, label: "TMDb" },
        { iconUrl: CINENERDLE_ICON_URL, label: "Cinenerdle daily starter" },
      ],
      status: null,
      voteAverage: null,
      voteCount: null,
      record: filmRecord,
    });
  });

  it("does not use non-tmdb starter ids for movie card keys", () => {
    const filmRecord = makeFilmRecord({
      id: 40572,
      tmdbId: null,
      title: "The Tournament",
      year: "2009",
      rawTmdbMovie: undefined,
    });

    expect(createDailyStarterMovieCard(filmRecord)).toEqual(
      expect.objectContaining({
        key: "movie:the tournament (2009)",
        name: "The Tournament",
      }),
    );
  });
});

describe("database info cards", () => {
  it("creates uncached movie database info cards", () => {
    const card = createRootDatabaseInfoCard(
      {
        kind: "movie",
        name: "Heat",
        year: "1995",
      },
      null,
    ) as DbInfoCard;

    expect(card.kind).toBe("dbinfo");
    expect(card.subtitle).toBe("Heat (1995)");
    expect(card.subtitleDetail).toBe("Not cached yet");
    expect(card.recordKind).toBe("movie");
    expect(getSummaryItemValue(card, "Cached")).toBe("No");
    expect(getSummaryItemValue(card, "TMDb ID")).toBe("-");
    expect(JSON.parse(card.body)).toEqual({
      cached: false,
      kind: "movie",
      title: "Heat",
      year: "1995",
    });
  });

  it("creates cached person database info cards with formatted summary values", () => {
    const personRecord = makePersonRecord({
      id: 9,
      tmdbId: 123,
      movieConnectionKeys: ["heat (1995)", "insomnia (2002)"],
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 123,
        name: "Kenneth Collard",
        popularity: 12.3456,
        profile_path: "/kenneth.jpg",
      }),
      rawTmdbMovieCreditsResponse: {
        cast: [makeMovieCredit({ id: 1 })],
        crew: [makeMovieCredit({ id: 2, creditType: undefined, character: undefined })],
      },
      fetchTimestamp: "2026-03-28T12:00:00.000Z",
    });
    const card = createRootDatabaseInfoCard(
      {
        kind: "person",
        name: "Kenneth Collard",
      },
      {
        ...personRecord,
        name: "Kenneth Collard",
      },
    ) as DbInfoCard;

    expect(card.subtitle).toBe("Kenneth Collard");
    expect(card.subtitleDetail).toBe("IndexedDB record");
    expect(getSummaryItemValue(card, "Cached")).toBe("Yes");
    expect(getSummaryItemValue(card, "TMDb ID")).toBe("123");
    expect(getSummaryItemValue(card, "Popularity")).toBe("12.35");
    expect(getSummaryItemValue(card, "Movies")).toBe("2");
    expect(getSummaryItemValue(card, "Profile")).toBe("Yes");
    expect(getSummaryItemValue(card, "Credits")).toBe("Yes");
    expect(JSON.parse(card.body)).toEqual({
      cached: true,
      kind: "person",
      name: "Kenneth Collard",
      id: 9,
      tmdbId: 123,
      popularity: 12.3456,
      movieConnectionCount: 2,
      castCreditCount: 1,
      crewCreditCount: 1,
      hasTmdbPerson: true,
      hasTmdbMovieCredits: true,
      profilePath: "/kenneth.jpg",
      fetchTimestamp: "2026-03-28T12:00:00.000Z",
    });
  });

  it("uses the requested movie metadata when cached title and year are empty", () => {
    const filmRecord = makeFilmRecord({
      title: "",
      year: "",
      tmdbId: null,
      popularity: 0,
      personConnectionKeys: [],
      rawTmdbMovie: undefined,
      rawTmdbMovieCreditsResponse: undefined,
      fetchTimestamp: undefined,
    });
    const card = createRootDatabaseInfoCard(
      {
        kind: "movie",
        name: "Heat",
        year: "1995",
      },
      filmRecord,
    ) as DbInfoCard;

    expect(JSON.parse(card.body)).toEqual({
      cached: true,
      kind: "movie",
      title: "Heat",
      year: "1995",
      id: 50,
      tmdbId: null,
      popularity: 0,
      voteAverage: null,
      voteCount: null,
      castCount: 0,
      crewCount: 0,
      connectionCount: 0,
      hasTmdbMovie: false,
      hasTmdbCredits: false,
      posterPath: null,
      fetchTimestamp: null,
    });
    expect(getSummaryItemValue(card, "Rating")).toBe("-");
    expect(getSummaryItemValue(card, "Credits")).toBe("No");
  });
});

describe("association cards", () => {
  it("creates fallback movie association cards from TMDb cast credits", () => {
    const credit = makeMovieCredit({
      id: 77,
      title: "Insomnia",
      release_date: "2002-05-24",
      popularity: 52,
      vote_average: 7.2,
      vote_count: 2000,
      creditType: "cast",
      character: "  Will Dormer  ",
      poster_path: "/insomnia.jpg",
    });

    expect(createMovieAssociationCard(credit, null, 4)).toEqual({
      key: "movie:77",
      kind: "movie",
      name: "Insomnia",
      year: "2002",
      popularity: 52,
      popularitySource: "TMDb movie popularity from this person's movie credit.",
      imageUrl: `${TMDB_POSTER_BASE_URL}/w185/insomnia.jpg`,
      subtitle: "2002 • Cast as",
      subtitleDetail: "Will Dormer",
      connectionCount: 4,
      sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
      status: null,
      voteAverage: 7.2,
      voteCount: 2000,
      record: {
        id: 77,
        tmdbId: 77,
        lookupKey: "insomnia (2002)",
        title: "Insomnia",
        titleLower: "insomnia",
        year: "2002",
        titleYear: "insomnia (2002)",
        popularity: 52,
        personConnectionKeys: [],
        rawTmdbMovie: {
          id: 77,
          title: "Insomnia",
          original_title: "Insomnia",
          poster_path: "/insomnia.jpg",
          release_date: "2002-05-24",
          popularity: 52,
          vote_average: 7.2,
          vote_count: 2000,
        },
      },
    });
  });

  it("uses cached movie records to override fallback title and rating fields when needed", () => {
    const credit = makeMovieCredit({
      id: 77,
      title: "Insomnia Search Result",
      release_date: "2002-05-24",
      popularity: undefined,
      vote_average: undefined,
      vote_count: undefined,
      creditType: "crew",
      character: undefined,
      job: "Writer",
      department: "Writing",
      poster_path: null,
    });
    const filmRecord = makeFilmRecord({
      id: 88,
      title: "Insomnia",
      year: "2002",
      popularity: 65,
      personConnectionKeys: ["al pacino"],
      rawTmdbMovie: makeTmdbMovieSearchResult({
        id: 88,
        title: "Insomnia",
        poster_path: "/cached.jpg",
        popularity: 70,
        vote_average: 7.5,
        vote_count: 3000,
        release_date: "2002-05-24",
      }),
    });

    expect(createMovieAssociationCard(credit, filmRecord, 2)).toEqual({
      key: "movie:88",
      kind: "movie",
      name: "Insomnia",
      year: "2002",
      popularity: 70,
      popularitySource: "TMDb movie popularity from the cached movie record.",
      imageUrl: `${TMDB_POSTER_BASE_URL}/w185/cached.jpg`,
      subtitle: "2002 • Writer",
      subtitleDetail: "",
      connectionCount: 2,
      sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
      status: null,
      voteAverage: 7.5,
      voteCount: 3000,
      record: filmRecord,
    });
  });

  it("creates person association cards from cached records or raw credits", () => {
    const personRecord = makePersonRecord({
      name: "Robin Williams",
      rawTmdbPerson: makeTmdbPersonSearchResult({
        id: 300,
        name: "Robin Williams",
        profile_path: "/robin.jpg",
        popularity: 91,
      }),
    });
    const castCard = createPersonAssociationCard(
      makePersonCredit({
        id: 300,
        name: "Credit Name",
        popularity: 12,
        creditType: "cast",
        character: "  Sean Maguire  ",
      }),
      3,
      personRecord,
    );
    const crewCard = createPersonAssociationCard(
      makePersonCredit({
        id: 301,
        name: "Ben Affleck",
        popularity: 33,
        creditType: "crew",
        character: undefined,
        job: "",
        department: "Writing",
        profile_path: "/ben.jpg",
      }),
      5,
    );

    expect(castCard).toEqual({
      key: getPersonCardKey("Robin Williams", 300),
      kind: "person",
      name: "Robin Williams",
      popularity: 91,
      popularitySource: "TMDb person popularity from the cached person record.",
      imageUrl: `${TMDB_POSTER_BASE_URL}/w185/robin.jpg`,
      subtitle: "Cast as",
      subtitleDetail: "Sean Maguire",
      connectionCount: 3,
      sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
      status: null,
      record: personRecord,
    });
    expect(crewCard).toEqual({
      key: getPersonCardKey("Ben Affleck", 301),
      kind: "person",
      name: "Ben Affleck",
      popularity: 33,
      popularitySource: "TMDb person popularity from this movie credit.",
      imageUrl: `${TMDB_POSTER_BASE_URL}/w300_and_h450_face/ben.jpg`,
      subtitle: "Writing",
      subtitleDetail: "",
      connectionCount: 5,
      sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
      status: null,
      record: null,
    });
  });

  it("renders both cast and crew credit lines for duplicate association roles", () => {
    const movieCard = createMovieAssociationCard(
      [
        makeMovieCredit({
          id: 3563,
          title: "I Now Pronounce You Chuck & Larry",
          release_date: "2007-07-12",
          popularity: 3.5179,
          creditType: "cast",
          character: "Charles 'Chuck' Levine",
        }),
        makeMovieCredit({
          id: 3563,
          title: "I Now Pronounce You Chuck & Larry",
          release_date: "2007-07-12",
          popularity: 3.5179,
          creditType: "crew",
          character: undefined,
          job: "Producer",
          department: "Production",
          order: undefined,
        }),
      ],
      makeFilmRecord({
        id: 3563,
        tmdbId: 3563,
        title: "I Now Pronounce You Chuck & Larry",
        year: "2007",
      }),
      47,
    );
    const personCard = createPersonAssociationCard(
      [
        makePersonCredit({
          id: 19292,
          name: "Adam Sandler",
          popularity: 7.408,
          creditType: "cast",
          character: "Charles 'Chuck' Levine",
        }),
        makePersonCredit({
          id: 19292,
          name: "Adam Sandler",
          popularity: 7.408,
          creditType: "crew",
          character: undefined,
          job: "Producer",
          department: "Production",
          order: undefined,
        }),
      ],
      123,
      makePersonRecord({
        id: 19292,
        tmdbId: 19292,
        name: "Adam Sandler",
      }),
    );

    expect(movieCard).toEqual(expect.objectContaining({
      subtitle: "2007 • Cast as",
      subtitleDetail: "Charles 'Chuck' Levine",
      creditLines: [
        {
          subtitle: "2007 • Cast as",
          subtitleDetail: "Charles 'Chuck' Levine",
        },
        {
          subtitle: "2007 • Producer",
          subtitleDetail: "",
        },
      ],
    }));
    expect(personCard).toEqual(expect.objectContaining({
      subtitle: "Cast as",
      subtitleDetail: "Charles 'Chuck' Levine",
      creditLines: [
        {
          subtitle: "Cast as",
          subtitleDetail: "Charles 'Chuck' Levine",
        },
        {
          subtitle: "Producer",
          subtitleDetail: "",
        },
      ],
    }));
  });

  it("falls back to crew labels and empty image/name details when person credit data is sparse", () => {
    expect(
      createPersonAssociationCard(
        makePersonCredit({
          id: undefined,
          name: undefined,
          popularity: undefined,
          creditType: "crew",
          character: undefined,
          job: " ",
          department: undefined,
          profile_path: null,
        }),
        1,
      ),
    ).toEqual({
      key: "person:",
      kind: "person",
      name: "",
      popularity: 0,
      popularitySource: "Popularity is unavailable, so this card falls back to 0.",
      imageUrl: null,
      subtitle: "Crew",
      subtitleDetail: "",
      connectionCount: 1,
      sources: [{ iconUrl: TMDB_ICON_URL, label: "TMDb" }],
      status: null,
      record: null,
    });
  });
});

describe("cinenerdle-only person cards", () => {
  it.each([
    ["cast", "Cast as"],
    ["directors", "Director"],
    ["writer", "Writer"],
    ["composer", "Composer"],
    ["costume design", "Crew"],
  ])("maps %s to the %s subtitle", (role, subtitle) => {
    expect(createCinenerdleOnlyPersonCard("Kenneth Collard", role)).toEqual({
      key: "person:starter:kenneth collard",
      kind: "person",
      name: "Kenneth Collard",
      popularity: 0,
      popularitySource: "Cinenerdle starter-only fallback. No TMDb person popularity is cached yet.",
      imageUrl: null,
      subtitle,
      subtitleDetail: "",
      connectionCount: 1,
      sources: [{ iconUrl: CINENERDLE_ICON_URL, label: "Cinenerdle" }],
      status: null,
      record: null,
    });
  });

  it("formats lowercase starter-only names for display while keeping a normalized starter key", () => {
    expect(createCinenerdleOnlyPersonCard("andy weir", "writer")).toEqual({
      key: "person:starter:andy weir",
      kind: "person",
      name: "Andy Weir",
      popularity: 0,
      popularitySource: "Cinenerdle starter-only fallback. No TMDb person popularity is cached yet.",
      imageUrl: null,
      subtitle: "Writer",
      subtitleDetail: "",
      connectionCount: 1,
      sources: [{ iconUrl: CINENERDLE_ICON_URL, label: "Cinenerdle" }],
      status: null,
      record: null,
    });
  });
});
