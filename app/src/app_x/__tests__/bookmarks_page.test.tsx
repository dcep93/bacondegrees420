import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BookmarksPage from "../components/bookmarks_page";
import type { BookmarkRowData } from "../bookmark_rows";
import {
  CINENERDLE_ITEM_ATTRS_STORAGE_KEY,
  readCinenerdleItemAttrs,
} from "../generators/cinenerdle2/item_attrs";
import {
  CinenerdleEntityCard,
  type RenderableCinenerdleEntityCard,
} from "../generators/cinenerdle2";

function findCinenerdleEntityCardElement(node: ReactNode): ReactElement | null {
  if (!isValidElement(node)) {
    return null;
  }

  if (node.type === CinenerdleEntityCard) {
    return node;
  }

  const children = (node as ReactElement<{ children?: ReactNode }>).props.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const foundChild = findCinenerdleEntityCardElement(child);
      if (foundChild) {
        return foundChild;
      }
    }

    return null;
  }

  return findCinenerdleEntityCardElement(children);
}

function makeRenderableBookmarkMovieCard(
  overrides: Partial<RenderableCinenerdleEntityCard> = {},
): RenderableCinenerdleEntityCard {
  return {
    key: "movie:heat:1995",
    kind: "movie",
    name: "Heat",
    imageUrl: null,
    subtitle: "1995",
    subtitleDetail: "",
    popularity: 88,
    popularitySource: "TMDb movie popularity from the cached movie record.",
    connectionCount: 12,
    connectionRank: 3,
    connectionOrder: 1,
    connectionParentLabel: "Al Pacino",
    sources: [{ iconUrl: "https://img.test/tmdb.svg", label: "TMDb" }],
    status: null,
    hasCachedTmdbSource: true,
    isExcluded: false,
    isShortDirectTmdbMovie: false,
    isSelected: false,
    isLocked: false,
    isAncestorSelected: false,
    itemAttrs: [],
    connectedItemAttrs: [],
    inheritedItemAttrs: [],
    itemAttrCounts: {
      activeCount: 0,
      passiveCount: 0,
    },
    tmdbTooltipText: "TMDb data fetched 3/29/2026, 4:03:24 PM.\nClick to refetch.",
    onExplicitTmdbRowClick: null,
    onTmdbRowClick: null,
    voteAverage: 8.2,
    voteCount: 9000,
    ...overrides,
  };
}

describe("BookmarksPage", () => {
  beforeEach(() => {
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

  it("renders bookmark cards with the shared cinenerdle footer tooltip overlay", () => {
    const bookmarkRows: BookmarkRowData[] = [{
      hash: "movie:heat:1995",
      cards: [{
        kind: "card",
        key: "bookmark:0:movie:heat:1995",
        card: makeRenderableBookmarkMovieCard(),
      }],
    }];
    const html = renderToStaticMarkup(
      <BookmarksPage
        bookmarks={[{ hash: "movie:heat:1995" }]}
        bookmarkRows={bookmarkRows}
        onLoadBookmark={vi.fn()}
        onLoadBookmarkCard={vi.fn()}
        onMoveBookmark={vi.fn()}
        onOpenBookmarkCardAsRootInNewTab={vi.fn()}
        onRemoveBookmark={vi.fn()}
      />,
    );

    expect(html).toContain("cinenerdle-card-chip-tooltip-anchor cinenerdle-card-footer-tooltip-anchor");
    expect(html).toContain("cinenerdle-card-inline-tooltip cinenerdle-card-inline-tooltip-right cinenerdle-card-footer-tooltip");
    expect(html).toContain("cinenerdle-card-footer-tooltip-panel");
    expect(html).toContain("Heat has 12 connections");
    expect(html).toContain("Al Pacino is the #3 connection");
    expect(html).toContain("TMDb data fetched 3/29/2026, 4:03:24 PM.");
    expect(html).not.toContain("<span class=\"cinenerdle-card-footer-tooltip-line\">Click to refetch.</span>");
    expect(html).not.toContain("bacon-bookmark-card-tooltip-anchor");
  });

  it("does not wrap bookmark cards when there is no shared footer tooltip content", () => {
    const bookmarkRows: BookmarkRowData[] = [{
      hash: "cinenerdle",
      cards: [{
        kind: "card",
        key: "bookmark:0:cinenerdle",
        card: {
          key: "cinenerdle",
          kind: "cinenerdle",
          name: "cinenerdle",
          imageUrl: "https://img.test/cinenerdle.svg",
          subtitle: "Daily starters",
          subtitleDetail: "Open today's board",
          popularity: 0,
          popularitySource: "Cinenerdle root cards do not have a popularity score.",
          connectionCount: 7,
          connectionRank: null,
          connectionOrder: null,
          connectionParentLabel: null,
          sources: [{ iconUrl: "https://img.test/cinenerdle.svg", label: "Cinenerdle" }],
          status: null,
          hasCachedTmdbSource: false,
          isExcluded: false,
          isShortDirectTmdbMovie: false,
          isSelected: false,
          isLocked: false,
          isAncestorSelected: false,
        },
      }],
    }];
    const html = renderToStaticMarkup(
      <BookmarksPage
        bookmarks={[{ hash: "cinenerdle" }]}
        bookmarkRows={bookmarkRows}
        onLoadBookmark={vi.fn()}
        onLoadBookmarkCard={vi.fn()}
        onMoveBookmark={vi.fn()}
        onOpenBookmarkCardAsRootInNewTab={vi.fn()}
        onRemoveBookmark={vi.fn()}
      />,
    );

    expect(html).not.toContain("cinenerdle-card-footer-tooltip-anchor");
    expect(html).not.toContain("cinenerdle-card-footer-tooltip-panel");
  });

  it("wires bookmark card attr add/remove actions to shared item attr storage", () => {
    const bookmarkRows: BookmarkRowData[] = [{
      hash: "movie:heat:1995",
      cards: [{
        kind: "card",
        key: "bookmark:0:movie:heat:1995",
        card: makeRenderableBookmarkMovieCard(),
      }],
    }];
    const tree = BookmarksPage({
      bookmarks: [{ hash: "movie:heat:1995" }],
      bookmarkRows,
      onLoadBookmark: vi.fn(),
      onLoadBookmarkCard: vi.fn(),
      onMoveBookmark: vi.fn(),
      onOpenBookmarkCardAsRootInNewTab: vi.fn(),
      onRemoveBookmark: vi.fn(),
    });
    const cardElement = findCinenerdleEntityCardElement(tree);

    expect(cardElement).not.toBeNull();
    const cardProps = cardElement?.props as {
      onAddItemAttr?: (itemAttr: string) => void;
      onRemoveItemAttr?: (itemAttr: string) => void;
    } | undefined;

    cardProps?.onAddItemAttr?.("🔥");
    expect(readCinenerdleItemAttrs()).toEqual({
      film: {
        "heat:1995": ["🔥"],
      },
      person: {},
    });

    cardProps?.onRemoveItemAttr?.("🔥");
    expect(globalThis.localStorage.getItem(CINENERDLE_ITEM_ATTRS_STORAGE_KEY)).toBe(JSON.stringify({
      film: {},
      person: {},
    }));
  });
});
