const REQUEST_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_REQUEST";
const RESPONSE_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_RESPONSE";
const ERROR_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_ERROR";
const READY_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_BRIDGE_READY";
const MESSAGE_SOURCE = "bacondegrees-extension-bridge";
const BRIDGE_DATASET_KEY = "bacondegreesExtensionBridge";

if (window.location.hostname === "www.cinenerdle2.app") {
  console.log("hello world");
}

function isBridgeRequest(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    value.source === MESSAGE_SOURCE &&
    value.type === REQUEST_MESSAGE_TYPE &&
    typeof value.requestId === "string" &&
    typeof value.action === "string"
  );
}

function postBridgeMessage(type, requestId, payload) {
  window.postMessage(
    {
      source: MESSAGE_SOURCE,
      type,
      requestId,
      ...payload,
    },
    "*",
  );
}

function markBridgeReady() {
  if (document.documentElement) {
    document.documentElement.dataset[BRIDGE_DATASET_KEY] = "ready";
  } else {
    window.setTimeout(markBridgeReady, 0);
  }

  window.postMessage(
    {
      source: MESSAGE_SOURCE,
      type: READY_MESSAGE_TYPE,
    },
    "*",
  );
}

if (
  window.location.hostname === "localhost" ||
  window.location.hostname === "bacondegrees420.web.app"
) {
  markBridgeReady();

  window.addEventListener("message", (event) => {
    if (!isBridgeRequest(event.data)) {
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: event.data.action,
        bookmarks: event.data.bookmarks,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          postBridgeMessage(ERROR_MESSAGE_TYPE, event.data.requestId, {
            error: chrome.runtime.lastError.message || "Extension bridge request failed",
          });
          return;
        }

        if (response?.error) {
          postBridgeMessage(ERROR_MESSAGE_TYPE, event.data.requestId, {
            error: response.error,
          });
          return;
        }

        postBridgeMessage(RESPONSE_MESSAGE_TYPE, event.data.requestId, {
          payload: response ?? {},
        });
      },
    );
  });
}
