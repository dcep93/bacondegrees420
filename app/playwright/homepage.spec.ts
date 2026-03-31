import { expect, test, type Page } from "@playwright/test";

const BIG_LEBOWSKI_HASH = "/#film|The+Big+Lebowski+(1998)";
const BIG_LEBOWSKI_SEARCH_URL =
  "https://api.themoviedb.org/3/search/movie?query=The Big Lebowski";
const BIG_LEBOWSKI_CREDITS_URL =
  "https://api.themoviedb.org/3/movie/115/credits";
const JEFF_BRIDGES_DETAILS_URL =
  "https://api.themoviedb.org/3/person/1229";
const JEFF_BRIDGES_MOVIE_CREDITS_URL =
  "https://api.themoviedb.org/3/person/1229/movie_credits";
const TRUE_GRIT_DETAILS_URL =
  "https://api.themoviedb.org/3/movie/44214";
const TRUE_GRIT_CREDITS_URL =
  "https://api.themoviedb.org/3/movie/44214/credits";

type RouteRequestRecorder = {
  record: (url: string) => void;
  urls: string[];
};

function createRouteRequestRecorder(): RouteRequestRecorder {
  const urls: string[] = [];

  return {
    record(url: string) {
      const parsedUrl = new URL(url);
      parsedUrl.searchParams.delete("api_key");
      const normalizedSearch = [...parsedUrl.searchParams.entries()]
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
      urls.push(`${parsedUrl.origin}${parsedUrl.pathname}${normalizedSearch ? `?${normalizedSearch}` : ""}`);
    },
    urls,
  };
}

function getTmdbRequests(requests: RouteRequestRecorder): string[] {
  return requests.urls.filter((url) => url.startsWith("https://api.themoviedb.org/"));
}

function countRecordedRequests(requests: RouteRequestRecorder, targetUrl: string): number {
  return requests.urls.filter((url) => url === targetUrl).length;
}

function getCinenerdleCardByTitle(page: Page, title: string) {
  return page.locator(".cinenerdle-card").filter({
    has: page.locator(".cinenerdle-card-title", { hasText: title }),
  });
}

function getGenerationRow(page: Page, generationNumber: number) {
  return page
    .getByRole("button", { name: `GEN ${generationNumber}` })
    .locator("xpath=ancestor::*[contains(@class,'generator-row')][1]");
}

function getGenerationCardByTitle(
  page: Page,
  generationNumber: number,
  title: string,
) {
  const row = getGenerationRow(page, generationNumber);

  return row.locator(".cinenerdle-card").filter({
    has: page.locator(".cinenerdle-card-title", { hasText: title }),
  });
}

function getPopularityBadge(card: ReturnType<typeof getCinenerdleCardByTitle>) {
  return card.locator(".cinenerdle-card-chip", { hasText: /^Popularity / }).first();
}

function getTmdbBadgeIcon(card: ReturnType<typeof getCinenerdleCardByTitle>) {
  return card.locator(".cinenerdle-card-count-icon[alt='TMDb']");
}

async function isCardVisibleWithinRow(
  card: ReturnType<typeof getCinenerdleCardByTitle>,
  rowTrack: ReturnType<Page["locator"]>,
) {
  const [cardBox, rowTrackBox] = await Promise.all([
    card.boundingBox(),
    rowTrack.boundingBox(),
  ]);

  if (!cardBox || !rowTrackBox) {
    return false;
  }

  const horizontalOverlap = Math.min(
    cardBox.x + cardBox.width,
    rowTrackBox.x + rowTrackBox.width,
  ) - Math.max(cardBox.x, rowTrackBox.x);
  const verticalOverlap = Math.min(
    cardBox.y + cardBox.height,
    rowTrackBox.y + rowTrackBox.height,
  ) - Math.max(cardBox.y, rowTrackBox.y);

  return horizontalOverlap > 1 && verticalOverlap > 1;
}

async function expectCardVisibilityWithinRow(
  card: ReturnType<typeof getCinenerdleCardByTitle>,
  rowTrack: ReturnType<Page["locator"]>,
  visible: boolean,
) {
  await expect.poll(async () => isCardVisibleWithinRow(card, rowTrack)).toBe(visible);
}

function createJsonResponse(body: unknown) {
  return {
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function primeCinenerdlePage(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem("cinenerdle2.tmdbApiKey", "key:playwright-test-key");
    window.indexedDB.deleteDatabase("cinenerdle2");
  });

  await page.route("https://www.cinenerdle2.app/api/battle-data/daily-starters?*", async (route) => {
    await route.fulfill(createJsonResponse({ data: [] }));
  });

  await page.route("https://image.tmdb.org/**", async (route) => {
    await route.fulfill({
      status: 204,
      body: "",
    });
  });

  await page.route("https://www.cinenerdle2.app/icon.png", async (route) => {
    await route.fulfill({
      status: 204,
      body: "",
    });
  });
}

type BigLebowskiPrefetchScenario = {
  personPrefetchDelayMs?: number;
  personMovieCredits: {
    cast: Array<{
      id: number;
      title: string;
      original_title: string;
      poster_path: string | null;
      release_date: string;
      popularity: number;
      vote_average: number;
      vote_count: number;
      character: string;
    }>;
    crew: unknown[];
  } | null;
  selectedMovieCredits: {
    cast: Array<{
      id: number;
      name: string;
      popularity: number;
      profile_path: string | null;
      character: string;
      known_for_department: string;
      order: number;
    }>;
    crew: unknown[];
  };
};

async function mockBigLebowskiDeepLinkScenario(
  page: Page,
  requests: RouteRequestRecorder,
  scenario: BigLebowskiPrefetchScenario,
) {
  await page.route("https://api.themoviedb.org/**", async (route) => {
    requests.record(route.request().url());
    const url = new URL(route.request().url());

    if (url.pathname === "/3/search/movie") {
      const query = url.searchParams.get("query");
      if (query !== "The Big Lebowski") {
        throw new Error(`Unexpected movie search query: ${query}`);
      }

      await route.fulfill(createJsonResponse({
        results: [
          {
            id: 115,
            title: "The Big Lebowski",
            original_title: "The Big Lebowski",
            poster_path: "/the-big-lebowski.jpg",
            release_date: "1998-03-06",
            popularity: 18.46,
            vote_average: 7.84,
            vote_count: 9132,
          },
        ],
      }));
      return;
    }

    if (url.pathname === "/3/movie/115/credits") {
      await route.fulfill(createJsonResponse(scenario.selectedMovieCredits));
      return;
    }

    if (url.pathname === "/3/movie/115") {
      await route.fulfill(createJsonResponse({
        id: 115,
        title: "The Big Lebowski",
        original_title: "The Big Lebowski",
        poster_path: "/the-big-lebowski.jpg",
        release_date: "1998-03-06",
        popularity: 18.46,
        vote_average: 7.84,
        vote_count: 9132,
      }));
      return;
    }

    if (url.pathname === "/3/movie/44214") {
      await route.fulfill(createJsonResponse({
        id: 44214,
        title: "True Grit",
        original_title: "True Grit",
        poster_path: "/true-grit.jpg",
        release_date: "2010-12-22",
        popularity: 12.1,
        vote_average: 7.3,
        vote_count: 3824,
      }));
      return;
    }

    if (url.pathname === "/3/movie/44214/credits") {
      await route.fulfill(createJsonResponse({
        cast: [],
        crew: [],
      }));
      return;
    }

    if (url.pathname === "/3/person/1229") {
      if (!scenario.personMovieCredits) {
        throw new Error(`Unexpected person details request: ${url.pathname}`);
      }

      if (scenario.personPrefetchDelayMs) {
        await delay(scenario.personPrefetchDelayMs);
      }

      await route.fulfill(createJsonResponse({
        id: 1229,
        name: "Jeff Bridges",
        popularity: 15.2,
        profile_path: "/jeff-bridges.jpg",
      }));
      return;
    }

    if (url.pathname === "/3/person/1229/movie_credits") {
      if (!scenario.personMovieCredits) {
        throw new Error(`Unexpected person movie credits request: ${url.pathname}`);
      }

      if (scenario.personPrefetchDelayMs) {
        await delay(scenario.personPrefetchDelayMs);
      }

      await route.fulfill(createJsonResponse(scenario.personMovieCredits));
      return;
    }

    throw new Error(`Unexpected TMDb request: ${url.pathname}`);
  });
}

test("homepage cold start only fetches mocked daily starters and starter movie credits", async ({ page }) => {
  const requests = createRouteRequestRecorder();
  const starterMovies = [
    {
      id: "starter-ready-or-not-2",
      title: "Ready or Not: Here I Come (2026)",
    },
    {
      id: "starter-gladiator",
      title: "Gladiator (2000)",
    },
  ];

  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem("cinenerdle2.tmdbApiKey", "key:playwright-test-key");
    window.indexedDB.deleteDatabase("cinenerdle2");
  });

  await page.route("https://www.cinenerdle2.app/api/battle-data/daily-starters?*", async (route) => {
    requests.record(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: starterMovies,
      }),
    });
  });

  await page.route("https://api.themoviedb.org/**", async (route) => {
    requests.record(route.request().url());
    const url = new URL(route.request().url());
    if (url.pathname === "/3/search/movie") {
      const query = url.searchParams.get("query");

      if (query === "Ready or Not: Here I Come") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            results: [
              {
                id: 1266127,
                title: "Ready or Not: Here I Come",
                original_title: "Ready or Not: Here I Come",
                poster_path: "/ready-or-not-2.jpg",
                release_date: "2026-04-10",
                popularity: 60.28,
                vote_average: 7.2,
                vote_count: 100,
              },
            ],
          }),
        });
        return;
      }

      if (query === "Gladiator") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            results: [
              {
                id: 98,
                title: "Gladiator",
                original_title: "Gladiator",
                poster_path: "/gladiator.jpg",
                release_date: "2000-05-04",
                popularity: 20.33,
                vote_average: 8.22,
                vote_count: 20658,
              },
            ],
          }),
        });
        return;
      }

      throw new Error(`Unexpected movie search query: ${query}`);
    }

    const movieId = url.pathname.match(/\/movie\/(\d+)\/credits$/)?.[1] ?? "";

    if (movieId === "1266127") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          cast: [],
          crew: [],
        }),
      });
      return;
    }

    if (movieId === "98") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          cast: [],
          crew: [],
        }),
      });
      return;
    }

    throw new Error(`Unexpected movie credits id: ${movieId}`);
  });

  await page.route("https://image.tmdb.org/**", async (route) => {
    await route.fulfill({
      status: 204,
      body: "",
    });
  });

  await page.route("https://www.cinenerdle2.app/icon.png", async (route) => {
    await route.fulfill({
      status: 204,
      body: "",
    });
  });

  await page.goto("/");

  await expect(page.locator(".cinenerdle-card-title", { hasText: "Ready or Not: Here I Come" })).toBeVisible();
  await expect(page.locator(".cinenerdle-card-title", { hasText: "Gladiator" })).toBeVisible();

  await expect
    .poll(() => requests.urls)
    .toEqual([
      "https://www.cinenerdle2.app/api/battle-data/daily-starters",
      "https://api.themoviedb.org/3/search/movie?query=Ready or Not: Here I Come",
      "https://api.themoviedb.org/3/search/movie?query=Gladiator",
      "https://api.themoviedb.org/3/movie/1266127/credits",
      "https://api.themoviedb.org/3/movie/98/credits",
    ]);
});

test("cinenerdle starter generation auto-scrolls when it mounts", async ({ page }) => {
  const starterMovieTitles = [
    "Starter Atlas",
    "Starter Birch",
    "Starter Cedar",
    "Starter Drift",
    "Starter Ember",
    "Starter Flint",
    "Starter Grove",
    "Starter Harbor",
    "Starter Ivory",
    "Starter Juniper",
    "Starter Kite",
  ];
  const starterMovies = starterMovieTitles.map((title, index) => ({
    id: `starter-${index + 1}`,
    title: `${title} (${2000 + index})`,
  }));
  const movieSearchResultsByQuery = new Map(
    starterMovies.map((movie, index) => {
      const titleWithoutYear = movie.title.replace(/\s+\(\d{4}\)$/, "");
      return [
        titleWithoutYear,
        {
          id: 5000 + index,
          title: titleWithoutYear,
          original_title: titleWithoutYear,
          poster_path: `/starter-${index + 1}.jpg`,
          release_date: `${2000 + index}-01-01`,
          popularity: 100 - index,
          vote_average: 7.1,
          vote_count: 1000 + index,
        },
      ] as const;
    }),
  );

  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem("cinenerdle2.tmdbApiKey", "key:playwright-test-key");
    window.localStorage.setItem(
      "cinenerdle2.dailyStarterTitles",
      JSON.stringify([
        "Starter Atlas (2000)",
        "Starter Birch (2001)",
        "Starter Cedar (2002)",
        "Starter Drift (2003)",
        "Starter Ember (2004)",
        "Starter Flint (2005)",
        "Starter Grove (2006)",
        "Starter Harbor (2007)",
        "Starter Ivory (2008)",
        "Starter Juniper (2009)",
        "Starter Kite (2010)",
      ]),
    );
    window.indexedDB.deleteDatabase("cinenerdle2");
  });

  await page.route("https://www.cinenerdle2.app/api/battle-data/daily-starters?*", async (route) => {
    await route.fulfill(createJsonResponse({
      data: starterMovies,
    }));
  });

  await page.route("https://api.themoviedb.org/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/3/search/movie") {
      const query = url.searchParams.get("query") ?? "";
      const movie = movieSearchResultsByQuery.get(query);

      if (!movie) {
        throw new Error(`Unexpected movie search query: ${query}`);
      }

      await route.fulfill(createJsonResponse({
        results: [movie],
      }));
      return;
    }

    const movieCreditsId = Number(url.pathname.match(/\/3\/movie\/(\d+)\/credits$/)?.[1] ?? NaN);
    if (Number.isFinite(movieCreditsId)) {
      await route.fulfill(createJsonResponse({
        cast: [],
        crew: [],
      }));
      return;
    }

    throw new Error(`Unexpected TMDb request: ${url.pathname}`);
  });

  await page.route("https://image.tmdb.org/**", async (route) => {
    await route.fulfill({
      status: 204,
      body: "",
    });
  });

  await page.route("https://www.cinenerdle2.app/icon.png", async (route) => {
    await route.fulfill({
      status: 204,
      body: "",
    });
  });

  await page.goto("/");

  const gen1Row = getGenerationRow(page, 1);
  const gen1RowTrack = gen1Row.locator(".generator-row-track");
  const firstStarterCard = getGenerationCardByTitle(page, 1, "Starter Atlas");
  const lastStarterCard = getGenerationCardByTitle(page, 1, "Starter Kite");

  await expect(gen1Row.locator(".cinenerdle-card")).toHaveCount(11);
  await expect.poll(() => gen1RowTrack.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expectCardVisibilityWithinRow(firstStarterCard, gen1RowTrack, true);
  await expectCardVisibilityWithinRow(lastStarterCard, gen1RowTrack, false);
});

test("Big Lebowski deep link stays sensible when there is nothing to prefetch", async ({ page }) => {
  const requests = createRouteRequestRecorder();

  await primeCinenerdlePage(page);
  await mockBigLebowskiDeepLinkScenario(page, requests, {
    selectedMovieCredits: {
      cast: [],
      crew: [],
    },
    personMovieCredits: null,
  });

  await page.goto(BIG_LEBOWSKI_HASH);

  const bigLebowskiCard = getCinenerdleCardByTitle(page, "The Big Lebowski");
  await expect(bigLebowskiCard).toBeVisible();
  await expect(page.locator(".cinenerdle-card-title", { hasText: "Jeff Bridges" })).toHaveCount(0);

  await expect
    .poll(() => {
      const tmdbRequests = getTmdbRequests(requests);

      return {
        hasSearch: tmdbRequests.includes(BIG_LEBOWSKI_SEARCH_URL),
        hasMovieCredits: tmdbRequests.includes(BIG_LEBOWSKI_CREDITS_URL),
        personRequestCount: tmdbRequests.filter((url) => url.includes("/person/")).length,
      };
    })
    .toEqual({
      hasSearch: true,
      hasMovieCredits: true,
      personRequestCount: 0,
    });
});

test("Big Lebowski deep link stays sensible when prefetch hydrates an unconnected person", async ({ page }) => {
  const requests = createRouteRequestRecorder();

  await primeCinenerdlePage(page);
  await mockBigLebowskiDeepLinkScenario(page, requests, {
    selectedMovieCredits: {
      cast: [
        {
          id: 1229,
          name: "Jeff Bridges",
          popularity: 15.2,
          profile_path: "/jeff-bridges.jpg",
          character: "The Dude",
          known_for_department: "Acting",
          order: 0,
        },
      ],
      crew: [],
    },
    personMovieCredits: {
      cast: [
        {
          id: 44214,
          title: "True Grit",
          original_title: "True Grit",
          poster_path: "/true-grit.jpg",
          release_date: "2010-12-22",
          popularity: 12.1,
          vote_average: 7.3,
          vote_count: 3824,
          character: "Rooster Cogburn",
        },
      ],
      crew: [],
    },
  });

  await page.goto(BIG_LEBOWSKI_HASH);

  await expect(getCinenerdleCardByTitle(page, "The Big Lebowski")).toBeVisible();
  const jeffBridgesCard = getCinenerdleCardByTitle(page, "Jeff Bridges");
  await expect(jeffBridgesCard).toBeVisible();

  await expect
    .poll(() => {
      const tmdbRequests = getTmdbRequests(requests);

      return {
        hasSearch: tmdbRequests.includes(BIG_LEBOWSKI_SEARCH_URL),
        hasMovieCredits: tmdbRequests.includes(BIG_LEBOWSKI_CREDITS_URL),
        hasPersonDetails: tmdbRequests.includes(JEFF_BRIDGES_DETAILS_URL),
        hasPersonMovieCredits: tmdbRequests.includes(JEFF_BRIDGES_MOVIE_CREDITS_URL),
      };
    })
    .toEqual({
      hasSearch: true,
      hasMovieCredits: true,
      hasPersonDetails: true,
      hasPersonMovieCredits: true,
    });
});

test("Big Lebowski deep link updates a connected prefetched person with a connection badge", async ({ page }) => {
  const requests = createRouteRequestRecorder();

  await primeCinenerdlePage(page);
  await mockBigLebowskiDeepLinkScenario(page, requests, {
    personPrefetchDelayMs: 250,
    selectedMovieCredits: {
      cast: [
        {
          id: 1229,
          name: "Jeff Bridges",
          popularity: 15.2,
          profile_path: "/jeff-bridges.jpg",
          character: "The Dude",
          known_for_department: "Acting",
          order: 0,
        },
      ],
      crew: [],
    },
    personMovieCredits: {
      cast: [
        {
          id: 115,
          title: "The Big Lebowski",
          original_title: "The Big Lebowski",
          poster_path: "/the-big-lebowski.jpg",
          release_date: "1998-03-06",
          popularity: 18.46,
          vote_average: 7.84,
          vote_count: 9132,
          character: "The Dude",
        },
        {
          id: 44214,
          title: "True Grit",
          original_title: "True Grit",
          poster_path: "/true-grit.jpg",
          release_date: "2010-12-22",
          popularity: 12.1,
          vote_average: 7.3,
          vote_count: 3824,
          character: "Rooster Cogburn",
        },
      ],
      crew: [],
    },
  });

  await page.goto(BIG_LEBOWSKI_HASH);

  await expect(getCinenerdleCardByTitle(page, "The Big Lebowski")).toBeVisible();
  const jeffBridgesCard = getCinenerdleCardByTitle(page, "Jeff Bridges");
  await expect(jeffBridgesCard).toBeVisible();
  await expect(jeffBridgesCard.locator(".cinenerdle-card-count")).toHaveCount(0);
  await expect(jeffBridgesCard.locator(".cinenerdle-card-count")).toBeVisible();

  await expect
    .poll(() => {
      const tmdbRequests = getTmdbRequests(requests);

      return {
        hasSearch: tmdbRequests.includes(BIG_LEBOWSKI_SEARCH_URL),
        hasMovieCredits: tmdbRequests.includes(BIG_LEBOWSKI_CREDITS_URL),
        hasPersonDetails: tmdbRequests.includes(JEFF_BRIDGES_DETAILS_URL),
        hasPersonMovieCredits: tmdbRequests.includes(JEFF_BRIDGES_MOVIE_CREDITS_URL),
        hasFollowOnMoviePrefetch:
          tmdbRequests.includes(TRUE_GRIT_DETAILS_URL) ||
          tmdbRequests.includes(TRUE_GRIT_CREDITS_URL),
      };
    })
    .toEqual({
      hasSearch: true,
      hasMovieCredits: true,
      hasPersonDetails: true,
      hasPersonMovieCredits: true,
      hasFollowOnMoviePrefetch: true,
    });
});

test("clicking the connection badge side of a footer-top row refetches TMDb data", async ({ page }) => {
  const requests = createRouteRequestRecorder();

  await primeCinenerdlePage(page);
  await mockBigLebowskiDeepLinkScenario(page, requests, {
    selectedMovieCredits: {
      cast: [
        {
          id: 1229,
          name: "Jeff Bridges",
          popularity: 15.2,
          profile_path: "/jeff-bridges.jpg",
          character: "The Dude",
          known_for_department: "Acting",
          order: 0,
        },
      ],
      crew: [],
    },
    personMovieCredits: {
      cast: [
        {
          id: 115,
          title: "The Big Lebowski",
          original_title: "The Big Lebowski",
          poster_path: "/the-big-lebowski.jpg",
          release_date: "1998-03-06",
          popularity: 18.46,
          vote_average: 7.84,
          vote_count: 9132,
          character: "The Dude",
        },
        {
          id: 44214,
          title: "True Grit",
          original_title: "True Grit",
          poster_path: "/true-grit.jpg",
          release_date: "2010-12-22",
          popularity: 12.1,
          vote_average: 7.3,
          vote_count: 3824,
          character: "Rooster Cogburn",
        },
      ],
      crew: [],
    },
  });

  await page.goto(BIG_LEBOWSKI_HASH);

  const jeffBridgesCard = getCinenerdleCardByTitle(page, "Jeff Bridges");
  await expect(jeffBridgesCard).toBeVisible();
  await expect(jeffBridgesCard.locator(".cinenerdle-card-count")).toBeVisible();

  await expect
    .poll(() => ({
      personDetailsCount: countRecordedRequests(requests, JEFF_BRIDGES_DETAILS_URL),
      personMovieCreditsCount: countRecordedRequests(requests, JEFF_BRIDGES_MOVIE_CREDITS_URL),
    }))
    .toEqual({
      personDetailsCount: 1,
      personMovieCreditsCount: 1,
    });

  await jeffBridgesCard.locator(".cinenerdle-card-count").click();

  await expect
    .poll(() => ({
      personDetailsCount: countRecordedRequests(requests, JEFF_BRIDGES_DETAILS_URL),
      personMovieCreditsCount: countRecordedRequests(requests, JEFF_BRIDGES_MOVIE_CREDITS_URL),
    }))
    .toEqual({
      personDetailsCount: 2,
      personMovieCreditsCount: 2,
    });
});

test("gen 2 refresh keeps horizontal scroll stable and redraws gen 3 for the newly selected person", async ({
  page,
}) => {
  const requests = createRouteRequestRecorder();
  const starterMovie = {
    id: 9001,
    title: "Mock Starter Movie",
    original_title: "Mock Starter Movie",
    poster_path: "/mock-starter-movie.jpg",
    release_date: "2001-06-15",
    popularity: 95.5,
    vote_average: 7.4,
    vote_count: 8100,
  };
  const people = [
    { id: 1001, name: "Alpha One", popularity: 500, order: 0 },
    { id: 1002, name: "Bravo Two", popularity: 480, order: 1 },
    { id: 1003, name: "Charlie Three", popularity: 460, order: 2 },
    { id: 1004, name: "Delta Four", popularity: 440, order: 3 },
    { id: 1005, name: "Echo Five", popularity: 420, order: 4 },
    { id: 1006, name: "Foxtrot Six", popularity: 400, order: 5 },
    { id: 1007, name: "Golf Seven", popularity: 380, order: 6 },
    { id: 1008, name: "Hotel Eight", popularity: 360, order: 7 },
    { id: 1009, name: "India Nine", popularity: 40, order: 8 },
    { id: 1010, name: "Juliet Ten", popularity: 340, order: 9 },
    { id: 1011, name: "Kilo Eleven", popularity: 320, order: 10 },
  ];
  const alphaPerson = people[0];
  const indiaPerson = people[8];
  const alphaMovieCredits = [
    starterMovie,
    {
      id: 2101,
      title: "Alpha Movie A",
      original_title: "Alpha Movie A",
      poster_path: "/alpha-a.jpg",
      release_date: "2003-02-14",
      popularity: 90,
      vote_average: 7.1,
      vote_count: 4100,
    },
    {
      id: 2102,
      title: "Alpha Movie B",
      original_title: "Alpha Movie B",
      poster_path: "/alpha-b.jpg",
      release_date: "2004-03-19",
      popularity: 88,
      vote_average: 7.2,
      vote_count: 3900,
    },
    {
      id: 2103,
      title: "Alpha Movie C",
      original_title: "Alpha Movie C",
      poster_path: "/alpha-c.jpg",
      release_date: "2005-04-22",
      popularity: 86,
      vote_average: 7.3,
      vote_count: 3700,
    },
    {
      id: 2104,
      title: "Alpha Movie D",
      original_title: "Alpha Movie D",
      poster_path: "/alpha-d.jpg",
      release_date: "2006-05-12",
      popularity: 84,
      vote_average: 7.4,
      vote_count: 3500,
    },
    {
      id: 2105,
      title: "Alpha Movie E",
      original_title: "Alpha Movie E",
      poster_path: "/alpha-e.jpg",
      release_date: "2007-06-08",
      popularity: 82,
      vote_average: 7.5,
      vote_count: 3300,
    },
    {
      id: 2106,
      title: "Alpha Movie F",
      original_title: "Alpha Movie F",
      poster_path: "/alpha-f.jpg",
      release_date: "2008-07-11",
      popularity: 80,
      vote_average: 7.6,
      vote_count: 3100,
    },
  ];
  const indiaMovieCredits = [
    starterMovie,
    {
      id: 2201,
      title: "India Movie A",
      original_title: "India Movie A",
      poster_path: "/india-a.jpg",
      release_date: "2011-01-21",
      popularity: 72,
      vote_average: 6.8,
      vote_count: 2800,
    },
    {
      id: 2202,
      title: "India Movie B",
      original_title: "India Movie B",
      poster_path: "/india-b.jpg",
      release_date: "2012-02-17",
      popularity: 70,
      vote_average: 6.9,
      vote_count: 2600,
    },
    {
      id: 2203,
      title: "India Movie C",
      original_title: "India Movie C",
      poster_path: "/india-c.jpg",
      release_date: "2013-03-15",
      popularity: 68,
      vote_average: 7.0,
      vote_count: 2400,
    },
    {
      id: 2204,
      title: "India Movie D",
      original_title: "India Movie D",
      poster_path: "/india-d.jpg",
      release_date: "2014-04-18",
      popularity: 66,
      vote_average: 7.1,
      vote_count: 2200,
    },
    {
      id: 2205,
      title: "India Movie E",
      original_title: "India Movie E",
      poster_path: "/india-e.jpg",
      release_date: "2015-05-22",
      popularity: 64,
      vote_average: 7.2,
      vote_count: 2000,
    },
    {
      id: 2206,
      title: "India Movie F",
      original_title: "India Movie F",
      poster_path: "/india-f.jpg",
      release_date: "2016-06-10",
      popularity: 62,
      vote_average: 7.3,
      vote_count: 1800,
    },
  ];
  const sharedStarterCredit = {
    id: starterMovie.id,
    title: starterMovie.title,
    original_title: starterMovie.original_title,
    poster_path: starterMovie.poster_path,
    release_date: starterMovie.release_date,
    popularity: starterMovie.popularity,
    vote_average: starterMovie.vote_average,
    vote_count: starterMovie.vote_count,
  };
  const movieDetailsById = new Map([
    [starterMovie.id, starterMovie],
    ...alphaMovieCredits.slice(1).map((movie) => [movie.id, movie] as const),
    ...indiaMovieCredits.slice(1).map((movie) => [movie.id, movie] as const),
  ]);
  const moviesByTitle = new Map(
    [starterMovie, ...alphaMovieCredits.slice(1), ...indiaMovieCredits.slice(1)].map((movie) => [
      movie.title,
      movie,
    ] as const),
  );
  const personMovieCreditsById = new Map([
    [
      alphaPerson.id,
      {
        cast: alphaMovieCredits.map((movie, index) => ({
          ...movie,
          character: `Alpha Role ${index + 1}`,
        })),
        crew: [],
      },
    ],
    [
      indiaPerson.id,
      {
        cast: indiaMovieCredits.map((movie, index) => ({
          ...movie,
          character: `India Role ${index + 1}`,
        })),
        crew: [],
      },
    ],
    ...people
      .filter((person) => person.id !== alphaPerson.id && person.id !== indiaPerson.id)
      .map((person) => [
        person.id,
        {
          cast: [
            {
              ...sharedStarterCredit,
              character: `${person.name} in Mock Starter Movie`,
            },
          ],
          crew: [],
        },
      ] as const),
  ]);
  const starterCredits = {
    cast: people.map((person) => ({
      id: person.id,
      name: person.name,
      popularity: person.popularity,
      profile_path: `/${person.id}.jpg`,
      character: `${person.name} Character`,
      known_for_department: "Acting",
      order: person.order,
    })),
    crew: [],
  };
  const starterTitle = `${starterMovie.title} (${starterMovie.release_date.slice(0, 4)})`;
  const indiaDetailsUrl = `https://api.themoviedb.org/3/person/${indiaPerson.id}`;
  const indiaMovieCreditsUrl = `https://api.themoviedb.org/3/person/${indiaPerson.id}/movie_credits`;

  await page.setViewportSize({
    width: 1800,
    height: 900,
  });

  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem("cinenerdle2.tmdbApiKey", "key:playwright-test-key");
    window.localStorage.setItem(
      "cinenerdle2.dailyStarterTitles",
      JSON.stringify(["Mock Starter Movie (2001)"]),
    );
    window.indexedDB.deleteDatabase("cinenerdle2");
  });

  await page.route("https://www.cinenerdle2.app/api/battle-data/daily-starters?*", async (route) => {
    requests.record(route.request().url());
    await route.fulfill(createJsonResponse({
      data: [
        {
          id: "mock-starter",
          title: starterTitle,
        },
      ],
    }));
  });

  await page.route("https://image.tmdb.org/**", async (route) => {
    await route.fulfill({
      status: 204,
      body: "",
    });
  });

  await page.route("https://www.cinenerdle2.app/icon.png", async (route) => {
    await route.fulfill({
      status: 204,
      body: "",
    });
  });

  await page.route("**/dump.json", async (route) => {
    await route.fulfill(createJsonResponse({
      format: "cinenerdle-indexed-db-snapshot",
      version: 9,
      people: [],
      films: [],
    }));
  });

  await page.route("https://www.themoviedb.org/assets/**", async (route) => {
    await route.fulfill({
      status: 204,
      body: "",
    });
  });

  await page.route("https://api.themoviedb.org/**", async (route) => {
    requests.record(route.request().url());
    const url = new URL(route.request().url());

    if (url.pathname === "/3/search/movie") {
      const query = url.searchParams.get("query");
      const movie = query ? moviesByTitle.get(query) : null;
      if (!movie) {
        throw new Error(`Unexpected movie search query: ${query}`);
      }

      await route.fulfill(createJsonResponse({
        results: [movie],
      }));
      return;
    }

    const movieDetailsId = Number(url.pathname.match(/^\/3\/movie\/(\d+)$/)?.[1]);
    if (Number.isFinite(movieDetailsId)) {
      const movie = movieDetailsById.get(movieDetailsId);
      if (!movie) {
        throw new Error(`Unexpected movie details request: ${url.pathname}`);
      }

      await route.fulfill(createJsonResponse(movie));
      return;
    }

    const movieCreditsId = Number(url.pathname.match(/^\/3\/movie\/(\d+)\/credits$/)?.[1]);
    if (Number.isFinite(movieCreditsId)) {
      if (movieCreditsId === starterMovie.id) {
        await route.fulfill(createJsonResponse(starterCredits));
        return;
      }

      if (movieDetailsById.has(movieCreditsId)) {
        await route.fulfill(createJsonResponse({
          cast: [],
          crew: [],
        }));
        return;
      }

      throw new Error(`Unexpected movie credits request: ${url.pathname}`);
    }

    const personDetailsId = Number(url.pathname.match(/^\/3\/person\/(\d+)$/)?.[1]);
    if (Number.isFinite(personDetailsId)) {
      const person = people.find((candidate) => candidate.id === personDetailsId);
      if (!person) {
        throw new Error(`Unexpected person details request: ${url.pathname}`);
      }

      await route.fulfill(createJsonResponse({
        id: person.id,
        name: person.name,
        popularity: person.popularity,
        profile_path: `/${person.id}.jpg`,
      }));
      return;
    }

    const personMovieCreditsId = Number(
      url.pathname.match(/^\/3\/person\/(\d+)\/movie_credits$/)?.[1],
    );
    if (Number.isFinite(personMovieCreditsId)) {
      const movieCredits = personMovieCreditsById.get(personMovieCreditsId);
      if (!movieCredits) {
        throw new Error(`Unexpected person movie credits request: ${url.pathname}`);
      }

      await route.fulfill(createJsonResponse(movieCredits));
      return;
    }

    throw new Error(`Unexpected TMDb request: ${url.pathname}`);
  });

  await page.goto("/");

  const starterCard = getGenerationCardByTitle(page, 1, starterMovie.title);
  await expect(starterCard).toBeVisible();

  await starterCard.click();

  const alphaCard = getGenerationCardByTitle(page, 2, alphaPerson.name);
  const charlieCard = getGenerationCardByTitle(page, 2, "Charlie Three");
  const indiaCard = getGenerationCardByTitle(page, 2, indiaPerson.name);
  const kiloCard = getGenerationCardByTitle(page, 2, "Kilo Eleven");
  const gen2RowTrack = getGenerationRow(page, 2).locator(".generator-row-track");

  await expect(alphaCard).toBeVisible();
  await expect(getGenerationRow(page, 2).locator(".cinenerdle-card-title")).toHaveCount(11);

  await alphaCard.click();

  const gen3Row = getGenerationRow(page, 3);
  await expect(gen3Row.locator(".cinenerdle-card")).toHaveCount(7);
  await expect(getTmdbBadgeIcon(alphaCard)).toHaveCount(1);

  await gen2RowTrack.evaluate((element) => {
    const cardButtons = Array.from(
      element.querySelectorAll<HTMLElement>(".generator-card-button"),
    );
    const thirdCard = cardButtons[2];
    const ninthCard = cardButtons[8];

    if (!thirdCard || !ninthCard) {
      throw new Error("Expected gen 2 row to contain at least 9 cards.");
    }

    const targetScrollLeft = Math.max(
      0,
      Math.min(
        (thirdCard.offsetLeft + ninthCard.offsetLeft + ninthCard.offsetWidth - element.clientWidth) / 2,
        element.scrollWidth - element.clientWidth,
      ),
    );

    element.scrollTo({
      left: targetScrollLeft,
      behavior: "auto",
    });
  });

  await expectCardVisibilityWithinRow(charlieCard, gen2RowTrack, true);
  await expectCardVisibilityWithinRow(indiaCard, gen2RowTrack, true);
  await expectCardVisibilityWithinRow(alphaCard, gen2RowTrack, false);
  await expect(getTmdbBadgeIcon(indiaCard)).toHaveCount(0);
  await expect
    .poll(() => ({
      indiaDetailsCount: countRecordedRequests(requests, indiaDetailsUrl),
      indiaMovieCreditsCount: countRecordedRequests(requests, indiaMovieCreditsUrl),
    }))
    .toEqual({
      indiaDetailsCount: 0,
      indiaMovieCreditsCount: 0,
    });

  await getPopularityBadge(indiaCard).click();

  await expect
    .poll(() => ({
      indiaDetailsCount: countRecordedRequests(requests, indiaDetailsUrl),
      indiaMovieCreditsCount: countRecordedRequests(requests, indiaMovieCreditsUrl),
    }))
    .toEqual({
      indiaDetailsCount: 1,
      indiaMovieCreditsCount: 1,
    });
  await expect(getTmdbBadgeIcon(indiaCard)).toHaveCount(1);
  await page.waitForTimeout(3000);
  await expectCardVisibilityWithinRow(indiaCard, gen2RowTrack, true);
  await expectCardVisibilityWithinRow(charlieCard, gen2RowTrack, true);
  await expectCardVisibilityWithinRow(alphaCard, gen2RowTrack, false);

  await indiaCard.click();

  await expectCardVisibilityWithinRow(charlieCard, gen2RowTrack, false);
  await expectCardVisibilityWithinRow(kiloCard, gen2RowTrack, true);

  await expect(getGenerationCardByTitle(page, 3, "India Movie A")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 3, "India Movie B")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 3, "Alpha Movie A")).toHaveCount(0);
  await expect(gen3Row.locator(".cinenerdle-card")).toHaveCount(7);
});
