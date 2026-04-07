import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isBookmarksJsonlDraftChanged,
  resetBookmarksJsonlDraft,
} from "../bookmarks_state";
import { formatClearDbBadgeText } from "../clear_db_badge";
import BaconTitleBar from "../components/bacon_title_bar";
import BookmarksJsonlEditorModal, {
  BookmarksJsonlEditButton,
} from "../components/bookmarks_jsonl_editor";
import BookmarksPage from "../components/bookmarks_page";
import ConnectionBoostPreview from "../components/connection_boost_preview";
import { getFullyVisibleViewportScrollTop } from "../components/abstract_generator_scroll";
import ConnectionEntityCard from "../components/connection_entity_card";
import ConnectionResults from "../components/connection_results";
import ConnectionMatchupPreview from "../components/connection_matchup_preview";
import IndexedDbBootstrapLoadingIndicator from "../components/indexed_db_bootstrap_loading_indicator";
import {
  shouldResolveConnectionMatchupPreview,
  shouldSelectConnectedDropdownSuggestionAsYoungest,
} from "../connection_matchup_helpers";
import { annotateDirectionalConnectionPathRanks } from "../connection_path_ranks";
import {
  makeFilmRecord,
  makeMovieCredit,
  makePersonCredit,
  makePersonRecord,
} from "../generators/cinenerdle2/__tests__/factories";
import type { CinenerdleIndexedDbBootstrapStatus } from "../generators/cinenerdle2/bootstrap";
import { CINENERDLE_ICON_URL } from "../generators/cinenerdle2/constants";
import {
  getConnectionEdgeKey,
  type ConnectionEntity,
} from "../generators/cinenerdle2/connection_graph";
import {
  createIndexedDbBootstrapLoadingShellDelayManager,
  INDEXED_DB_BOOTSTRAP_LOADING_SHELL_DELAY_MS,
  shouldShowIndexedDbBootstrapLoadingShell,
} from "../indexed_db_bootstrap_loading_shell";
import { formatIndexedDbClearConfirmationMessage } from "../indexed_db_clear_confirmation";
import { getWindowKeyDownAction } from "../window_keydown";

function makeKeyboardTarget(tagName: string): EventTarget {
  return { tagName } as unknown as EventTarget;
}

function makeConnectionEntity(
  overrides: Partial<ConnectionEntity> = {},
): ConnectionEntity {
  return {
    key: "movie:heat:1995",
    kind: "movie",
    name: "Heat",
    year: "1995",
    tmdbId: 10,
    label: "Heat (1995)",
    connectionCount: 12,
    hasCachedTmdbSource: true,
    imageUrl: null,
    popularity: 62.46,
    connectionRank: null,
    ...overrides,
  };
}

function renderMatchupPreviewStub() {
  return <div className="matchup-preview-stub">matchup</div>;
}

function renderBoostPreviewStub() {
  return <div className="boost-preview-stub">boost</div>;
}

function makeCinenerdleIndexedDbBootstrapStatus(
  overrides: Partial<CinenerdleIndexedDbBootstrapStatus> = {},
): CinenerdleIndexedDbBootstrapStatus {
  return {
    phase: "idle",
    isCoreReady: false,
    isSearchablePersistencePending: false,
    resetRequiredMessage: null,
    ...overrides,
  };
}

describe("Connection matchup loading state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("suppresses matchup resolution while cinenerdle bootstrap is loading", () => {
    expect(shouldResolveConnectionMatchupPreview({
      isBookmarksView: false,
      isCinenerdleIndexedDbBootstrapLoading: true,
      youngestSelectedCard: {
        key: "movie:heat:1995",
        kind: "movie",
        name: "Heat",
        year: "1995",
        popularity: 0,
        popularitySource: null,
        imageUrl: null,
        subtitle: "1995",
        subtitleDetail: "",
        connectionCount: null,
        sources: [],
        status: null,
        voteAverage: null,
        voteCount: null,
        record: null,
      },
    })).toBe(false);
  });

  it("resumes matchup resolution when bootstrap loading finishes", () => {
    expect(shouldResolveConnectionMatchupPreview({
      isBookmarksView: false,
      isCinenerdleIndexedDbBootstrapLoading: false,
      youngestSelectedCard: {
        key: "movie:heat:1995",
        kind: "movie",
        name: "Heat",
        year: "1995",
        popularity: 0,
        popularitySource: null,
        imageUrl: null,
        subtitle: "1995",
        subtitleDetail: "",
        connectionCount: null,
        sources: [],
        status: null,
        voteAverage: null,
        voteCount: null,
        record: null,
      },
    })).toBe(true);
  });

  it("renders a non-interactive loading shell for the indexeddb bootstrap strip", () => {
    const html = renderToStaticMarkup(<IndexedDbBootstrapLoadingIndicator phase="idle" />);

    expect(html).toContain("Preparing data");
    expect(html).toContain("aria-busy=\"true\"");
    expect(html).toContain("role=\"status\"");
    expect(html).toContain("bacon-connection-matchup-spinner");
    expect(html).toContain("bacon-indexeddb-bootstrap-loading");
  });

  it("renders a processing label while existing indexeddb records are being prepared", () => {
    const html = renderToStaticMarkup(<IndexedDbBootstrapLoadingIndicator phase="processing" />);

    expect(html).toContain("Processing data");
  });

  it("renders a clear-db-and-refresh message for incompatible cached data", () => {
    const html = renderToStaticMarkup(
      <IndexedDbBootstrapLoadingIndicator
        phase="reset-required"
        resetRequiredMessage="Cached Cinenerdle data is outdated or incompatible. Clear DB and refresh."
      />,
    );

    expect(html).toContain("Clear DB and refresh");
    expect(html).toContain("Cached Cinenerdle data is outdated or incompatible. Clear DB and refresh.");
  });

  it("keeps the loading shell hidden when bootstrap finishes before the delay elapses", async () => {
    const delayEvents: string[] = [];
    const delayManager = createIndexedDbBootstrapLoadingShellDelayManager({
      clearTimeout,
      onDelayElapsed: () => {
        delayEvents.push("elapsed");
      },
      onDelayReset: () => {
        delayEvents.push("reset");
      },
      setTimeout,
    });

    delayManager.sync(makeCinenerdleIndexedDbBootstrapStatus());
    await vi.advanceTimersByTimeAsync(INDEXED_DB_BOOTSTRAP_LOADING_SHELL_DELAY_MS - 1);
    delayManager.sync(makeCinenerdleIndexedDbBootstrapStatus({
      isCoreReady: true,
      phase: "idle",
    }));
    await vi.advanceTimersByTimeAsync(INDEXED_DB_BOOTSTRAP_LOADING_SHELL_DELAY_MS);

    expect(delayEvents).toEqual(["reset", "reset"]);
    expect(shouldShowIndexedDbBootstrapLoadingShell({
      hasLoadingShellDelayElapsed: false,
      status: makeCinenerdleIndexedDbBootstrapStatus({
        isCoreReady: true,
        phase: "idle",
      }),
    })).toBe(false);

    delayManager.dispose();
  });

  it("shows the loading shell after bootstrap has been blocking for at least 2 seconds", async () => {
    const delayEvents: string[] = [];
    const delayManager = createIndexedDbBootstrapLoadingShellDelayManager({
      clearTimeout,
      onDelayElapsed: () => {
        delayEvents.push("elapsed");
      },
      onDelayReset: () => {
        delayEvents.push("reset");
      },
      setTimeout,
    });

    delayManager.sync(makeCinenerdleIndexedDbBootstrapStatus({
      phase: "processing",
    }));
    await vi.advanceTimersByTimeAsync(INDEXED_DB_BOOTSTRAP_LOADING_SHELL_DELAY_MS);

    expect(delayEvents).toEqual(["reset", "elapsed"]);
    expect(shouldShowIndexedDbBootstrapLoadingShell({
      hasLoadingShellDelayElapsed: true,
      status: makeCinenerdleIndexedDbBootstrapStatus({
        phase: "processing",
      }),
    })).toBe(true);

    delayManager.dispose();
  });

  it("hides the loading shell again once bootstrap finishes after the delay elapses", async () => {
    const delayEvents: string[] = [];
    const delayManager = createIndexedDbBootstrapLoadingShellDelayManager({
      clearTimeout,
      onDelayElapsed: () => {
        delayEvents.push("elapsed");
      },
      onDelayReset: () => {
        delayEvents.push("reset");
      },
      setTimeout,
    });

    delayManager.sync(makeCinenerdleIndexedDbBootstrapStatus({
      phase: "processing",
    }));
    await vi.advanceTimersByTimeAsync(INDEXED_DB_BOOTSTRAP_LOADING_SHELL_DELAY_MS);
    delayManager.sync(makeCinenerdleIndexedDbBootstrapStatus({
      isCoreReady: true,
      phase: "idle",
    }));

    expect(delayEvents).toEqual(["reset", "elapsed", "reset"]);
    expect(shouldShowIndexedDbBootstrapLoadingShell({
      hasLoadingShellDelayElapsed: false,
      status: makeCinenerdleIndexedDbBootstrapStatus({
        isCoreReady: true,
        phase: "idle",
      }),
    })).toBe(false);

    delayManager.dispose();
  });

  it("shows reset-required immediately without waiting for the loading delay", async () => {
    const delayEvents: string[] = [];
    const delayManager = createIndexedDbBootstrapLoadingShellDelayManager({
      clearTimeout,
      onDelayElapsed: () => {
        delayEvents.push("elapsed");
      },
      onDelayReset: () => {
        delayEvents.push("reset");
      },
      setTimeout,
    });

    delayManager.sync(makeCinenerdleIndexedDbBootstrapStatus());
    await vi.advanceTimersByTimeAsync(1000);
    const resetRequiredStatus = makeCinenerdleIndexedDbBootstrapStatus({
      phase: "reset-required",
      resetRequiredMessage: "Cached Cinenerdle data is outdated or incompatible. Clear DB and refresh.",
    });
    delayManager.sync(resetRequiredStatus);
    await vi.advanceTimersByTimeAsync(INDEXED_DB_BOOTSTRAP_LOADING_SHELL_DELAY_MS);

    expect(delayEvents).toEqual(["reset", "reset"]);
    expect(shouldShowIndexedDbBootstrapLoadingShell({
      hasLoadingShellDelayElapsed: false,
      status: resetRequiredStatus,
    })).toBe(true);

    delayManager.dispose();
  });

  it("describes clear-db size as a browser estimate instead of exact reclaimed space", () => {
    expect(formatIndexedDbClearConfirmationMessage(40.46 * 1024 * 1024)).toBe(
      "Clear the TMDB cache?\n\nThe browser estimates IndexedDB usage at about 40.46 MB for this site.",
    );
  });

  it("formats the clear-db badge as current-over-total fetches", () => {
    expect(formatClearDbBadgeText(12, 45)).toBe("12 / 45");
    expect(formatClearDbBadgeText(12, 0)).toBe("0 / 0");
  });

  it("treats highlighted connected dropdown suggestions as youngest-selection targets", () => {
    expect(shouldSelectConnectedDropdownSuggestionAsYoungest({
      isConnectedToYoungestSelection: true,
    })).toBe(true);
    expect(shouldSelectConnectedDropdownSuggestionAsYoungest({
      isConnectedToYoungestSelection: false,
    })).toBe(false);
    expect(shouldSelectConnectedDropdownSuggestionAsYoungest(null)).toBe(false);
  });
});

describe("Generator vertical visibility scrolling", () => {
  it("keeps the viewport still when the generation is already fully visible", () => {
    expect(getFullyVisibleViewportScrollTop({
      top: 40,
      bottom: 140,
      height: 100,
    }, 320, 500)).toBeNull();
  });

  it("scrolls down enough to reveal the clipped bottom edge", () => {
    expect(getFullyVisibleViewportScrollTop({
      top: 180,
      bottom: 320,
      height: 140,
    }, 260, 1000)).toBe(1072);
  });

  it("aligns the top edge when the generation is taller than the available viewport", () => {
    expect(getFullyVisibleViewportScrollTop({
      top: 24,
      bottom: 304,
      height: 280,
    }, 240, 1000)).toBe(1012);
  });
});

describe("window keydown behavior", () => {
  it("closes the bookmarks jsonl modal on escape before bookmark toggles", () => {
    expect(getWindowKeyDownAction({
      event: {
        altKey: false,
        ctrlKey: false,
        defaultPrevented: false,
        key: "Escape",
        metaKey: false,
        target: makeKeyboardTarget("TEXTAREA"),
      },
      isBookmarksJsonlEditorOpen: true,
    })).toBe("close-bookmarks-jsonl-editor");
  });

  it("does not toggle bookmarks from editable fields when the modal is closed", () => {
    expect(getWindowKeyDownAction({
      event: {
        altKey: false,
        ctrlKey: false,
        defaultPrevented: false,
        key: "Escape",
        metaKey: false,
        target: makeKeyboardTarget("TEXTAREA"),
      },
      isBookmarksJsonlEditorOpen: false,
    })).toBeNull();
  });

  it("toggles bookmarks from the global shortcut when the modal is closed", () => {
    expect(getWindowKeyDownAction({
      event: {
        altKey: false,
        ctrlKey: false,
        defaultPrevented: false,
        key: "b",
        metaKey: false,
        target: makeKeyboardTarget("DIV"),
      },
      isBookmarksJsonlEditorOpen: false,
    })).toBe("toggle-bookmarks");
  });
});

describe("Bookmarks JSONL editor", () => {
  it("renders the bookmarks editor trigger as edit as text without an edited badge", () => {
    const html = renderToStaticMarkup(
      <BookmarksJsonlEditButton onClick={() => { }} />,
    );

    expect(html).toContain("Edit as text");
    expect(html).toContain("aria-label=\"Edit as text\"");
    expect(html).not.toContain("Edit JSONL");
    expect(html).not.toContain("Edited");
  });

  it("renders the modal with an aria-label and no visible title or helper copy", () => {
    const html = renderToStaticMarkup(
      <BookmarksJsonlEditorModal
        bookmarksJsonlDraft="movie|Heat (1995)"
        isBookmarksJsonlDraftDirty={false}
        onApply={() => { }}
        onChange={() => { }}
        onClose={() => { }}
        onReset={() => { }}
      />,
    );

    expect(html).toContain("aria-label=\"Edit as text\"");
    expect(html).not.toContain("Edit bookmarks as JSONL");
    expect(html).not.toContain("One normalized hash per line.");
    expect(html).not.toContain("Bookmark JSONL");
  });

  it("starts with reset and apply disabled when the draft is unchanged", () => {
    const serializedBookmarksJsonl = "movie|Heat (1995)";
    const html = renderToStaticMarkup(
      <BookmarksJsonlEditorModal
        bookmarksJsonlDraft={serializedBookmarksJsonl}
        isBookmarksJsonlDraftDirty={isBookmarksJsonlDraftChanged(
          serializedBookmarksJsonl,
          serializedBookmarksJsonl,
        )}
        onApply={() => { }}
        onChange={() => { }}
        onClose={() => { }}
        onReset={() => { }}
      />,
    );

    expect(isBookmarksJsonlDraftChanged(
      serializedBookmarksJsonl,
      serializedBookmarksJsonl,
    )).toBe(false);
    expect((html.match(/disabled=""/g) ?? [])).toHaveLength(2);
  });

  it("enables reset and apply after the textarea changes", () => {
    const serializedBookmarksJsonl = "movie|Heat (1995)";
    const updatedDraft = "movie|Heat (1995)\nperson|Al Pacino";
    const html = renderToStaticMarkup(
      <BookmarksJsonlEditorModal
        bookmarksJsonlDraft={updatedDraft}
        isBookmarksJsonlDraftDirty={isBookmarksJsonlDraftChanged(
          serializedBookmarksJsonl,
          updatedDraft,
        )}
        onApply={() => { }}
        onChange={() => { }}
        onClose={() => { }}
        onReset={() => { }}
      />,
    );

    expect(isBookmarksJsonlDraftChanged(serializedBookmarksJsonl, updatedDraft)).toBe(true);
    expect(html).not.toContain("disabled");
  });

  it("restores the serialized text on reset and disables the actions again", () => {
    const serializedBookmarksJsonl = "movie|Heat (1995)";
    const resetDraft = resetBookmarksJsonlDraft(serializedBookmarksJsonl);
    const html = renderToStaticMarkup(
      <BookmarksJsonlEditorModal
        bookmarksJsonlDraft={resetDraft}
        isBookmarksJsonlDraftDirty={isBookmarksJsonlDraftChanged(
          serializedBookmarksJsonl,
          resetDraft,
        )}
        onApply={() => { }}
        onChange={() => { }}
        onClose={() => { }}
        onReset={() => { }}
      />,
    );

    expect(resetDraft).toBe(serializedBookmarksJsonl);
    expect(isBookmarksJsonlDraftChanged(serializedBookmarksJsonl, resetDraft)).toBe(false);
    expect((html.match(/disabled=""/g) ?? [])).toHaveLength(2);
  });
});

describe("BaconTitleBar", () => {
  it("renders a left brand cluster and right action row in generator view", () => {
    const html = renderToStaticMarkup(
      <BaconTitleBar
        boostPreview={renderBoostPreviewStub()}
        clearDbBadgeText="12 / 34"
        copyStatus=""
        copyStatusPlacement="toast"
        isBookmarksView={false}
        isSavingBookmark={false}
        onClearDatabase={() => { }}
        onOpenBookmarksJsonlEditor={() => { }}
        onReset={() => { }}
        onSaveBookmark={() => { }}
        onToggleBookmarks={() => { }}
        matchupPreview={renderMatchupPreviewStub()}
      />,
    );

    expect(html).toContain("bacon-title-brand");
    expect(html).toContain("aria-label=\"Reset generator\"");
    expect(html).toContain("BaconDegrees420");
    expect(html).toContain("bacon-title-actions");
    expect(html).toContain("boost-preview-stub");
    expect(html).toContain("matchup-preview-stub");
    expect(html).toContain("aria-label=\"Save bookmark\"");
    expect(html).toContain("aria-label=\"Open bookmarks\"");
    expect(html).toContain("Clear DB (12 / 34)");
    expect(html.indexOf("boost-preview-stub")).toBeLessThan(html.indexOf("matchup-preview-stub"));
    expect(html.indexOf("matchup-preview-stub")).toBeLessThan(html.indexOf("aria-label=\"Save bookmark\""));
    expect(html.indexOf("aria-label=\"Save bookmark\"")).toBeLessThan(html.indexOf("aria-label=\"Open bookmarks\""));
    expect(html.indexOf("aria-label=\"Open bookmarks\"")).toBeLessThan(html.indexOf("Clear DB (12 / 34)"));
  });

  it("skips the boost slot when no boost preview is provided", () => {
    const html = renderToStaticMarkup(
      <BaconTitleBar
        clearDbBadgeText="12 / 34"
        copyStatus=""
        copyStatusPlacement="toast"
        isBookmarksView={false}
        isSavingBookmark={false}
        onClearDatabase={() => { }}
        onOpenBookmarksJsonlEditor={() => { }}
        onReset={() => { }}
        onSaveBookmark={() => { }}
        onToggleBookmarks={() => { }}
        matchupPreview={renderMatchupPreviewStub()}
      />,
    );

    expect(html).not.toContain("boost-preview-stub");
    expect(html).toContain("matchup-preview-stub");
  });

  it("renders boost tooltip copy as x plus y", () => {
    const html = renderToStaticMarkup(
      <ConnectionBoostPreview
        preview={{
          distanceTwo: {
            key: "movie:heat:1995",
            kind: "movie",
            name: "Heat (1995)",
            imageUrl: null,
            popularity: 60,
            tooltipText: "Heat (1995)\nPopularity: 60",
          },
          sharedConnection: {
            key: "person:1",
            kind: "person",
            name: "Al Pacino",
            imageUrl: null,
            popularity: 90,
            tooltipText: "Al Pacino\nPopularity: 90",
          },
        }}
      />,
    );

    expect(html).toContain("bacon-connection-matchup");
    expect(html).toContain("bacon-connection-matchup-content");
    expect(html).toContain("Suggested boost: Heat (1995) + Al Pacino");
    expect(html).toContain(">Al Pacino<");
    expect(html).toContain(">--&gt; connects to<");
    expect(html).toContain(">Heat (1995)<");
    expect(html).toContain("Popularity 90");
    expect(html).toContain("Popularity 60");
  });

  it("renders a popularity badge for matchup y", () => {
    const html = renderToStaticMarkup(
      <ConnectionMatchupPreview
        preview={{
          kind: "versus",
          counterpart: {
            key: "movie:heat:1995",
            kind: "movie",
            name: "Heat (1995)",
            imageUrl: null,
            popularity: 60,
            tooltipText: "Heat (1995)\nPopularity: 60",
          },
          spoiler: {
            key: "person:1",
            kind: "person",
            name: "Al Pacino",
            imageUrl: null,
            popularity: 90,
            tooltipText: "Al Pacino\nPopularity: 90",
          },
        }}
      />,
    );

    expect(html).toContain(">Al Pacino<");
    expect(html).toContain("Popularity 90");
    expect(html).toContain(">-/-&gt; oft-connected<");
  });

  it("renders bookmark tooltip copy inside the clear-db overlay anchor", () => {
    const html = renderToStaticMarkup(
      <BaconTitleBar
        clearDbBadgeText="1 / 2"
        copyStatus=""
        copyStatusPlacement="toast"
        isBookmarksView={false}
        isSavingBookmark={false}
        onClearDatabase={() => { }}
        onOpenBookmarksJsonlEditor={() => { }}
        onReset={() => { }}
        onSaveBookmark={() => { }}
        onToggleBookmarks={() => { }}
      />,
    );

    expect(html).toContain("bacon-title-overlay-anchor");
    expect(html).toContain("bacon-fancy-tooltip-anchor");
    expect(html).toContain("role=\"tooltip\"");
    expect(html).toContain(">Save bookmark<");
  });

  it("renders the bookmarks view controls with edit as text and a clear-db anchored toast", () => {
    const html = renderToStaticMarkup(
      <BaconTitleBar
        clearDbBadgeText="8 / 8"
        copyStatus="Bookmarks updated"
        copyStatusPlacement="toast"
        isBookmarksView={true}
        isSavingBookmark={false}
        onClearDatabase={() => { }}
        onOpenBookmarksJsonlEditor={() => { }}
        onReset={() => { }}
        onSaveBookmark={() => { }}
        onToggleBookmarks={() => { }}
      />,
    );

    expect(html).toContain("Edit as text");
    expect(html).toContain("aria-label=\"Edit as text\"");
    expect(html).not.toContain("aria-label=\"Save bookmark\"");
    expect(html).toContain("aria-label=\"Close bookmarks\"");
    expect(html).toContain("bacon-copy-status-overlay-toast");
    expect(html).toContain(">Bookmarks updated<");
  });

  it("renders bookmark row tooltips only for the index, load, and remove controls", () => {
    const html = renderToStaticMarkup(
      <BookmarksPage
        bookmarkRows={[{
          cards: [{ key: "break:0", kind: "break", label: "Start" }],
          hash: "movie|Heat (1995)",
        }]}
        bookmarks={[{ hash: "movie|Heat (1995)" }]}
        onLoadBookmark={() => { }}
        onLoadBookmarkCard={() => { }}
        onMoveBookmark={() => { }}
        onOpenBookmarkCardAsRootInNewTab={() => { }}
        onRemoveBookmark={() => { }}
      />,
    );

    expect(html).toContain("bacon-bookmark-index-tooltip-anchor");
    expect(html).toContain("bacon-bookmark-row-action-tooltip-anchor");
    expect(html.match(/role="tooltip"/g)).toHaveLength(3);
    expect(html).toContain(">Load bookmark<");
    expect(html).toContain(">Remove bookmark<");
  });
});

describe("ConnectionEntityCard", () => {
  it("renders rank/count meta text when rank is available", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard
        entity={makeConnectionEntity({
          connectionRank: 3,
        })}
      />,
    );

    expect(html).toContain("#3 / 12");
    expect(html).toContain("cinenerdle-card-footer-left");
    expect(html).toContain("cinenerdle-card");
  });

  it("renders a separate popularity badge row when popularity is available", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard entity={makeConnectionEntity()} />,
    );

    expect(html).toContain("cinenerdle-card-footer-top");
    expect(html).toContain("cinenerdle-card-chip-heat");
    expect(html).toContain("Popularity 62.46");
  });

  it("falls back to count-only meta text when rank is unavailable", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard entity={makeConnectionEntity()} />,
    );

    expect(html).toContain("12");
    expect(html).not.toContain(" / 12");
  });

  it("renders shared footer tooltips with connection copy for movie cards", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard
        entity={makeConnectionEntity({
          connectionParentLabel: "Freddie Highmore",
          connectionRank: 3,
        })}
      />,
    );

    expect(html).toContain("alt=\"TMDb\"");
    expect(html).toContain("cinenerdle-card-chip-tooltip-anchor");
    expect(html).toContain("cinenerdle-card-inline-tooltip-left");
    expect(html).toContain("Heat has 12 connections");
    expect(html).toContain("Freddie Highmore is the #3 connection");
  });

  it("renders the shared cinenerdle root card presentation for cinenerdle entities", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard
        entity={makeConnectionEntity({
          key: "cinenerdle",
          kind: "cinenerdle",
          name: "cinenerdle",
          year: "",
          tmdbId: null,
          label: "cinenerdle",
        })}
      />,
    );

    expect(html).toContain("cinenerdle-card-root");
    expect(html).toContain(`src="${CINENERDLE_ICON_URL}"`);
    expect(html).not.toContain("cinenerdle-card-copy");
  });

  it("renders the shared image slot when imageUrl is present", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard
        entity={makeConnectionEntity({
          imageUrl: "https://img.test/heat.jpg",
        })}
      />,
    );

    expect(html).toContain("cinenerdle-card-image");
    expect(html).toContain("src=\"https://img.test/heat.jpg\"");
  });

  it("renders the shared fallback image shell when imageUrl is missing", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard entity={makeConnectionEntity()} />,
    );

    expect(html).toContain("cinenerdle-card-image-fallback");
    expect(html).toContain(">Heat<");
  });

  it("prefers bookmark-style association subtitles and details when present", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard
        entity={makeConnectionEntity({
          associationSubtitle: "1995 • Cast as",
          associationSubtitleDetail: "Neil McCauley",
        })}
      />,
    );

    expect(html).toContain("1995 • Cast as");
    expect(html).toContain("Neil McCauley");
    expect(html).not.toContain("<p class=\"cinenerdle-card-subtitle\">1995</p>");
  });

  it("passes title clicks through the shared card title action without invoking the card action", () => {
    const onCardClick = vi.fn();
    const onNameClick = vi.fn();
    const tree = ConnectionEntityCard({
      entity: makeConnectionEntity(),
      onCardClick,
      onNameClick,
    }) as ReactElement<{
      className?: string;
      onTitleClick?: (event: {
        ctrlKey: boolean;
        metaKey: boolean;
        preventDefault: () => void;
        stopPropagation: () => void;
      }) => void;
      titleElement?: string;
    }>;

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const clickEvent = {
      ctrlKey: false,
      metaKey: true,
      preventDefault,
      stopPropagation,
    };
    expect(tree.props.titleElement).toBe("button");
    tree.props.onTitleClick?.(clickEvent);

    expect(onNameClick).toHaveBeenCalledOnce();
    expect(onNameClick).toHaveBeenCalledWith(clickEvent);
    expect(onCardClick).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
  });

  it("adds the dimmed class to shared cards for excluded nodes", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard
        dimmed
        entity={makeConnectionEntity()}
      />,
    );

    expect(html).toContain("bacon-connection-node-dimmed");
  });
});

describe("ConnectionResults", () => {
  it("uses bookmark-row track styling for the initial comparison row", () => {
    const html = renderToStaticMarkup(
      <ConnectionResults
        appendConnectionPathToTree={vi.fn()}
        connectionSession={{
          id: "session:initial",
          left: makeConnectionEntity(),
          right: makeConnectionEntity({
            key: "person:287",
            kind: "person",
            name: "Brad Pitt",
            year: "",
            tmdbId: 287,
            label: "Brad Pitt",
          }),
          rows: [{
            id: "row:searching",
            excludedNodeKeys: [],
            excludedEdgeKeys: [],
            childDisallowedNodeKeys: [],
            childDisallowedEdgeKeys: [],
            parentRowId: null,
            sourceExclusion: null,
            status: "searching",
            path: [],
          }],
        }}
        navigateToConnectionEntity={vi.fn()}
        openConnectionEntityInNewTab={vi.fn()}
        spawnAlternativeConnectionRow={vi.fn()}
      />,
    );

    expect(html).toContain("bacon-connection-row bacon-bookmark-card-row");
    expect(html).toContain("bacon-connection-arrow bacon-connection-arrow-static");
  });

  it("keeps connection arrow button state classes on found rows that reuse bookmark-row styling", () => {
    const left = makeConnectionEntity();
    const right = makeConnectionEntity({
      key: "person:287",
      kind: "person",
      name: "Brad Pitt",
      year: "",
      tmdbId: 287,
      label: "Brad Pitt",
    });
    const edgeKey = getConnectionEdgeKey(left.key, right.key);
    const html = renderToStaticMarkup(
      <ConnectionResults
        appendConnectionPathToTree={vi.fn()}
        connectionSession={{
          id: "session:found",
          left,
          right,
          rows: [{
            id: "row:found",
            excludedNodeKeys: [],
            excludedEdgeKeys: [],
            childDisallowedNodeKeys: [right.key],
            childDisallowedEdgeKeys: [edgeKey],
            parentRowId: null,
            sourceExclusion: null,
            status: "found",
            path: [left, right],
          }],
        }}
        navigateToConnectionEntity={vi.fn()}
        openConnectionEntityInNewTab={vi.fn()}
        spawnAlternativeConnectionRow={vi.fn()}
      />,
    );

    expect(html).toContain("bacon-connection-row bacon-bookmark-card-row");
    expect(html).toContain("bacon-connection-node-dimmed");
    expect(html).toContain("bacon-connection-arrow-button bacon-connection-arrow-disconnected");
  });
});

describe("annotateDirectionalConnectionPathRanks", () => {
  it("assigns directional ranks from left to right and leaves the terminal endpoint count-only", async () => {
    const adAstra = makeConnectionEntity({
      key: "movie:ad astra:2019",
      name: "Ad Astra",
      year: "2019",
      label: "Ad Astra (2019)",
      connectionCount: 36,
      popularity: null,
    });
    const bradPitt = makeConnectionEntity({
      key: "person:287",
      kind: "person",
      name: "Brad Pitt",
      year: "",
      tmdbId: 287,
      label: "Brad Pitt",
      connectionCount: 104,
      popularity: null,
    });
    const meetJoeBlack = makeConnectionEntity({
      key: "movie:meet joe black:1998",
      name: "Meet Joe Black",
      year: "1998",
      label: "Meet Joe Black (1998)",
      connectionCount: 36,
      popularity: null,
    });
    const jakeWeber = makeConnectionEntity({
      key: "person:7011",
      kind: "person",
      name: "Jake Weber",
      year: "",
      tmdbId: 7011,
      label: "Jake Weber",
      connectionCount: 48,
      popularity: null,
    });
    const shelterMe = makeConnectionEntity({
      key: "movie:shelter me:2007",
      name: "Shelter Me",
      year: "2007",
      label: "Shelter Me (2007)",
      connectionCount: 11,
      popularity: null,
    });

    const movieRecords = new Map([
      [adAstra.key, makeFilmRecord({
        title: "Ad Astra",
        year: "2019",
        popularity: 4.51,
        personConnectionKeys: [
          "Tommy Lee Jones",
          "Liv Tyler",
          "Ruth Negga",
          "Brad Pitt",
        ],
      })],
      [meetJoeBlack.key, makeFilmRecord({
        title: "Meet Joe Black",
        year: "1998",
        popularity: 10.08,
        personConnectionKeys: [
          "Brad Pitt",
          "Anthony Hopkins",
          "Claire Forlani",
          "Jake Weber",
        ],
      })],
      [shelterMe.key, makeFilmRecord({
        title: "Shelter Me",
        year: "2007",
        popularity: 0.63,
        personConnectionKeys: [
          "Amy Smart",
          "Chelsea Hobbs",
          "Marlon Young",
        ],
      })],
    ]);
    const personRecords = new Map([
      [bradPitt.key, makePersonRecord({
        id: 287,
        tmdbId: 287,
        name: "Brad Pitt",
        movieConnectionKeys: [
          "fight club (1999)",
          "se7en (1995)",
          "meet joe black (1998)",
          "ad astra (2019)",
        ],
        rawTmdbPerson: {
          id: 287,
          name: "Brad Pitt",
          profile_path: "/brad-pitt.jpg",
          popularity: 13.31,
        },
      })],
      [jakeWeber.key, makePersonRecord({
        id: 7011,
        tmdbId: 7011,
        name: "Jake Weber",
        movieConnectionKeys: [
          "dawn of the dead (2004)",
          "meet joe black (1998)",
          "shelter me (2007)",
          "medium cool (1969)",
        ],
        rawTmdbPerson: {
          id: 7011,
          name: "Jake Weber",
          profile_path: "/jake-weber.jpg",
          popularity: 3.52,
        },
      })],
    ]);

    const annotatedPath = await annotateDirectionalConnectionPathRanks(
      [adAstra, bradPitt, meetJoeBlack, jakeWeber, shelterMe],
      {
        getMovieRecord: async (entity) => movieRecords.get(entity.key) ?? null,
        getPersonRecord: async (entity) => personRecords.get(entity.key) ?? null,
      },
    );

    expect(annotatedPath.map((entity) => entity.connectionParentLabel)).toEqual([
      "Brad Pitt",
      "Meet Joe Black (1998)",
      "Jake Weber",
      "Shelter Me (2007)",
      null,
    ]);
    expect(annotatedPath.map((entity) => entity.connectionRank)).toEqual([1, 1, 2, 2, null]);
    expect(annotatedPath.map((entity) => entity.popularity)).toEqual([4.51, 13.31, 10.08, 3.52, 0.63]);

    expect(annotatedPath[0]?.connectionRank).not.toBeNull();
    expect(annotatedPath[1]?.connectionRank).not.toBeNull();
    expect(annotatedPath[2]?.connectionRank).toBe(2);
    expect(annotatedPath[3]?.connectionRank).not.toBeNull();
    expect(annotatedPath[4]?.connectionRank).toBeNull();

    const terminalHtml = renderToStaticMarkup(
      <ConnectionEntityCard entity={annotatedPath[4]!} />,
    );
    expect(terminalHtml).toContain("11");
    expect(terminalHtml).toContain("Shelter Me has 11 connections");
    expect(terminalHtml).not.toContain("is the #");
  });

  it("uses the full cached person filmography popularity map so Babylon is Brad Pitt's #12 connection", async () => {
    const bradPitt = makeConnectionEntity({
      key: "person:287",
      kind: "person",
      name: "Brad Pitt",
      year: "",
      tmdbId: 287,
      label: "Brad Pitt",
      connectionCount: 104,
      popularity: null,
    });
    const babylon = makeConnectionEntity({
      key: "movie:babylon:2022",
      name: "Babylon",
      year: "2022",
      label: "Babylon (2022)",
      connectionCount: 232,
      popularity: null,
    });

    const connectedMovieRecords = [
      makeFilmRecord({ title: "F1", year: "2025", popularity: 33.7091 }),
      makeFilmRecord({ title: "Fight Club", year: "1999", popularity: 28.7569 }),
      makeFilmRecord({ title: "Se7en", year: "1995", popularity: 23.5364 }),
      makeFilmRecord({ title: "Inglourious Basterds", year: "2009", popularity: 19.8161 }),
      makeFilmRecord({ title: "Fury", year: "2014", popularity: 17.4349 }),
      makeFilmRecord({ title: "Once Upon a Time... in Hollywood", year: "2019", popularity: 16.2024 }),
      makeFilmRecord({ title: "World War Z", year: "2013", popularity: 14.9884 }),
      makeFilmRecord({ title: "Deadpool 2", year: "2018", popularity: 14.9561 }),
      makeFilmRecord({ title: "Bullet Train", year: "2022", popularity: 14.2804 }),
      makeFilmRecord({ title: "Troy", year: "2004", popularity: 14.0192 }),
      makeFilmRecord({ title: "Snatch", year: "2000", popularity: 12.798 }),
      makeFilmRecord({ title: "Babylon", year: "2022", popularity: 11.9869 }),
      makeFilmRecord({ title: "Ocean's Eleven", year: "2001", popularity: 10.7526 }),
    ];
    const bradPittRecord = makePersonRecord({
      id: 287,
      tmdbId: 287,
      name: "Brad Pitt",
      movieConnectionKeys: connectedMovieRecords.map((record) => record.titleYear),
      rawTmdbPerson: {
        id: 287,
        name: "Brad Pitt",
        profile_path: "/brad-pitt.jpg",
        popularity: 13.31,
      },
    });

    const annotatedPath = await annotateDirectionalConnectionPathRanks(
      [bradPitt, babylon],
      {
        getMovieRecord: async (entity) =>
          connectedMovieRecords.find(
            (record) => record.title === entity.name && record.year === entity.year,
          ) ?? null,
        getPersonRecord: async (entity) => (entity.key === bradPitt.key ? bradPittRecord : null),
        getConnectedMovieRecordsForPerson: async () => connectedMovieRecords,
      },
    );

    expect(annotatedPath[0]?.connectionParentLabel).toBe("Babylon (2022)");
    expect(annotatedPath[0]?.connectionRank).toBe(12);
    expect(annotatedPath[0]?.popularity).toBe(13.31);
    expect(annotatedPath[1]?.connectionRank).toBeNull();
  });

  it("adds bookmark-style role text to connection items after the first without changing the first card fallback", async () => {
    const heatRecord = makeFilmRecord({
      id: 321,
      tmdbId: 321,
      title: "Heat",
      year: "1995",
      popularity: 66,
      personConnectionKeys: ["al pacino"],
      rawTmdbMovieCreditsResponse: {
        cast: [
          makePersonCredit({
            id: 60,
            name: "Al Pacino",
            popularity: 88,
            character: "Lt. Vincent Hanna",
          }),
        ],
        crew: [
          makePersonCredit({
            id: 60,
            name: "Al Pacino",
            popularity: 88,
            creditType: "crew",
            character: undefined,
            job: "Producer",
          }),
        ],
      },
    });
    const pacinoRecord = makePersonRecord({
      id: 60,
      tmdbId: 60,
      name: "Al Pacino",
      movieConnectionKeys: ["heat (1995)"],
      rawTmdbPerson: {
        id: 60,
        name: "Al Pacino",
        profile_path: "/al-pacino.jpg",
        popularity: 88,
      },
      rawTmdbMovieCreditsResponse: {
        cast: [
          makeMovieCredit({
            id: 321,
            title: "Heat",
            release_date: "1995-12-15",
            popularity: 66,
            character: "Lt. Vincent Hanna",
          }),
        ],
        crew: [
          makeMovieCredit({
            id: 321,
            title: "Heat",
            release_date: "1995-12-15",
            popularity: 66,
            creditType: "crew",
            character: undefined,
            job: "Producer",
          }),
        ],
      },
    });
    const annotatedPath = await annotateDirectionalConnectionPathRanks(
      [
        makeConnectionEntity({
          key: "movie:heat:1995",
          kind: "movie",
          name: "Heat",
          year: "1995",
          tmdbId: 321,
          label: "Heat (1995)",
          connectionCount: 1,
          popularity: 66,
        }),
        makeConnectionEntity({
          key: "person:60",
          kind: "person",
          name: "Al Pacino",
          year: "",
          tmdbId: 60,
          label: "Al Pacino",
          connectionCount: 1,
          popularity: 88,
        }),
      ],
      {
        getMovieRecord: async (entity) => (entity.name === "Heat" ? heatRecord : null),
        getPersonRecord: async (entity) => (entity.name === "Al Pacino" ? pacinoRecord : null),
        getConnectedPersonRecordsForMovie: async () => [pacinoRecord],
      },
    );

    expect(annotatedPath[0]?.associationSubtitle).toBeUndefined();
    expect(annotatedPath[1]?.associationSubtitle).toBe("Cast as");
    expect(annotatedPath[1]?.associationSubtitleDetail).toBe("Lt. Vincent Hanna");
    expect(annotatedPath[1]?.associationCreditLines).toEqual([
      {
        subtitle: "Cast as",
        subtitleDetail: "Lt. Vincent Hanna",
      },
      {
        subtitle: "Producer",
        subtitleDetail: "",
      },
    ]);

    const firstCardHtml = renderToStaticMarkup(
      <ConnectionEntityCard entity={annotatedPath[0]!} />,
    );
    const secondCardHtml = renderToStaticMarkup(
      <ConnectionEntityCard entity={annotatedPath[1]!} />,
    );

    expect(firstCardHtml).toContain("<p class=\"cinenerdle-card-subtitle\">1995</p>");
    expect(firstCardHtml).not.toContain("Lt. Vincent Hanna");
    expect(secondCardHtml).toContain("Cast as");
    expect(secondCardHtml).toContain("Lt. Vincent Hanna");
    expect(secondCardHtml).toContain("Producer");
  });
});
