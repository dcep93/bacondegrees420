import { CinenerdleBreakBar, CinenerdleEntityCard } from "../generators/cinenerdle2";
import { didRequestNewTabNavigation } from "../index_helpers";
import { formatBookmarkIndexTooltip, formatBookmarkLabel, type BookmarkRowData } from "../bookmark_rows";
import Tooltip from "./tooltip";

export default function BookmarksPage({
  bookmarks,
  bookmarkRows,
  onLoadBookmark,
  onLoadBookmarkCard,
  onMoveBookmark,
  onOpenBookmarkCardAsRootInNewTab,
  onRemoveBookmark,
}: {
  bookmarks: { hash: string }[];
  bookmarkRows: BookmarkRowData[];
  onLoadBookmark: (bookmarkHash: string) => void;
  onLoadBookmarkCard: (bookmarkHash: string, previewCardIndex: number) => void;
  onMoveBookmark: (bookmarkHash: string, direction: "up" | "down") => void;
  onOpenBookmarkCardAsRootInNewTab: (bookmarkHash: string, previewCardIndex: number) => void;
  onRemoveBookmark: (bookmarkHash: string) => void;
}) {
  if (bookmarks.length === 0) {
    return (
      <section className="bacon-bookmarks-page">
        <div className="bacon-bookmarks-empty-state">
          <p className="bacon-bookmarks-empty-title">No bookmarks yet.</p>
          <p className="bacon-bookmarks-empty-copy">
            Save the current path with `💾` and it will show up here as a row of cards.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="bacon-bookmarks-page">
      {bookmarkRows.map((bookmarkRow, bookmarkIndex) => (
        <article className="bacon-bookmark-row-shell" key={bookmarkRow.hash}>
          <div className="bacon-bookmark-row-layout">
            <div className="bacon-bookmark-row-actions bacon-bookmark-row-actions-left">
              <button
                aria-label={`Move ${formatBookmarkLabel(bookmarkRow.hash)} up`}
                className="bacon-title-action-icon-button"
                disabled={bookmarkIndex === 0}
                onClick={() => onMoveBookmark(bookmarkRow.hash, "up")}
                type="button"
              >
                ⬆️
              </button>
              <Tooltip
                content={formatBookmarkIndexTooltip(bookmarkRow.hash)}
                placement="right-center"
                tooltipClassName="bacon-bookmark-index-tooltip"
              >
                <span className="bacon-bookmark-index-bubble" role="note" tabIndex={0}>
                  {bookmarkIndex + 1}
                </span>
              </Tooltip>
              <button
                aria-label={`Move ${formatBookmarkLabel(bookmarkRow.hash)} down`}
                className="bacon-title-action-icon-button"
                disabled={bookmarkIndex === bookmarkRows.length - 1}
                onClick={() => onMoveBookmark(bookmarkRow.hash, "down")}
                type="button"
              >
                ⬇️
              </button>
              <Tooltip content="Load bookmark" placement="right-center">
                <button
                  aria-label={`Load ${formatBookmarkLabel(bookmarkRow.hash)}`}
                  className="bacon-title-action-icon-button"
                  onClick={() => onLoadBookmark(bookmarkRow.hash)}
                  type="button"
                >
                  📥
                </button>
              </Tooltip>
              <Tooltip content="Remove bookmark" placement="right-center">
                <button
                  aria-label={`Remove ${formatBookmarkLabel(bookmarkRow.hash)}`}
                  className="bacon-title-action-icon-button bacon-title-action-icon-button-danger"
                  onClick={() => onRemoveBookmark(bookmarkRow.hash)}
                  type="button"
                >
                  🗑️
                </button>
              </Tooltip>
            </div>
            <div className="bacon-bookmark-row-body">
              <div className="bacon-bookmark-card-row">
                {bookmarkRow.cards.map((card, cardIndex) => {
                  if (card.kind === "break") {
                    return (
                      <div
                        className="generator-card-button generator-card-button-row-break"
                        key={card.key}
                      >
                        <CinenerdleBreakBar label={card.label} />
                      </div>
                    );
                  }

                  return (
                    <button
                      className="generator-card-button"
                      key={card.key}
                      onClick={() => onLoadBookmarkCard(bookmarkRow.hash, cardIndex)}
                      type="button"
                    >
                      <CinenerdleEntityCard
                        card={card.card}
                        onTitleClick={(event) => {
                          if (didRequestNewTabNavigation(event)) {
                            onOpenBookmarkCardAsRootInNewTab(bookmarkRow.hash, cardIndex);
                            return;
                          }

                          onLoadBookmarkCard(bookmarkRow.hash, cardIndex);
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
