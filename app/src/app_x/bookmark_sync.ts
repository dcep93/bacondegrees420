import {
  normalizeBookmarkEntries,
  type BookmarkEntry,
} from "./bookmarks";

const REQUEST_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_REQUEST";
const RESPONSE_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_RESPONSE";
const ERROR_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_ERROR";
const READY_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_BRIDGE_READY";
const MESSAGE_SOURCE = "bacondegrees-extension-bridge";
const BRIDGE_DATASET_KEY = "bacondegreesExtensionBridge";
const REQUEST_TIMEOUT_MS = 3000;
const MAX_REQUEST_ATTEMPTS = 2;
const BRIDGE_READY_TIMEOUT_MS = 1000;

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

type ExtensionReadyMessage = {
  source: typeof MESSAGE_SOURCE;
  type: typeof READY_MESSAGE_TYPE;
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

function isReadyMessage(value: unknown): value is ExtensionReadyMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ExtensionReadyMessage>;
  return candidate.source === MESSAGE_SOURCE && candidate.type === READY_MESSAGE_TYPE;
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
    window.postMessage(message, "*");
  });
}

async function postExtensionRequestWithRetry(message: ExtensionRequestMessage) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await postExtensionRequest({
        ...message,
        requestId: createRequestId(),
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Bookmark extension unavailable");
}

export function isBookmarkExtensionBridgeDetected() {
  return typeof document !== "undefined" &&
    document.documentElement?.dataset[BRIDGE_DATASET_KEY] === "ready";
}

async function waitForBookmarkExtensionBridge() {
  if (typeof document === "undefined") {
    return;
  }

  if (isBookmarkExtensionBridgeDetected()) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("Bookmark extension unavailable"));
    }, BRIDGE_READY_TIMEOUT_MS);

    function finish(callback: () => void) {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", handleMessage);
      callback();
    }

    function handleMessage(event: MessageEvent<unknown>) {
      if (isReadyMessage(event.data)) {
        finish(resolve);
      }
    }

    window.addEventListener("message", handleMessage);

    if (isBookmarkExtensionBridgeDetected()) {
      finish(resolve);
    }
  });
}

export async function getSyncedBookmarks(): Promise<BookmarkEntry[]> {
  await waitForBookmarkExtensionBridge();
  const payload = await postExtensionRequestWithRetry({
    source: MESSAGE_SOURCE,
    type: REQUEST_MESSAGE_TYPE,
    requestId: "",
    action: "bookmarks:get",
  });

  return normalizeBookmarkEntries(payload?.bookmarks);
}

export async function setSyncedBookmarks(bookmarks: BookmarkEntry[]): Promise<void> {
  await waitForBookmarkExtensionBridge();
  await postExtensionRequestWithRetry({
    source: MESSAGE_SOURCE,
    type: REQUEST_MESSAGE_TYPE,
    requestId: "",
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
