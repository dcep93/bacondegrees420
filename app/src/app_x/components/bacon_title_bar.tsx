import type { MouseEvent, ReactNode, Ref } from "react";
import { BookmarksJsonlEditButton } from "./bookmarks_jsonl_editor";
import Tooltip from "./tooltip";

export default function BaconTitleBar({
  clearDbBadgeText,
  copyStatus,
  copyStatusPlacement,
  isBookmarksView,
  isSavingBookmark,
  matchupPreview,
  onClearDatabase,
  onOpenBookmarksJsonlEditor,
  onReset,
  onSaveBookmark,
  onTitleDebugCopy,
  onToggleBookmarks,
  clearDbButtonRef,
  titleRef,
  toastStatusRef,
}: {
  clearDbBadgeText: string;
  copyStatus: string;
  copyStatusPlacement: "toast" | "title";
  isBookmarksView: boolean;
  isSavingBookmark: boolean;
  matchupPreview?: ReactNode;
  onClearDatabase: () => void;
  onOpenBookmarksJsonlEditor: () => void;
  onReset: () => void;
  onSaveBookmark: () => void;
  onTitleDebugCopy?: (event: MouseEvent<HTMLElement>) => void;
  onToggleBookmarks: () => void;
  clearDbButtonRef?: Ref<HTMLButtonElement>;
  titleRef?: Ref<HTMLHeadingElement>;
  toastStatusRef?: Ref<HTMLSpanElement>;
}) {
  const titleCopyStatus = copyStatusPlacement === "title" ? copyStatus : "";
  const toastOverlayMessage = copyStatusPlacement === "toast" ? copyStatus : "";

  return (
    <header className="bacon-title-bar">
      <div className="bacon-title-brand">
        <button
          aria-label="Reset generator"
          className="bacon-title-icon-button"
          onClick={onReset}
          type="button"
        >
          <span aria-hidden="true" className="bacon-title-icon">B</span>
        </button>
        <div className="bacon-title-wrap">
          <h1
            className="bacon-title"
            onClick={onTitleDebugCopy}
            ref={titleRef}
          >
            BaconDegrees420
          </h1>
          {titleCopyStatus ? (
            <span className="bacon-copy-status bacon-copy-status-title">
              {titleCopyStatus}
            </span>
          ) : null}
        </div>
      </div>
      <div className="bacon-title-actions">
        {matchupPreview ? (
          <div className="bacon-title-action-slot bacon-title-action-slot-matchup">
            {matchupPreview}
          </div>
        ) : null}
        {!isBookmarksView ? (
          <div className="bacon-title-action-slot bacon-title-action-slot-square">
            <Tooltip content={isSavingBookmark ? "Saving bookmark..." : "Save bookmark"}>
              <button
                aria-label="Save bookmark"
                className="bacon-title-action-icon-button"
                disabled={isSavingBookmark}
                onClick={onSaveBookmark}
                type="button"
              >
                💾
              </button>
            </Tooltip>
          </div>
        ) : null}
        {isBookmarksView ? (
          <div className="bacon-title-action-slot bacon-title-action-slot-text">
            <BookmarksJsonlEditButton onClick={onOpenBookmarksJsonlEditor} />
          </div>
        ) : null}
        <div className="bacon-title-action-slot bacon-title-action-slot-square">
          <Tooltip content={isBookmarksView ? "Close bookmarks" : "Open bookmarks"}>
            <button
              aria-label={isBookmarksView ? "Close bookmarks" : "Open bookmarks"}
              className="bacon-title-action-icon-button"
              onClick={onToggleBookmarks}
              type="button"
            >
              {isBookmarksView ? "🎬" : "📚"}
            </button>
          </Tooltip>
        </div>
        <div className="bacon-title-action-slot bacon-title-action-slot-text">
          <div className="bacon-title-overlay-anchor">
            {toastOverlayMessage ? (
              <span
                className="bacon-copy-status bacon-copy-status-overlay bacon-copy-status-overlay-toast"
                ref={toastStatusRef}
              >
                {toastOverlayMessage}
              </span>
            ) : null}
            <button
              aria-label={`Clear database (${clearDbBadgeText})`}
              className="bacon-title-action-button bacon-clear-db-button"
              onClick={onClearDatabase}
              ref={clearDbButtonRef}
              type="button"
            >
              {`Clear DB (${clearDbBadgeText})`}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
