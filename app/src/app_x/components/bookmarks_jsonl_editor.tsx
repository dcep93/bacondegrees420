import type { Ref } from "react";

export function BookmarksJsonlEditButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button
      aria-label="Edit as text"
      className="bacon-title-action-button"
      onClick={onClick}
      type="button"
    >
      <span>Edit as text</span>
    </button>
  );
}

export default function BookmarksJsonlEditorModal({
  bookmarksJsonlDraft,
  isBookmarksJsonlDraftDirty,
  onApply,
  onChange,
  onClose,
  onReset,
  textareaRef,
}: {
  bookmarksJsonlDraft: string;
  isBookmarksJsonlDraftDirty: boolean;
  onApply: () => void;
  onChange: (nextDraft: string) => void;
  onClose: () => void;
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
      <button
        aria-label="Close text editor"
        className="bacon-title-action-icon-button bacon-bookmarks-jsonl-modal-close"
        onClick={onClose}
        type="button"
      >
        ✕
      </button>
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
