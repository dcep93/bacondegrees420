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
const MATTHEW_SAHARA_PENELOPE_HASH =
  "/#person|Matthew+McConaughey|Sahara+(2005)|Pen%C3%A9lope+Cruz|Sahara+(2005)";
const MIXED_DEEP_LINK_HASH =
  "/#film|Fool's+Gold+(2008)|Matthew+McConaughey|A+Time+to+Kill+(1996)|Sandra+Bullock|A+Time+to+Kill+(1996)|Samuel+L.+Jackson|Snakes+on+a+Plane+(2006)|Samuel+L.+Jackson";
const MATTHEW_SEARCH_URL =
  "https://api.themoviedb.org/3/search/person?query=Matthew McConaughey";
const MATTHEW_DETAILS_URL =
  "https://api.themoviedb.org/3/person/10297";
const MATTHEW_MOVIE_CREDITS_URL =
  "https://api.themoviedb.org/3/person/10297/movie_credits";
const PENELOPE_SEARCH_URL =
  "https://api.themoviedb.org/3/search/person?query=Penélope Cruz";
const PENELOPE_DETAILS_URL =
  "https://api.themoviedb.org/3/person/6941";
const PENELOPE_MOVIE_CREDITS_URL =
  "https://api.themoviedb.org/3/person/6941/movie_credits";
const SAHARA_SEARCH_URL =
  "https://api.themoviedb.org/3/search/movie?query=Sahara";
const SAHARA_DETAILS_URL =
  "https://api.themoviedb.org/3/movie/7364";
const SAHARA_CREDITS_URL =
  "https://api.themoviedb.org/3/movie/7364/credits";

type ClipboardWindow = Window & {
  __copiedTexts?: string[];
};

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

async function installClipboardCapture(page: Page) {
  await page.addInitScript(() => {
    const copiedTexts: string[] = [];
    Object.defineProperty(window, "__copiedTexts", {
      configurable: true,
      value: copiedTexts,
    });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(text: string) {
          copiedTexts.push(text);
          return Promise.resolve();
        },
      },
    });
  });
}

async function getLastCopiedJson(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const copiedTexts = (window as ClipboardWindow).__copiedTexts ?? [];
    const copiedText = copiedTexts[copiedTexts.length - 1] ?? "[]";
    return JSON.parse(copiedText);
  });
}

async function seedCinenerdleStorage(
  page: Page,
  options: {
    dailyStarterTitles?: string[];
  } = {},
) {
  await page.addInitScript(
    ({ dailyStarterTitles }) => {
      const dailyStarterStorageKey = "cinenerdle2.dailyStarterTitles";
      const existingDailyStarterTitles = window.localStorage.getItem(dailyStarterStorageKey);

      window.localStorage.clear();

      if (existingDailyStarterTitles !== null) {
        window.localStorage.setItem(dailyStarterStorageKey, existingDailyStarterTitles);
      }

      if (dailyStarterTitles) {
        window.localStorage.setItem(
          dailyStarterStorageKey,
          JSON.stringify(dailyStarterTitles),
        );
      }

      window.localStorage.setItem("cinenerdle2.tmdbApiKey", "key:playwright-test-key");
      window.indexedDB.deleteDatabase("cinenerdle2");
    },
    {
      dailyStarterTitles: options.dailyStarterTitles ?? null,
    },
  );
}

async function primeCinenerdlePage(page: Page) {
  await seedCinenerdleStorage(page, {
    dailyStarterTitles: ["Zootopia (2016)"],
  });

  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input, init) => {
      const requestUrl = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const parsedUrl = new URL(requestUrl, window.location.href);

      if (parsedUrl.origin === "https://api.themoviedb.org" && parsedUrl.pathname === "/3/search/movie") {
        const query = parsedUrl.searchParams.get("query") ?? "";
        if (query.trim().toLowerCase() === "zootopia") {
          return new Response(JSON.stringify({
            results: [{
              id: 269149,
              title: "Zootopia",
              original_title: "Zootopia",
              poster_path: "/zootopia.jpg",
              release_date: "2016-03-04",
              popularity: 88,
              vote_average: 7.7,
              vote_count: 16000,
            }],
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return originalFetch(input, init);
    };
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

test("bare movie-title submits stay unresolved after dismissing suggestions", async ({ page }) => {
  await primeCinenerdlePage(page);

  await page.route("**/dump.json", async (route) => {
    await route.fulfill(createJsonResponse({
      format: "cinenerdle-indexed-db-snapshot",
      version: 11,
      people: [
        {
          tmdbId: 60,
          name: "Al Pacino",
          movieConnectionKeys: ["heat (1995)"],
          popularity: 77,
          fromTmdb: {
            fetchTimestamp: "2026-03-28T12:00:00.000Z",
            profilePath: "/al-pacino.jpg",
          },
        },
      ],
      films: [
        {
          tmdbId: 321,
          title: "Heat",
          year: "1995",
          posterPath: "/heat.jpg",
          popularity: 88,
          voteAverage: 8.2,
          voteCount: 9000,
          releaseDate: "1995-12-15",
          fromTmdb: {
            fetchTimestamp: "2026-03-28T12:00:00.000Z",
            genres: [],
          },
          personConnectionKeys: ["al pacino"],
          people: [],
        },
      ],
    }));
  });

  await page.route("https://api.themoviedb.org/**", async (route) => {
    throw new Error(`Unexpected TMDb request: ${route.request().url()}`);
  });

  await page.goto("/");

  const connectionInput = page.locator(".bacon-connection-input");
  const heatSuggestion = page
    .locator(".bacon-connection-option")
    .filter({ hasText: "Heat (1995)" });

  await expect(connectionInput).toBeEnabled();

  await connectionInput.fill("Heat");
  await expect(heatSuggestion).toBeVisible();

  await connectionInput.press("Escape");
  await expect(page.locator(".bacon-connection-dropdown")).toHaveCount(0);

  await connectionInput.press("Enter");

  await expect(connectionInput).toHaveValue("Heat");
});

test("bare movie-title suggestions still work with Enter and click selection", async ({ page }) => {
  await primeCinenerdlePage(page);

  await page.route("**/dump.json", async (route) => {
    await route.fulfill(createJsonResponse({
      format: "cinenerdle-indexed-db-snapshot",
      version: 11,
      people: [
        {
          tmdbId: 60,
          name: "Al Pacino",
          movieConnectionKeys: ["heat (1995)"],
          popularity: 77,
          fromTmdb: {
            fetchTimestamp: "2026-03-28T12:00:00.000Z",
            profilePath: "/al-pacino.jpg",
          },
        },
      ],
      films: [
        {
          tmdbId: 321,
          title: "Heat",
          year: "1995",
          posterPath: "/heat.jpg",
          popularity: 88,
          voteAverage: 8.2,
          voteCount: 9000,
          releaseDate: "1995-12-15",
          fromTmdb: {
            fetchTimestamp: "2026-03-28T12:00:00.000Z",
            genres: [],
          },
          personConnectionKeys: ["al pacino"],
          people: [],
        },
      ],
    }));
  });

  await page.route("https://api.themoviedb.org/**", async (route) => {
    throw new Error(`Unexpected TMDb request: ${route.request().url()}`);
  });

  await page.goto("/");

  const connectionInput = page.locator(".bacon-connection-input");
  const heatSuggestion = page
    .locator(".bacon-connection-option")
    .filter({ hasText: "Heat (1995)" });

  await expect(connectionInput).toBeEnabled();

  await connectionInput.fill("Heat");
  await expect(heatSuggestion).toBeVisible();

  await connectionInput.press("Enter");
  await expect(connectionInput).toHaveValue("");

  await connectionInput.fill("Heat");
  await expect(heatSuggestion).toBeVisible();

  await heatSuggestion.click();
  await expect(connectionInput).toHaveValue("");
});

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

  await seedCinenerdleStorage(page);

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

    const movieDetailsId = url.pathname.match(/\/movie\/(\d+)$/)?.[1] ?? "";
    if (movieDetailsId === "1266127") {
      await route.fulfill(createJsonResponse({
        id: 1266127,
        title: "Ready or Not: Here I Come",
        original_title: "Ready or Not: Here I Come",
        poster_path: "/ready-or-not-2.jpg",
        release_date: "2026-04-10",
        popularity: 60.28,
        vote_average: 7.2,
        vote_count: 100,
      }));
      return;
    }

    if (movieDetailsId === "98") {
      await route.fulfill(createJsonResponse({
        id: 98,
        title: "Gladiator",
        original_title: "Gladiator",
        poster_path: "/gladiator.jpg",
        release_date: "2000-05-04",
        popularity: 20.33,
        vote_average: 8.22,
        vote_count: 20658,
      }));
      return;
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
    .poll(() => ({
      dailyStartersCount: countRecordedRequests(
        requests,
        "https://www.cinenerdle2.app/api/battle-data/daily-starters",
      ),
      readySearchCount: countRecordedRequests(
        requests,
        "https://api.themoviedb.org/3/search/movie?query=Ready or Not: Here I Come",
      ),
      gladiatorSearchCount: countRecordedRequests(
        requests,
        "https://api.themoviedb.org/3/search/movie?query=Gladiator",
      ),
      readyDetailsCount: countRecordedRequests(
        requests,
        "https://api.themoviedb.org/3/movie/1266127",
      ),
      readyCreditsCount: countRecordedRequests(
        requests,
        "https://api.themoviedb.org/3/movie/1266127/credits",
      ),
      gladiatorDetailsCount: countRecordedRequests(
        requests,
        "https://api.themoviedb.org/3/movie/98",
      ),
      gladiatorCreditsCount: countRecordedRequests(
        requests,
        "https://api.themoviedb.org/3/movie/98/credits",
      ),
    }))
    .toEqual({
      dailyStartersCount: 2,
      readySearchCount: 2,
      gladiatorSearchCount: 2,
      readyDetailsCount: 1,
      readyCreditsCount: 1,
      gladiatorDetailsCount: 1,
      gladiatorCreditsCount: 1,
    });
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

  await seedCinenerdleStorage(page, {
    dailyStarterTitles: [
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
    ],
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

    const movieDetailsId = Number(url.pathname.match(/\/3\/movie\/(\d+)$/)?.[1] ?? NaN);
    if (Number.isFinite(movieDetailsId)) {
      const movie = Array.from(movieSearchResultsByQuery.values()).find(
        (candidate) => candidate.id === movieDetailsId,
      );
      if (!movie) {
        throw new Error(`Unexpected movie details request: ${url.pathname}`);
      }

      await route.fulfill(createJsonResponse(movie));
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

test("Big Lebowski deep link renders movie-credit children when playwright prefetch is skipped", async ({ page }) => {
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
      hasPersonDetails: false,
      hasPersonMovieCredits: false,
    });
});

test("Big Lebowski deep link keeps person badges unresolved when playwright prefetch is skipped", async ({ page }) => {
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
      hasPersonDetails: false,
      hasPersonMovieCredits: false,
      hasFollowOnMoviePrefetch: false,
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
  await expect(jeffBridgesCard.locator(".cinenerdle-card-count")).toHaveCount(0);

  await getPopularityBadge(jeffBridgesCard).click();

  await expect
    .poll(() => ({
      personDetailsCount: countRecordedRequests(requests, JEFF_BRIDGES_DETAILS_URL),
      personMovieCreditsCount: countRecordedRequests(requests, JEFF_BRIDGES_MOVIE_CREDITS_URL),
    }))
    .toEqual({
      personDetailsCount: 1,
      personMovieCreditsCount: 1,
    });
  await expect(jeffBridgesCard.locator(".cinenerdle-card-count")).toBeVisible();

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

test("deep links render full hash paths, hydrate unique entities once, and revisit from IndexedDB without refetching", async ({
  page,
}) => {
  const firstPhaseRequests = createRouteRequestRecorder();
  const context = page.context();

  await installClipboardCapture(page);
  await primeCinenerdlePage(page);

  await page.route("**/dump.json", async (route) => {
    await route.fulfill(createJsonResponse({
      format: "cinenerdle-indexed-db-snapshot",
      version: 11,
      people: [],
      films: [],
    }));
  });

  await page.route("https://api.themoviedb.org/**", async (route) => {
    firstPhaseRequests.record(route.request().url());
    const url = new URL(route.request().url());

    await delay(120);

    if (url.pathname === "/3/search/person") {
      const query = url.searchParams.get("query");
      if (query === "Matthew McConaughey") {
        await route.fulfill(createJsonResponse({
          results: [{
            id: 10297,
            name: "Matthew McConaughey",
            popularity: 18.4,
            profile_path: "/matthew.jpg",
          }],
        }));
        return;
      }

      if (query === "Penélope Cruz") {
        await route.fulfill(createJsonResponse({
          results: [{
            id: 6941,
            name: "Penélope Cruz",
            popularity: 14.7,
            profile_path: "/penelope.jpg",
          }],
        }));
        return;
      }

      throw new Error(`Unexpected person search query: ${query}`);
    }

    if (url.pathname === "/3/search/movie") {
      const query = url.searchParams.get("query");
      if (query !== "Sahara") {
        throw new Error(`Unexpected movie search query: ${query}`);
      }

      await route.fulfill(createJsonResponse({
        results: [{
          id: 7364,
          title: "Sahara",
          original_title: "Sahara",
          poster_path: "/sahara.jpg",
          release_date: "2005-04-08",
          popularity: 21.1,
          vote_average: 5.9,
          vote_count: 1534,
        }],
      }));
      return;
    }

    if (url.pathname === "/3/person/10297") {
      await route.fulfill(createJsonResponse({
        id: 10297,
        name: "Matthew McConaughey",
        popularity: 18.4,
        profile_path: "/matthew.jpg",
      }));
      return;
    }

    if (url.pathname === "/3/person/10297/movie_credits") {
      await route.fulfill(createJsonResponse({
        cast: [{
          id: 7364,
          title: "Sahara",
          original_title: "Sahara",
          poster_path: "/sahara.jpg",
          release_date: "2005-04-08",
          popularity: 21.1,
          vote_average: 5.9,
          vote_count: 1534,
          character: "Dirk Pitt",
        }],
        crew: [],
      }));
      return;
    }

    if (url.pathname === "/3/person/6941") {
      await route.fulfill(createJsonResponse({
        id: 6941,
        name: "Penélope Cruz",
        popularity: 14.7,
        profile_path: "/penelope.jpg",
      }));
      return;
    }

    if (url.pathname === "/3/person/6941/movie_credits") {
      await route.fulfill(createJsonResponse({
        cast: [{
          id: 7364,
          title: "Sahara",
          original_title: "Sahara",
          poster_path: "/sahara.jpg",
          release_date: "2005-04-08",
          popularity: 21.1,
          vote_average: 5.9,
          vote_count: 1534,
          character: "Eva Rojas",
        }],
        crew: [],
      }));
      return;
    }

    if (url.pathname === "/3/movie/7364") {
      await route.fulfill(createJsonResponse({
        id: 7364,
        title: "Sahara",
        original_title: "Sahara",
        poster_path: "/sahara.jpg",
        release_date: "2005-04-08",
        popularity: 21.1,
        vote_average: 5.9,
        vote_count: 1534,
      }));
      return;
    }

    if (url.pathname === "/3/movie/7364/credits") {
      await route.fulfill(createJsonResponse({
        cast: [
          {
            id: 10297,
            name: "Matthew McConaughey",
            popularity: 18.4,
            profile_path: "/matthew.jpg",
            character: "Dirk Pitt",
            known_for_department: "Acting",
            order: 0,
          },
          {
            id: 6941,
            name: "Penélope Cruz",
            popularity: 14.7,
            profile_path: "/penelope.jpg",
            character: "Eva Rojas",
            known_for_department: "Acting",
            order: 1,
          },
        ],
        crew: [],
      }));
      return;
    }

    throw new Error(`Unexpected TMDb request: ${url.pathname}`);
  });

  await page.goto(MATTHEW_SAHARA_PENELOPE_HASH);

  await expect(getGenerationCardByTitle(page, 0, "Matthew McConaughey")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 1, "Sahara")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 2, "Penélope Cruz")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 3, "Sahara")).toBeVisible();
  await expect(page.locator(".cinenerdle-card-detail", { hasText: "Not cached yet" })).toHaveCount(2);
  await expect(page.locator(".cinenerdle-card-subtitle", { hasText: "Crew" })).toHaveCount(2);

  await expect
    .poll(() => ({
      total: getTmdbRequests(firstPhaseRequests).length,
      matthewSearchCount: countRecordedRequests(firstPhaseRequests, MATTHEW_SEARCH_URL),
      matthewDetailsCount: countRecordedRequests(firstPhaseRequests, MATTHEW_DETAILS_URL),
      matthewMovieCreditsCount: countRecordedRequests(firstPhaseRequests, MATTHEW_MOVIE_CREDITS_URL),
      penelopeSearchCount: countRecordedRequests(firstPhaseRequests, PENELOPE_SEARCH_URL),
      penelopeDetailsCount: countRecordedRequests(firstPhaseRequests, PENELOPE_DETAILS_URL),
      penelopeMovieCreditsCount: countRecordedRequests(firstPhaseRequests, PENELOPE_MOVIE_CREDITS_URL),
      saharaSearchCount: countRecordedRequests(firstPhaseRequests, SAHARA_SEARCH_URL),
      saharaDetailsCount: countRecordedRequests(firstPhaseRequests, SAHARA_DETAILS_URL),
      saharaCreditsCount: countRecordedRequests(firstPhaseRequests, SAHARA_CREDITS_URL),
    }))
    .toEqual({
      total: 9,
      matthewSearchCount: 1,
      matthewDetailsCount: 1,
      matthewMovieCreditsCount: 1,
      penelopeSearchCount: 1,
      penelopeDetailsCount: 1,
      penelopeMovieCreditsCount: 1,
      saharaSearchCount: 1,
      saharaDetailsCount: 1,
      saharaCreditsCount: 1,
    });

  await page.locator(".bacon-title").click();

  await expect
    .poll(async () => {
      const copiedEntries = await getLastCopiedJson(page);
      if (!Array.isArray(copiedEntries)) {
        return -1;
      }

      return copiedEntries.filter((entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "event" in entry &&
        typeof entry.event === "string" &&
        entry.event.startsWith("prefetch skipped in playwright for ")
      ).length;
    })
    .toBe(3);

  await page.close();

  const mixedRequests = createRouteRequestRecorder();
  let activeMixedRequests = mixedRequests;
  const page2 = await context.newPage();

  await primeCinenerdlePage(page2);

  await page2.route("**/dump.json", async (route) => {
    await route.fulfill(createJsonResponse({
      format: "cinenerdle-indexed-db-snapshot",
      version: 11,
      people: [
        {
          tmdbId: 10297,
          name: "Matthew McConaughey",
          movieConnectionKeys: ["contact (1997)"],
          popularity: 18.4,
          fromTmdb: {
            fetchTimestamp: "2026-03-28T12:00:00.000Z",
            profilePath: "/matthew.jpg",
          },
        },
      ],
      films: [
        {
          tmdbId: 8619,
          title: "Fool's Gold",
          year: "2008",
          posterPath: "/fools-gold.jpg",
          popularity: 14.1,
          voteAverage: 5.7,
          voteCount: 987,
          releaseDate: "2008-02-08",
          fromTmdb: null,
          personConnectionKeys: [],
          people: [],
        },
        {
          tmdbId: 3133,
          title: "A Time to Kill",
          year: "1996",
          posterPath: "/a-time-to-kill.jpg",
          popularity: 17.8,
          voteAverage: 7.4,
          voteCount: 1644,
          releaseDate: "1996-07-24",
          fromTmdb: null,
          personConnectionKeys: ["sandra bullock", "kevin spacey"],
          people: [],
        },
        {
          tmdbId: 686,
          title: "Contact",
          year: "1997",
          posterPath: "/contact.jpg",
          popularity: 18.9,
          voteAverage: 7.4,
          voteCount: 4661,
          releaseDate: "1997-07-11",
          fromTmdb: null,
          personConnectionKeys: ["matthew mcconaughey"],
          people: [
            {
              personTmdbId: 10297,
              roleType: "cast",
              role: "Palmer Joss",
              order: 0,
              profilePath: "/matthew.jpg",
              fetchTimestamp: "2026-03-28T12:00:00.000Z",
            },
          ],
        },
      ],
    }));
  });

  await page2.route("https://api.themoviedb.org/**", async (route) => {
    activeMixedRequests.record(route.request().url());
    const url = new URL(route.request().url());

    await delay(120);

    if (url.pathname === "/3/search/person") {
      const query = url.searchParams.get("query");
      if (query === "Sandra Bullock") {
        await route.fulfill(createJsonResponse({
          results: [{
            id: 18277,
            name: "Sandra Bullock",
            popularity: 16.2,
            profile_path: "/sandra.jpg",
          }],
        }));
        return;
      }

      if (query === "Samuel L. Jackson") {
        await route.fulfill(createJsonResponse({
          results: [{
            id: 2231,
            name: "Samuel L. Jackson",
            popularity: 20.1,
            profile_path: "/samuel.jpg",
          }],
        }));
        return;
      }

      throw new Error(`Unexpected mixed-scenario person search query: ${query}`);
    }

    if (url.pathname === "/3/search/movie") {
      const query = url.searchParams.get("query");
      if (query !== "Snakes on a Plane") {
        throw new Error(`Unexpected mixed-scenario movie search query: ${query}`);
      }

      await route.fulfill(createJsonResponse({
        results: [{
          id: 326,
          title: "Snakes on a Plane",
          original_title: "Snakes on a Plane",
          poster_path: "/snakes-on-a-plane.jpg",
          release_date: "2006-08-17",
          popularity: 16.6,
          vote_average: 5.5,
          vote_count: 1802,
        }],
      }));
      return;
    }

    if (url.pathname === "/3/movie/8619") {
      await route.fulfill(createJsonResponse({
        id: 8619,
        title: "Fool's Gold",
        original_title: "Fool's Gold",
        poster_path: "/fools-gold.jpg",
        release_date: "2008-02-08",
        popularity: 14.1,
        vote_average: 5.7,
        vote_count: 987,
      }));
      return;
    }

    if (url.pathname === "/3/movie/8619/credits") {
      await route.fulfill(createJsonResponse({
        cast: [{
          id: 10297,
          name: "Matthew McConaughey",
          popularity: 18.4,
          profile_path: "/matthew.jpg",
          character: "Ben Finnegan",
          known_for_department: "Acting",
          order: 0,
        }],
        crew: [],
      }));
      return;
    }

    if (url.pathname === "/3/movie/3133") {
      await route.fulfill(createJsonResponse({
        id: 3133,
        title: "A Time to Kill",
        original_title: "A Time to Kill",
        poster_path: "/a-time-to-kill.jpg",
        release_date: "1996-07-24",
        popularity: 17.8,
        vote_average: 7.4,
        vote_count: 1644,
      }));
      return;
    }

    if (url.pathname === "/3/movie/3133/credits") {
      await route.fulfill(createJsonResponse({
        cast: [
          {
            id: 18277,
            name: "Sandra Bullock",
            popularity: 16.2,
            profile_path: "/sandra.jpg",
            character: "Ellen Roark",
            known_for_department: "Acting",
            order: 0,
          },
          {
            id: 2231,
            name: "Samuel L. Jackson",
            popularity: 20.1,
            profile_path: "/samuel.jpg",
            character: "Carl Lee Hailey",
            known_for_department: "Acting",
            order: 1,
          },
        ],
        crew: [],
      }));
      return;
    }

    if (url.pathname === "/3/person/18277") {
      await route.fulfill(createJsonResponse({
        id: 18277,
        name: "Sandra Bullock",
        popularity: 16.2,
        profile_path: "/sandra.jpg",
      }));
      return;
    }

    if (url.pathname === "/3/person/18277/movie_credits") {
      await route.fulfill(createJsonResponse({
        cast: [{
          id: 3133,
          title: "A Time to Kill",
          original_title: "A Time to Kill",
          poster_path: "/a-time-to-kill.jpg",
          release_date: "1996-07-24",
          popularity: 17.8,
          vote_average: 7.4,
          vote_count: 1644,
          character: "Ellen Roark",
        }],
        crew: [],
      }));
      return;
    }

    if (url.pathname === "/3/person/2231") {
      await route.fulfill(createJsonResponse({
        id: 2231,
        name: "Samuel L. Jackson",
        popularity: 20.1,
        profile_path: "/samuel.jpg",
      }));
      return;
    }

    if (url.pathname === "/3/person/2231/movie_credits") {
      await route.fulfill(createJsonResponse({
        cast: [
          {
            id: 3133,
            title: "A Time to Kill",
            original_title: "A Time to Kill",
            poster_path: "/a-time-to-kill.jpg",
            release_date: "1996-07-24",
            popularity: 17.8,
            vote_average: 7.4,
            vote_count: 1644,
            character: "Carl Lee Hailey",
          },
          {
            id: 326,
            title: "Snakes on a Plane",
            original_title: "Snakes on a Plane",
            poster_path: "/snakes-on-a-plane.jpg",
            release_date: "2006-08-17",
            popularity: 16.6,
            vote_average: 5.5,
            vote_count: 1802,
            character: "Neville Flynn",
          },
        ],
        crew: [],
      }));
      return;
    }

    if (url.pathname === "/3/movie/326") {
      await route.fulfill(createJsonResponse({
        id: 326,
        title: "Snakes on a Plane",
        original_title: "Snakes on a Plane",
        poster_path: "/snakes-on-a-plane.jpg",
        release_date: "2006-08-17",
        popularity: 16.6,
        vote_average: 5.5,
        vote_count: 1802,
      }));
      return;
    }

    if (url.pathname === "/3/movie/326/credits") {
      await route.fulfill(createJsonResponse({
        cast: [{
          id: 2231,
          name: "Samuel L. Jackson",
          popularity: 20.1,
          profile_path: "/samuel.jpg",
          character: "Neville Flynn",
          known_for_department: "Acting",
          order: 0,
        }],
        crew: [],
      }));
      return;
    }

    throw new Error(`Unexpected mixed-scenario TMDb request: ${url.pathname}`);
  });

  await page2.goto(MIXED_DEEP_LINK_HASH);

  await expect(getGenerationCardByTitle(page2, 0, "Fool's Gold")).toBeVisible();
  await expect(getGenerationCardByTitle(page2, 0, "Fool's Gold").locator(".cinenerdle-card-count")).toHaveCount(0);
  await expect(getGenerationCardByTitle(page2, 1, "Matthew McConaughey")).toBeVisible();
  await expect(getGenerationCardByTitle(page2, 1, "Matthew McConaughey").locator(".cinenerdle-card-count")).toHaveCount(1);
  await expect(getGenerationCardByTitle(page2, 2, "A Time to Kill")).toBeVisible();
  await expect(getGenerationCardByTitle(page2, 2, "A Time to Kill").locator(".cinenerdle-card-count")).toHaveCount(0);
  await expect(getGenerationRow(page2, 3).locator(".cinenerdle-card")).toHaveCount(2);
  await expect(getGenerationCardByTitle(page2, 3, "Sandra Bullock")).toBeVisible();
  await expect(getGenerationCardByTitle(page2, 4, "A Time to Kill")).toBeVisible();
  await expect(getGenerationCardByTitle(page2, 5, "Samuel L. Jackson")).toBeVisible();
  await expect(getGenerationCardByTitle(page2, 6, "Snakes on a Plane")).toBeVisible();
  await expect(getGenerationCardByTitle(page2, 7, "Samuel L. Jackson")).toBeVisible();
  await expect(
    getGenerationCardByTitle(page2, 6, "Snakes on a Plane").locator(".cinenerdle-card-detail", {
      hasText: "Not cached yet",
    }),
  ).toHaveCount(1);

  await expect
    .poll(() => ({
      foolsGoldDetailsCount: countRecordedRequests(
        activeMixedRequests,
        "https://api.themoviedb.org/3/movie/8619",
      ),
      foolsGoldCreditsCount: countRecordedRequests(
        activeMixedRequests,
        "https://api.themoviedb.org/3/movie/8619/credits",
      ),
      aTimeToKillDetailsCount: countRecordedRequests(
        activeMixedRequests,
        "https://api.themoviedb.org/3/movie/3133",
      ),
      aTimeToKillCreditsCount: countRecordedRequests(
        activeMixedRequests,
        "https://api.themoviedb.org/3/movie/3133/credits",
      ),
      sandraSearchCount: countRecordedRequests(
        activeMixedRequests,
        "https://api.themoviedb.org/3/search/person?query=Sandra Bullock",
      ),
      samuelSearchCount: countRecordedRequests(
        activeMixedRequests,
        "https://api.themoviedb.org/3/search/person?query=Samuel L. Jackson",
      ),
      snakesSearchCount: countRecordedRequests(
        activeMixedRequests,
        "https://api.themoviedb.org/3/search/movie?query=Snakes on a Plane",
      ),
    }))
    .toEqual({
      foolsGoldDetailsCount: 1,
      foolsGoldCreditsCount: 1,
      aTimeToKillDetailsCount: 1,
      aTimeToKillCreditsCount: 1,
      sandraSearchCount: 1,
      samuelSearchCount: 1,
      snakesSearchCount: 1,
    });

  await expect
    .poll(async () => {
      const sandraBadgeCount = await getCinenerdleCardByTitle(page2, "Sandra Bullock").locator(".cinenerdle-card-count").count();
      const samuelBadgeCount = await getCinenerdleCardByTitle(page2, "Samuel L. Jackson").locator(".cinenerdle-card-count").count();
      const snakesBadgeCount = await getCinenerdleCardByTitle(page2, "Snakes on a Plane").locator(".cinenerdle-card-count").count();
      const uncachedDetailCount = await page2.locator(".cinenerdle-card-detail", { hasText: "Not cached yet" }).count();

      return (
        sandraBadgeCount >= 1 &&
        samuelBadgeCount >= 2 &&
        snakesBadgeCount >= 1 &&
        uncachedDetailCount === 0
      );
    })
    .toBe(true);

  const revisitRequests = createRouteRequestRecorder();
  activeMixedRequests = revisitRequests;

  await page2.goto(MIXED_DEEP_LINK_HASH);
  await expect(getCinenerdleCardByTitle(page2, "Snakes on a Plane").first()).toBeVisible();
  await expect.poll(() => getTmdbRequests(revisitRequests).length).toBe(0);
});

test("gen 2 refresh redraws gen 3 for the newly selected person", async ({
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

  await seedCinenerdleStorage(page, {
    dailyStarterTitles: ["Mock Starter Movie (2001)"],
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
      version: 11,
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

  await indiaCard.click();

  await expect(getGenerationCardByTitle(page, 3, "India Movie A")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 3, "India Movie B")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 3, "Alpha Movie A")).toHaveCount(0);
  await expect(gen3Row.locator(".cinenerdle-card")).toHaveCount(7);
});

test("deep descendant selection renders cached DB children before the delayed TMDb refresh completes", async ({
  page,
}) => {
  const requests = createRouteRequestRecorder();
  let releaseIndiaMovieCredits: (() => void) | null = null;
  const indiaMovieCreditsGate = new Promise<void>((resolve) => {
    releaseIndiaMovieCredits = resolve;
  });
  const indiaDetailsUrl = "https://api.themoviedb.org/3/person/1009";
  const indiaMovieCreditsUrl = "https://api.themoviedb.org/3/person/1009/movie_credits";

  await primeCinenerdlePage(page);

  await page.route("**/dump.json", async (route) => {
    await route.fulfill(createJsonResponse({
      format: "cinenerdle-indexed-db-snapshot",
      version: 11,
      people: [
        {
          tmdbId: 1001,
          name: "Alpha One",
          movieConnectionKeys: [
            "mock starter movie (2001)",
            "alpha movie a (2003)",
            "alpha movie b (2004)",
          ],
          popularity: 500,
          fromTmdb: {
            fetchTimestamp: "2026-03-28T12:00:00.000Z",
            profilePath: "/1001.jpg",
          },
        },
        {
          tmdbId: 1009,
          name: "India Nine",
          movieConnectionKeys: [
            "mock starter movie (2001)",
            "india movie a (2011)",
            "india movie b (2012)",
          ],
          popularity: 40,
          fromTmdb: null,
        },
      ],
      films: [
        {
          tmdbId: 9001,
          title: "Mock Starter Movie",
          year: "2001",
          posterPath: "/mock-starter-movie.jpg",
          popularity: 95.5,
          voteAverage: 7.4,
          voteCount: 8100,
          releaseDate: "2001-06-15",
          fromTmdb: {
            fetchTimestamp: "2026-03-28T12:00:00.000Z",
            genres: [],
          },
          personConnectionKeys: ["alpha one", "india nine"],
          people: [],
        },
        {
          tmdbId: 2101,
          title: "Alpha Movie A",
          year: "2003",
          posterPath: "/alpha-a.jpg",
          popularity: 90,
          voteAverage: 7.1,
          voteCount: 4100,
          releaseDate: "2003-02-14",
          fromTmdb: {
            fetchTimestamp: "2026-03-28T12:00:00.000Z",
            genres: [],
          },
          personConnectionKeys: ["alpha one"],
          people: [],
        },
        {
          tmdbId: 2102,
          title: "Alpha Movie B",
          year: "2004",
          posterPath: "/alpha-b.jpg",
          popularity: 88,
          voteAverage: 7.2,
          voteCount: 3900,
          releaseDate: "2004-03-19",
          fromTmdb: {
            fetchTimestamp: "2026-03-28T12:00:00.000Z",
            genres: [],
          },
          personConnectionKeys: ["alpha one"],
          people: [],
        },
        {
          tmdbId: 2201,
          title: "India Movie A",
          year: "2011",
          posterPath: "/india-a.jpg",
          popularity: 72,
          voteAverage: 6.8,
          voteCount: 2800,
          releaseDate: "2011-01-21",
          fromTmdb: {
            fetchTimestamp: "2026-03-28T12:00:00.000Z",
            genres: [],
          },
          personConnectionKeys: ["india nine"],
          people: [],
        },
        {
          tmdbId: 2202,
          title: "India Movie B",
          year: "2012",
          posterPath: "/india-b.jpg",
          popularity: 70,
          voteAverage: 6.9,
          voteCount: 2600,
          releaseDate: "2012-02-17",
          fromTmdb: {
            fetchTimestamp: "2026-03-28T12:00:00.000Z",
            genres: [],
          },
          personConnectionKeys: ["india nine"],
          people: [],
        },
      ],
    }));
  });

  await page.route("https://api.themoviedb.org/**", async (route) => {
    requests.record(route.request().url());
    const url = new URL(route.request().url());

    if (url.pathname === "/3/person/1009") {
      await route.fulfill(createJsonResponse({
        id: 1009,
        name: "India Nine",
        popularity: 40,
        profile_path: "/1009.jpg",
      }));
      return;
    }

    const personDetailsId = Number(url.pathname.match(/^\/3\/person\/(\d+)$/)?.[1] ?? NaN);
    if (Number.isFinite(personDetailsId)) {
      await route.fulfill(createJsonResponse({
        id: personDetailsId,
        name: personDetailsId === 1001 ? "Alpha One" : `Person ${personDetailsId}`,
        popularity: personDetailsId === 1001 ? 500 : 0,
        profile_path: `/${personDetailsId}.jpg`,
      }));
      return;
    }

    if (url.pathname === "/3/person/1009/movie_credits") {
      await indiaMovieCreditsGate;
      await route.fulfill(createJsonResponse({
        cast: [
          {
            id: 9001,
            title: "Mock Starter Movie",
            original_title: "Mock Starter Movie",
            poster_path: "/mock-starter-movie.jpg",
            release_date: "2001-06-15",
            popularity: 95.5,
            vote_average: 7.4,
            vote_count: 8100,
            character: "India Nine Character",
          },
          {
            id: 2201,
            title: "India Movie A",
            original_title: "India Movie A",
            poster_path: "/india-a.jpg",
            release_date: "2011-01-21",
            popularity: 72,
            vote_average: 6.8,
            vote_count: 2800,
            character: "India Role 1",
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
            character: "India Role 2",
          },
        ],
        crew: [],
      }));
      return;
    }

    const personMovieCreditsId = Number(
      url.pathname.match(/^\/3\/person\/(\d+)\/movie_credits$/)?.[1] ?? NaN,
    );
    if (Number.isFinite(personMovieCreditsId)) {
      await route.fulfill(createJsonResponse({
        cast: [],
        crew: [],
      }));
      return;
    }

    const movieDetailsId = Number(url.pathname.match(/^\/3\/movie\/(\d+)$/)?.[1] ?? NaN);
    if (Number.isFinite(movieDetailsId)) {
      const movieById = new Map([
        [2101, {
          id: 2101,
          title: "Alpha Movie A",
          original_title: "Alpha Movie A",
          poster_path: "/alpha-a.jpg",
          release_date: "2003-02-14",
          popularity: 90,
          vote_average: 7.1,
          vote_count: 4100,
        }],
        [2102, {
          id: 2102,
          title: "Alpha Movie B",
          original_title: "Alpha Movie B",
          poster_path: "/alpha-b.jpg",
          release_date: "2004-03-19",
          popularity: 88,
          vote_average: 7.2,
          vote_count: 3900,
        }],
        [2201, {
          id: 2201,
          title: "India Movie A",
          original_title: "India Movie A",
          poster_path: "/india-a.jpg",
          release_date: "2011-01-21",
          popularity: 72,
          vote_average: 6.8,
          vote_count: 2800,
        }],
        [2202, {
          id: 2202,
          title: "India Movie B",
          original_title: "India Movie B",
          poster_path: "/india-b.jpg",
          release_date: "2012-02-17",
          popularity: 70,
          vote_average: 6.9,
          vote_count: 2600,
        }],
      ]).get(movieDetailsId);

      if (movieById) {
        await route.fulfill(createJsonResponse(movieById));
        return;
      }
    }

    const movieCreditsId = Number(url.pathname.match(/^\/3\/movie\/(\d+)\/credits$/)?.[1] ?? NaN);
    if (Number.isFinite(movieCreditsId)) {
      await route.fulfill(createJsonResponse({
        cast: [],
        crew: [],
      }));
      return;
    }

    throw new Error(`Unexpected TMDb request: ${url.pathname}`);
  });

  await page.goto("/#film|Mock+Starter+Movie+(2001)|Alpha+One");

  const alphaCard = getGenerationCardByTitle(page, 1, "Alpha One");
  const indiaCard = getGenerationCardByTitle(page, 1, "India Nine");

  await expect(alphaCard).toBeVisible();
  await expect(indiaCard).toBeVisible();
  await expect(getTmdbBadgeIcon(indiaCard)).toHaveCount(0);
  await expect(getGenerationCardByTitle(page, 2, "Alpha Movie A")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 2, "India Movie A")).toHaveCount(0);

  await indiaCard.click();

  await expect
    .poll(() => ({
      indiaDetailsCount: countRecordedRequests(requests, indiaDetailsUrl),
      indiaMovieCreditsCount: countRecordedRequests(requests, indiaMovieCreditsUrl),
    }))
    .toEqual({
      indiaDetailsCount: 1,
      indiaMovieCreditsCount: 1,
    });

  await expect(getGenerationCardByTitle(page, 2, "India Movie A")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 2, "India Movie B")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 2, "Alpha Movie A")).toHaveCount(0);
  await expect(getTmdbBadgeIcon(indiaCard)).toHaveCount(0);

  releaseIndiaMovieCredits?.();

  await expect(getTmdbBadgeIcon(indiaCard)).toHaveCount(1);
  await expect(getGenerationCardByTitle(page, 2, "India Movie A")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 2, "India Movie B")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 2, "Alpha Movie A")).toHaveCount(0);
});

test("zootopia-to-fred-willard regression keeps fred root navigation and bookmark toggle stable", async ({ page }) => {
  const dumpSnapshot = {
    format: "cinenerdle-indexed-db-snapshot",
    version: 11,
    people: [
      {
        tmdbId: 9001,
        name: "Judy Hopps",
        movieConnectionKeys: [
          "zootopia (2016)",
          "best in show (2000)",
        ],
        popularity: 44,
        fromTmdb: {
          fetchTimestamp: "2026-03-28T12:00:00.000Z",
          profilePath: "/judy-hopps.jpg",
        },
      },
      {
        tmdbId: 9002,
        name: "Fred Willard",
        movieConnectionKeys: [
          "best in show (2000)",
        ],
        popularity: 41,
        fromTmdb: {
          fetchTimestamp: "2026-03-28T12:00:00.000Z",
          profilePath: "/fred-willard.jpg",
        },
      },
    ],
    films: [
      {
        tmdbId: 269149,
        title: "Zootopia",
        year: "2016",
        posterPath: "/zootopia.jpg",
        popularity: 88,
        voteAverage: 7.7,
        voteCount: 16000,
        releaseDate: "2016-03-04",
        fromTmdb: {
          fetchTimestamp: "2026-03-28T12:00:00.000Z",
          genres: [],
        },
        personConnectionKeys: ["judy hopps"],
        people: [],
      },
      {
        tmdbId: 11011,
        title: "Best in Show",
        year: "2000",
        posterPath: "/best-in-show.jpg",
        popularity: 54,
        voteAverage: 7.1,
        voteCount: 1300,
        releaseDate: "2000-09-29",
        fromTmdb: {
          fetchTimestamp: "2026-03-28T12:00:00.000Z",
          genres: [],
        },
        personConnectionKeys: ["judy hopps", "fred willard"],
        people: [],
      },
    ],
  };
  await seedCinenerdleStorage(page, {
    dailyStarterTitles: ["Zootopia (2016)"],
  });

  await page.route("https://www.cinenerdle2.app/api/battle-data/daily-starters?*", async (route) => {
    await route.fulfill(createJsonResponse({
      data: [{ id: "starter-zootopia", title: "Zootopia (2016)" }],
    }));
  });

  await page.route("**/dump.json", async (route) => {
    await route.fulfill(createJsonResponse(dumpSnapshot));
  });

  await page.route("https://api.themoviedb.org/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/3/search/movie") {
      const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
      await route.fulfill(createJsonResponse({
        results: query === "zootopia"
          ? [{
              id: 269149,
              title: "Zootopia",
              original_title: "Zootopia",
              poster_path: "/zootopia.jpg",
              release_date: "2016-03-04",
              popularity: 88,
              vote_average: 7.7,
              vote_count: 16000,
            }]
          : [],
      }));
      return;
    }

    if (url.pathname === "/3/search/person") {
      const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
      await route.fulfill(createJsonResponse({
        results: query === "fred willard"
          ? [{
              id: 9002,
              name: "Fred Willard",
              popularity: 41,
              profile_path: "/fred-willard.jpg",
              known_for_department: "Acting",
            }]
          : [],
      }));
      return;
    }

    if (url.pathname === "/3/movie/269149/credits") {
      await route.fulfill(createJsonResponse({
        cast: [{
          id: 9001,
          name: "Judy Hopps",
          popularity: 44,
          profile_path: "/judy-hopps.jpg",
          character: "Officer Judy Hopps",
          known_for_department: "Acting",
          order: 0,
        }],
        crew: [],
      }));
      return;
    }

    if (url.pathname === "/3/movie/11011/credits") {
      await route.fulfill(createJsonResponse({
        cast: [
          {
            id: 9001,
            name: "Judy Hopps",
            popularity: 44,
            profile_path: "/judy-hopps.jpg",
            character: "Self",
            known_for_department: "Acting",
            order: 0,
          },
          {
            id: 9002,
            name: "Fred Willard",
            popularity: 41,
            profile_path: "/fred-willard.jpg",
            character: "Buck Laughlin",
            known_for_department: "Acting",
            order: 1,
          },
        ],
        crew: [],
      }));
      return;
    }

    if (url.pathname === "/3/person/9001") {
      await route.fulfill(createJsonResponse({
        id: 9001,
        name: "Judy Hopps",
        popularity: 44,
        profile_path: "/judy-hopps.jpg",
      }));
      return;
    }

    if (url.pathname === "/3/person/9002") {
      await route.fulfill(createJsonResponse({
        id: 9002,
        name: "Fred Willard",
        popularity: 41,
        profile_path: "/fred-willard.jpg",
      }));
      return;
    }

    if (url.pathname === "/3/person/9001/movie_credits") {
      await route.fulfill(createJsonResponse({
        cast: [
          {
            id: 269149,
            title: "Zootopia",
            original_title: "Zootopia",
            poster_path: "/zootopia.jpg",
            release_date: "2016-03-04",
            popularity: 88,
            vote_average: 7.7,
            vote_count: 16000,
            character: "Officer Judy Hopps",
          },
          {
            id: 11011,
            title: "Best in Show",
            original_title: "Best in Show",
            poster_path: "/best-in-show.jpg",
            release_date: "2000-09-29",
            popularity: 54,
            vote_average: 7.1,
            vote_count: 1300,
            character: "Self",
          },
        ],
        crew: [],
      }));
      return;
    }

    if (url.pathname === "/3/person/9002/movie_credits") {
      await route.fulfill(createJsonResponse({
        cast: [
          {
            id: 11011,
            title: "Best in Show",
            original_title: "Best in Show",
            poster_path: "/best-in-show.jpg",
            release_date: "2000-09-29",
            popularity: 54,
            vote_average: 7.1,
            vote_count: 1300,
            character: "Buck Laughlin",
          },
        ],
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

  const connectionInput = page.locator(".bacon-connection-input");
  const zootopiaCard = getGenerationCardByTitle(page, 1, "Zootopia");
  await expect(connectionInput).toBeEnabled();
  await expect(zootopiaCard).toBeVisible();

  await zootopiaCard.click();

  await connectionInput.click();
  await connectionInput.fill("Fred Willard");
  await connectionInput.press("Enter");

  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);

  const fredWillardInConnectionResults = page
    .locator(".bacon-connection-results .cinenerdle-card-title", {
      hasText: "Fred Willard",
    })
    .first();
  await expect(fredWillardInConnectionResults).toBeVisible();
  await fredWillardInConnectionResults.click();

  const gen4FredWillard = getGenerationCardByTitle(page, 4, "Fred Willard");
  await expect(gen4FredWillard).toBeVisible();
  await gen4FredWillard.locator(".cinenerdle-card-title", { hasText: "Fred Willard" }).click();

  await expect.poll(() => page.url()).toContain("#person|Fred+Willard");
  await expect(page.locator(".generator-row")).toHaveCount(2);
  await expect(getGenerationCardByTitle(page, 0, "Fred Willard")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 1, "Best in Show")).toBeVisible();
  await expect(getGenerationRow(page, 0).locator("img[alt='cinenerdle']")).toHaveCount(0);
  await expect(getGenerationRow(page, 2)).toHaveCount(0);

  await page.keyboard.press("b");
  await expect.poll(() => page.url()).toContain("/bookmarks");
  await expect(page.locator(".generator-row")).toHaveCount(0);

  await page.keyboard.press("b");
  await expect.poll(() => page.url()).toContain("#person|Fred+Willard");
  await expect(page.locator(".generator-row")).toHaveCount(2);
  await expect(getGenerationCardByTitle(page, 0, "Fred Willard")).toBeVisible();
  await expect(getGenerationCardByTitle(page, 1, "Best in Show")).toBeVisible();
  await expect(getGenerationRow(page, 0).locator("img[alt='cinenerdle']")).toHaveCount(0);
});
