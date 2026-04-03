import { describe, expect, it } from "vitest";

import type { BookmarkRowData } from "../bookmark_rows";
import { validateParsedItemAttrRows } from "../bookmarks_state";

function createBookmarkRow(hash: string, cards: Array<{
  key: string;
  kind: "movie" | "person";
  name: string;
}>): BookmarkRowData {
  return {
    hash,
    cards: cards.map((card) => ({
      kind: "card" as const,
      key: `${hash}:${card.key}`,
      card: {
        ...card,
      },
    })),
  } as unknown as BookmarkRowData;
}

describe("bookmarks_state", () => {
  it("rejects attr rows that do not reference any bookmarked item", () => {
    expect(() => validateParsedItemAttrRows(
      [
        {
          bucket: "film",
          id: "999",
          lineNumber: 4,
        },
      ],
      [
        createBookmarkRow("#film|The+Matrix+(1999)", [
          {
            key: "movie:603",
            kind: "movie",
            name: "The Matrix",
          },
        ]),
      ],
    )).toThrowError(
      "Bookmark text line 4 references an item that is not in the bookmarked rows",
    );
  });
});
