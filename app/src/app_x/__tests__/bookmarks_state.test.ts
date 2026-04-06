import { describe, expect, it, vi } from "vitest";
import { hydrateBookmarksSequentially } from "../bookmarks_state";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("hydrateBookmarksSequentially", () => {
  const firstHash = "movie:first:1991";
  const secondHash = "movie:second:1992";

  it("starts hydrating in bookmark order", async () => {
    const firstHydration = createDeferred<void>();
    const secondHydration = createDeferred<void>();
    let activeHydration: Promise<void> | null = null;
    const hydrateBookmarkHash = vi.fn((bookmarkHash: string) =>
      bookmarkHash === firstHash ? firstHydration.promise : secondHydration.promise,
    );

    const runPromise = hydrateBookmarksSequentially({
      bookmarkHashes: [firstHash, secondHash],
      getActiveHydration: () => activeHydration,
      hydrateBookmarkHash,
      isCurrentRun: () => true,
      setActiveHydration: (promise) => {
        activeHydration = promise;
      },
    });

    await flushPromises();

    expect(hydrateBookmarkHash).toHaveBeenCalledTimes(1);
    expect(hydrateBookmarkHash).toHaveBeenNthCalledWith(1, firstHash);

    firstHydration.resolve();
    await flushPromises();

    expect(hydrateBookmarkHash).toHaveBeenCalledTimes(2);
    expect(hydrateBookmarkHash).toHaveBeenNthCalledWith(2, secondHash);

    secondHydration.resolve();
    await runPromise;
  });

  it("does not start the next bookmark after the run is cancelled", async () => {
    const firstHydration = createDeferred<void>();
    let activeHydration: Promise<void> | null = null;
    let isCurrentRun = true;
    const hydrateBookmarkHash = vi.fn((bookmarkHash: string) =>
      bookmarkHash === firstHash ? firstHydration.promise : Promise.resolve(),
    );

    const runPromise = hydrateBookmarksSequentially({
      bookmarkHashes: [firstHash, secondHash],
      getActiveHydration: () => activeHydration,
      hydrateBookmarkHash,
      isCurrentRun: () => isCurrentRun,
      setActiveHydration: (promise) => {
        activeHydration = promise;
      },
    });

    await flushPromises();
    expect(hydrateBookmarkHash).toHaveBeenCalledTimes(1);

    isCurrentRun = false;
    firstHydration.resolve();
    await runPromise;

    expect(hydrateBookmarkHash).toHaveBeenCalledTimes(1);
  });

  it("waits for the current bookmark before starting a replacement run", async () => {
    const firstHydration = createDeferred<void>();
    const secondHydration = createDeferred<void>();
    let activeHydration: Promise<void> | null = null;
    let isFirstRunCurrent = true;
    const hydrateBookmarkHash = vi.fn((bookmarkHash: string) =>
      bookmarkHash === firstHash ? firstHydration.promise : secondHydration.promise,
    );

    const firstRunPromise = hydrateBookmarksSequentially({
      bookmarkHashes: [firstHash, secondHash],
      getActiveHydration: () => activeHydration,
      hydrateBookmarkHash,
      isCurrentRun: () => isFirstRunCurrent,
      setActiveHydration: (promise) => {
        activeHydration = promise;
      },
    });

    await flushPromises();
    expect(hydrateBookmarkHash).toHaveBeenCalledTimes(1);
    isFirstRunCurrent = false;

    const replacementRunPromise = hydrateBookmarksSequentially({
      bookmarkHashes: [secondHash],
      getActiveHydration: () => activeHydration,
      hydrateBookmarkHash,
      isCurrentRun: () => true,
      setActiveHydration: (promise) => {
        activeHydration = promise;
      },
    });

    await flushPromises();
    expect(hydrateBookmarkHash).toHaveBeenCalledTimes(1);

    firstHydration.resolve();
    await flushPromises();

    expect(hydrateBookmarkHash).toHaveBeenCalledTimes(2);
    expect(hydrateBookmarkHash).toHaveBeenNthCalledWith(2, secondHash);

    secondHydration.resolve();
    await Promise.all([firstRunPromise, replacementRunPromise]);
  });
});
