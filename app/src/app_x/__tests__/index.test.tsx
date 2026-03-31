import {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ConnectionEntityCard from "../components/connection_entity_card";
import type { ConnectionEntity } from "../generators/cinenerdle2/connection_graph";
import type { CinenerdleIndexedDbBootstrapStatus } from "../generators/cinenerdle2/bootstrap";
import {
  makeFilmRecord,
  makePersonRecord,
} from "../generators/cinenerdle2/__tests__/factories";
import {
  shouldActivateConnectedDropdownSuggestion,
  shouldResolveConnectionMatchupPreview,
} from "../connection_matchup_helpers";
import { annotateDirectionalConnectionPathRanks } from "../connection_path_ranks";
import { formatClearDbBadgeText } from "../clear_db_badge";
import { formatIndexedDbClearConfirmationMessage } from "../indexed_db_clear_confirmation";
import {
  createIndexedDbBootstrapLoadingShellDelayManager,
  INDEXED_DB_BOOTSTRAP_LOADING_SHELL_DELAY_MS,
  shouldShowIndexedDbBootstrapLoadingShell,
} from "../indexed_db_bootstrap_loading_shell";
import BaconTitleBar from "../components/bacon_title_bar";
import BookmarksJsonlEditorModal, {
  BookmarksJsonlEditButton,
} from "../components/bookmarks_jsonl_editor";
import IndexedDbBootstrapLoadingIndicator from "../components/indexed_db_bootstrap_loading_indicator";
import {
  isBookmarksJsonlDraftChanged,
  resetBookmarksJsonlDraft,
} from "../bookmarks_state";
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

function findElementByClassName(
  node: ReactNode,
  className: string,
): ReactElement<Record<string, unknown>> | null {
  if (!isValidElement(node)) {
    return null;
  }

  const element = node as ReactElement<{
    children?: ReactNode;
    className?: string;
  }>;

  const nodeClassName = typeof element.props.className === "string"
    ? element.props.className.split(/\s+/)
    : [];
  if (nodeClassName.includes(className)) {
    return element as ReactElement<Record<string, unknown>>;
  }

  const children = Array.isArray(element.props.children)
    ? element.props.children
    : [element.props.children];
  for (const child of children) {
    const match = findElementByClassName(child, className);
    if (match) {
      return match;
    }
  }

  return null;
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

  it("activates highlighted connected dropdown suggestions instead of opening connection search", () => {
    expect(shouldActivateConnectedDropdownSuggestion({
      isConnectedToYoungestSelection: true,
    })).toBe(true);
    expect(shouldActivateConnectedDropdownSuggestion({
      isConnectedToYoungestSelection: false,
    })).toBe(false);
    expect(shouldActivateConnectedDropdownSuggestion(null)).toBe(false);
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
    expect(html).toContain("matchup-preview-stub");
    expect(html).toContain("aria-label=\"Save bookmark\"");
    expect(html).toContain("aria-label=\"Open bookmarks\"");
    expect(html).toContain("Clear DB (12 / 34)");
    expect(html.indexOf("matchup-preview-stub")).toBeLessThan(html.indexOf("aria-label=\"Save bookmark\""));
    expect(html.indexOf("aria-label=\"Save bookmark\"")).toBeLessThan(html.indexOf("aria-label=\"Open bookmarks\""));
    expect(html.indexOf("aria-label=\"Open bookmarks\"")).toBeLessThan(html.indexOf("Clear DB (12 / 34)"));
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
  });

  it("renders a separate popularity badge row when popularity is available", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard entity={makeConnectionEntity()} />,
    );

    expect(html).toContain("bacon-connection-node-meta-primary");
    expect(html).toContain("bacon-connection-node-popularity");
    expect(html).toContain("Popularity 62.46");
  });

  it("falls back to count-only meta text when rank is unavailable", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard entity={makeConnectionEntity()} />,
    );

    expect(html).toContain("12");
    expect(html).not.toContain(" / 12");
  });

  it("renders compact source-logo tooltips with connection copy for TMDb and Cinenerdle", () => {
    const movieHtml = renderToStaticMarkup(
      <ConnectionEntityCard
        entity={makeConnectionEntity({
          connectionParentLabel: "Freddie Highmore",
          connectionRank: 3,
        })}
      />,
    );
    const cinenerdleHtml = renderToStaticMarkup(
      <ConnectionEntityCard
        entity={makeConnectionEntity({
          connectionParentLabel: "Freddie Highmore",
          key: "cinenerdle",
          kind: "cinenerdle",
          name: "cinenerdle",
          year: "",
          tmdbId: null,
          label: "cinenerdle",
          connectionRank: 3,
        })}
      />,
    );

    expect(movieHtml).toContain("alt=\"TMDb\"");
    expect(movieHtml).toContain("bacon-inline-tooltip");
    expect(movieHtml).toContain("Heat has 12 connections");
    expect(movieHtml).toContain("Freddie Highmore is the #3 connection");
    expect(cinenerdleHtml).toContain("alt=\"Cinenerdle\"");
    expect(cinenerdleHtml).toContain("bacon-inline-tooltip");
    expect(cinenerdleHtml).toContain("cinenerdle has 12 connections");
    expect(cinenerdleHtml).toContain("Freddie Highmore is the #3 connection");
  });

  it("renders a leading thumbnail when imageUrl is present", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard
        entity={makeConnectionEntity({
          connectionRank: 3,
          imageUrl: "https://img.test/heat.jpg",
        })}
      />,
    );

    expect(html).toContain("bacon-connection-node-has-image");
    expect(html).toContain("bacon-connection-node-thumbnail");
    expect(html).toContain("src=\"https://img.test/heat.jpg\"");
  });

  it("does not render a thumbnail when imageUrl is missing", () => {
    const html = renderToStaticMarkup(
      <ConnectionEntityCard entity={makeConnectionEntity()} />,
    );

    expect(html).not.toContain("bacon-connection-node-thumbnail");
    expect(html).not.toContain("bacon-connection-node-has-image");
  });

  it("keeps the title click isolated from the card click target", () => {
    const onCardClick = vi.fn();
    const onNameClick = vi.fn();
    const tree = ConnectionEntityCard({
      entity: makeConnectionEntity(),
      onCardClick,
      onNameClick,
    });
    const titleButton = findElementByClassName(tree, "bacon-connection-node-name");

    expect(titleButton).not.toBeNull();

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const clickEvent = {
      ctrlKey: false,
      metaKey: true,
      preventDefault,
      stopPropagation,
    };
    const titleButtonOnClick = titleButton?.props.onClick as
      | ((event: {
        ctrlKey: boolean;
        metaKey: boolean;
        preventDefault: () => void;
        stopPropagation: () => void;
      }) => void)
      | undefined;
    titleButtonOnClick?.(clickEvent);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onNameClick).toHaveBeenCalledOnce();
    expect(onNameClick).toHaveBeenCalledWith(clickEvent);
    expect(onCardClick).not.toHaveBeenCalled();
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
});
