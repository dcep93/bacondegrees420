import { expect, test } from "@playwright/test";

test("person refresh and an IndexedDB reload preserve the parent's alternating credit order", async ({ page }) => {
  // A blank same-origin page isolates persistence from startup fetching and prefetch.
  await page.route("**/ordering-regression", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>Credit order regression</title>",
  }));
  await page.goto("/ordering-regression");

  const beforeReload = await page.evaluate(async () => {
    const base = "/src/app_x/generators/cinenerdle2/";
    const db = await import(`${base}indexed_db.ts`);
    const tmdb = await import(`${base}tmdb.ts`);
    const utils = await import(`${base}utils.ts`);
    const factories = await import(`${base}__tests__/factories.ts`);
    await db.importIndexedDbSnapshot({
      format: "cinenerdle-indexed-db-snapshot", version: 13, people: [], films: [],
    });
    const film = factories.makeFilmRecord({
      id: 9016, tmdbId: 9016, title: "Treasure Planet", year: "2002",
      fetchTimestamp: "2026-10-03T12:00:00Z",
      rawTmdbMovieCreditsResponse: {
        cast: [
          { id: 1, name: "Joseph Gordon-Levitt", order: 0, popularity: 5.78 },
          { id: 2, name: "Brian Murray", order: 1, popularity: 1.19 },
          { id: 3, name: "Emma Thompson", order: 2, popularity: 5.10 },
          { id: 4, name: "David Hyde Pierce", order: 3, popularity: 2.54 },
          { id: 5, name: "Martin Short", order: 4, popularity: 2.94 },
          { id: 6, name: "Laurie Metcalf", order: 5, popularity: 3.53 },
          { id: 7, name: "Dee Bradley Baker", order: 6, popularity: 4.52 },
        ],
        crew: [
          { id: 101, name: "Ron Clements", popularity: 1.94, job: "Director", creditType: "crew" },
          { id: 102, name: "John Musker", popularity: 1.34, job: "Screenplay", creditType: "crew" },
        ],
      },
    });
    await db.saveFilmRecord(film);
    const initialOrder = utils.getAssociatedPeopleFromMovieCredits(film).map((credit: { name: string }) => credit.name);
    const person = factories.makePersonRecord({
      id: 102, tmdbId: 102, name: "John Musker", fetchTimestamp: "2026-10-03T13:00:00Z",
      rawTmdbPerson: factories.makeTmdbPersonSearchResult({ id: 102, name: "John Musker", popularity: 99 }),
      rawTmdbMovieCreditsResponse: {
        crew: [{ id: 9016, title: "Treasure Planet", release_date: "2002-11-26", job: "Screenplay" }],
      },
    });
    await db.savePersonRecord(person);
    await tmdb.saveFilmRecordsFromCredits(person);
    const updated = await db.getFilmRecordById(9016);
    const updatedPerson = await db.getPersonRecordById(102);
    const exported = await db.getIndexedDbSnapshot();
    return {
      initialOrder,
      order: utils.getAssociatedPeopleFromMovieCredits(updated).map((credit: { name: string }) => credit.name),
      filmCredits: JSON.stringify(updated.rawTmdbMovieCreditsResponse),
      personCredits: JSON.stringify(updatedPerson.rawTmdbMovieCreditsResponse),
      compactExport: [...exported.people, ...exported.films].every((record) => !("sourceCredits" in record)),
    };
  });

  expect(beforeReload.order).toEqual(beforeReload.initialOrder);
  expect(beforeReload.order.slice(0, 6)).toEqual([
    "Joseph Gordon-Levitt", "Emma Thompson", "Ron Clements",
    "Dee Bradley Baker", "John Musker", "Laurie Metcalf",
  ]);
  expect(beforeReload.compactExport).toBe(true);

  // Discard all JS module caches; reads must now come from persisted IndexedDB.
  await page.reload();
  const afterReload = await page.evaluate(async () => {
    const base = "/src/app_x/generators/cinenerdle2/";
    const db = await import(`${base}indexed_db.ts`);
    const utils = await import(`${base}utils.ts`);
    const film = await db.getFilmRecordById(9016);
    const person = await db.getPersonRecordById(102);
    return {
      order: utils.getAssociatedPeopleFromMovieCredits(film).map((credit: { name: string }) => credit.name),
      filmCredits: JSON.stringify(film.rawTmdbMovieCreditsResponse),
      personCredits: JSON.stringify(person.rawTmdbMovieCreditsResponse),
    };
  });
  expect(afterReload.order).toEqual(beforeReload.order);
  expect(afterReload.filmCredits).toBe(beforeReload.filmCredits);
  expect(afterReload.personCredits).toBe(beforeReload.personCredits);
});

test("upgrades the old cache and preserves imported seed credits across reload", async ({ page }) => {
  await page.route("**/ordering-regression", (route) => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>Cache upgrade regression</title>",
  }));
  await page.goto("/ordering-regression");
  const beforeReload = await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("cinenerdle2", 17);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("films", { keyPath: "tmdbId" })
          .put({ tmdbId: 1, title: "Old cached record" });
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
    const modulePath = "/src/app_x/generators/cinenerdle2/indexed_db.ts";
    const db = await import(modulePath);
    const hasOldRecords = await db.hasCinenerdleIndexedDbRecords();
    const seed = {
      format: "cinenerdle-indexed-db-snapshot", version: 13,
      people: [{ tmdbId: 102, name: "John Musker", movieConnectionKeys: [9016], popularity: 1.34, fromTmdb: null }],
      films: [{
        tmdbId: 9016, title: "Treasure Planet", year: "2002", posterPath: null,
        popularity: 5, genreIds: [], voteAverage: 7, voteCount: 1000,
        releaseDate: "2002-11-26", fromTmdb: null, personConnectionKeys: [102],
        people: [
          { personTmdbId: 102, roleType: "crew", role: "Director", order: 0, profilePath: null, fetchTimestamp: "2026-10-03T12:00:00Z" },
          { personTmdbId: 102, roleType: "crew", role: "Screenplay", order: 0, profilePath: null, fetchTimestamp: "2026-10-03T12:00:00Z" },
        ],
      }],
    };
    await db.importIndexedDbSnapshot(seed);
    return {
      hasOldRecords,
      filmCredits: JSON.stringify((await db.getFilmRecordById(9016)).rawTmdbMovieCreditsResponse),
      personCredits: JSON.stringify((await db.getPersonRecordById(102)).rawTmdbMovieCreditsResponse),
      exportMatchesSeed: JSON.stringify(await db.getIndexedDbSnapshot()) === JSON.stringify(seed),
    };
  });
  expect(beforeReload.hasOldRecords).toBe(false);
  expect(beforeReload.exportMatchesSeed).toBe(true);
  await page.reload();
  const afterReload = await page.evaluate(async () => {
    const modulePath = "/src/app_x/generators/cinenerdle2/indexed_db.ts";
    const db = await import(modulePath);
    return {
      filmCredits: JSON.stringify((await db.getFilmRecordById(9016)).rawTmdbMovieCreditsResponse),
      personCredits: JSON.stringify((await db.getPersonRecordById(102)).rawTmdbMovieCreditsResponse),
    };
  });
  expect(afterReload.filmCredits).toBe(beforeReload.filmCredits);
  expect(afterReload.personCredits).toBe(beforeReload.personCredits);
});
