import type { Ref } from "react";
import Tooltip from "./tooltip";

export function BookmarksJsonlEditButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Tooltip content="Edit as text" useFixedPosition>
      <button
        aria-label="Edit as text"
        className="bacon-title-action-button"
        onClick={onClick}
        type="button"
      >
        <span>Edit as text</span>
      </button>
    </Tooltip>
  );
}

export default function BookmarksJsonlEditorModal({
  bookmarksJsonlDraft,
  isBookmarksJsonlDraftDirty,
  onApply,
  onChange,
  onReset,
  textareaRef,
}: {
  bookmarksJsonlDraft: string;
  isBookmarksJsonlDraftDirty: boolean;
  onApply: () => void;
  onChange: (nextDraft: string) => void;
  onReset: () => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  return (
    <div
      aria-label="Edit as text"
      aria-modal="true"
      className="bacon-modal bacon-bookmarks-jsonl-modal"
      onClick={(event) => event.stopPropagation()}
      role="dialog"
    >
      <textarea
        className="bacon-bookmarks-jsonl-textarea"
        id="bacon-bookmarks-jsonl-textarea"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        ref={textareaRef}
        spellCheck={false}
        value={bookmarksJsonlDraft}
      />
      <div className="bacon-bookmarks-jsonl-modal-actions">
        <button
          className="bacon-title-action-button"
          disabled={!isBookmarksJsonlDraftDirty}
          onClick={onReset}
          type="button"
        >
          Reset
        </button>
        <button
          className="bacon-title-action-button"
          disabled={!isBookmarksJsonlDraftDirty}
          onClick={onApply}
          type="button"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
