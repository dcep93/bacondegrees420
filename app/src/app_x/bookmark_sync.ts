import {
  normalizeBookmarkEntries,
  type BookmarkEntry,
} from "./bookmarks";

const REQUEST_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_REQUEST";
const RESPONSE_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_RESPONSE";
const ERROR_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_ERROR";
const MESSAGE_SOURCE = "bacondegrees-extension-bridge";
const REQUEST_TIMEOUT_MS = 500;

type ExtensionRequestAction = "bookmarks:get" | "bookmarks:set";

type ExtensionRequestMessage = {
  source: typeof MESSAGE_SOURCE;
  type: typeof REQUEST_MESSAGE_TYPE;
  requestId: string;
  action: ExtensionRequestAction;
  bookmarks?: BookmarkEntry[];
};

type ExtensionResponseMessage = {
  source: typeof MESSAGE_SOURCE;
  type: typeof RESPONSE_MESSAGE_TYPE;
  requestId: string;
  payload?: {
    bookmarks?: unknown;
  };
};

type ExtensionErrorMessage = {
  source: typeof MESSAGE_SOURCE;
  type: typeof ERROR_MESSAGE_TYPE;
  requestId: string;
  error?: string;
};

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `bookmark-sync-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isResponseMessage(
  value: unknown,
  requestId: string,
): value is ExtensionResponseMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ExtensionResponseMessage>;
  return (
    candidate.source === MESSAGE_SOURCE &&
    candidate.type === RESPONSE_MESSAGE_TYPE &&
    candidate.requestId === requestId
  );
}

function isErrorMessage(
  value: unknown,
  requestId: string,
): value is ExtensionErrorMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ExtensionErrorMessage>;
  return (
    candidate.source === MESSAGE_SOURCE &&
    candidate.type === ERROR_MESSAGE_TYPE &&
    candidate.requestId === requestId
  );
}

function postExtensionRequest(message: ExtensionRequestMessage) {
  return new Promise<ExtensionResponseMessage["payload"]>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("Bookmark extension unavailable"));
    }, REQUEST_TIMEOUT_MS);

    function finish(callback: () => void) {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", handleMessage);
      callback();
    }

    function handleMessage(event: MessageEvent<unknown>) {
      if (event.source !== window) {
        return;
      }

      const nextMessage = event.data;

      if (isResponseMessage(nextMessage, message.requestId)) {
        finish(() => {
          resolve(nextMessage.payload);
        });
        return;
      }

      if (isErrorMessage(nextMessage, message.requestId)) {
        finish(() => {
          reject(new Error(nextMessage.error || "Bookmark extension request failed"));
        });
      }
    }

    window.addEventListener("message", handleMessage);
    window.postMessage(message, window.location.origin);
  });
}

export async function getSyncedBookmarks(): Promise<BookmarkEntry[]> {
  const payload = await postExtensionRequest({
    source: MESSAGE_SOURCE,
    type: REQUEST_MESSAGE_TYPE,
    requestId: createRequestId(),
    action: "bookmarks:get",
  });

  return normalizeBookmarkEntries(payload?.bookmarks);
}

export async function setSyncedBookmarks(bookmarks: BookmarkEntry[]): Promise<void> {
  await postExtensionRequest({
    source: MESSAGE_SOURCE,
    type: REQUEST_MESSAGE_TYPE,
    requestId: createRequestId(),
    action: "bookmarks:set",
    bookmarks: normalizeBookmarkEntries(bookmarks),
  });
}

export const bookmarkSyncMessageTypes = {
  error: ERROR_MESSAGE_TYPE,
  request: REQUEST_MESSAGE_TYPE,
  response: RESPONSE_MESSAGE_TYPE,
} as const;

export const bookmarkSyncMessageSource = MESSAGE_SOURCE;
