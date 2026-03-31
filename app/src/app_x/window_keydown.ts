type WindowKeyDownAction = "close-bookmarks-jsonl-editor" | "toggle-bookmarks" | null;

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }

  const candidate = target as Partial<HTMLElement>;

  return (
    Boolean(candidate.isContentEditable) ||
    candidate.tagName === "INPUT" ||
    candidate.tagName === "TEXTAREA" ||
    candidate.tagName === "SELECT"
  );
}

export function getWindowKeyDownAction(params: {
  event: Pick<
    globalThis.KeyboardEvent,
    "altKey" | "ctrlKey" | "defaultPrevented" | "key" | "metaKey" | "target"
  >;
  isBookmarksJsonlEditorOpen: boolean;
}): WindowKeyDownAction {
  const { event, isBookmarksJsonlEditorOpen } = params;

  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }

  if (isBookmarksJsonlEditorOpen) {
    return event.key === "Escape" ? "close-bookmarks-jsonl-editor" : null;
  }

  if (isEditableKeyboardTarget(event.target)) {
    return null;
  }

  return event.key === "Escape" || event.key === "b" || event.key === "B"
    ? "toggle-bookmarks"
    : null;
}
