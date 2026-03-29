const REQUEST_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_REQUEST";
const RESPONSE_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_RESPONSE";
const ERROR_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_ERROR";
const READY_MESSAGE_TYPE = "BACONDEGREES_EXTENSION_BRIDGE_READY";
const MESSAGE_SOURCE = "bacondegrees-extension-bridge";
const BRIDGE_DATASET_KEY = "bacondegreesExtensionBridge";
const CINENERDLE_BATTLE_ORIGIN = "https://www.cinenerdle2.app";
const CINENERDLE_BATTLE_PATHNAME = "/battle";
const BACONDEGREES_HOME_URL = "https://bacondegrees420.web.app";
const CINENERDLE_GAME_OVER_DATASET_KEY = "bacondegreesCinenerdleGameOverLink";
const CINENERDLE_BREAK_CONNECTOR_TYPES = new Set(["escape"]);
const CINENERDLE_SKIP_CONNECTOR_TYPE = "skip";

if (window.location.hostname === "www.cinenerdle2.app") {
  window.setInterval(() => {
    attachCinenerdleGameOverLink();
  }, 1000);
}

function normalizeText(value) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeTitleCase(value) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return "";
  }

  const isAllLowercase = normalizedValue === normalizedValue.toLowerCase();
  const isAllUppercase = normalizedValue === normalizedValue.toUpperCase();
  if (!isAllLowercase && !isAllUppercase) {
    return normalizedValue;
  }

  return normalizedValue
    .toLowerCase()
    .replace(/(^|[\s'.-])\p{L}/gu, (match) => match.toUpperCase());
}

function isCinenerdleBattlePage() {
  return (
    window.location.origin === CINENERDLE_BATTLE_ORIGIN &&
    window.location.pathname === CINENERDLE_BATTLE_PATHNAME
  );
}

function serializeHashSegment(segment) {
  return encodeURIComponent(normalizeText(segment)).replace(/%20/g, "+").replace(/%3A/gi, ":");
}

function findCinenerdleGameOverElement() {
  const inputBar = document.querySelector("#input-bar");
  if (!inputBar) {
    return null;
  }

  return Array.from(inputBar.querySelectorAll("div")).find((element) => {
    if (normalizeText(element.textContent) !== "GAME OVER") {
      return false;
    }

    return normalizeText(element.parentElement?.textContent).includes("View Battle Summary");
  }) ?? null;
}

function parseCinenerdleRoundNumber(value) {
  const match = normalizeText(value).match(/^Round (\d+)$/i);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function findCinenerdleRoundLabel(cardElement) {
  return Array.from(cardElement.querySelectorAll("div")).find((element) => {
    return parseCinenerdleRoundNumber(element.textContent) !== null;
  }) ?? null;
}

function getCinenerdleRoundCardElement(imageElement, battleBoard) {
  let currentElement = imageElement.parentElement;

  while (currentElement && currentElement !== battleBoard) {
    if (findCinenerdleRoundLabel(currentElement)) {
      return currentElement;
    }

    currentElement = currentElement.parentElement;
  }

  return null;
}

function getCinenerdleRoundWrapper(cardElement) {
  const wrapperElement = cardElement?.parentElement?.parentElement;

  if (!wrapperElement || wrapperElement.children.length === 0) {
    return null;
  }

  return wrapperElement;
}

function getCinenerdleMovieLabel(cardElement) {
  const posterImage = cardElement.querySelector("img[alt]");
  if (!posterImage) {
    return "";
  }

  return normalizeText(posterImage.getAttribute("alt"));
}

function getCinenerdleConnectorElement(roundWrapperElement) {
  const directChildElements = Array.from(roundWrapperElement.children).filter((element) => {
    return element instanceof HTMLElement;
  });

  return directChildElements.find((element) => {
    return (
      element.querySelector(".fa-solid.fa-link") ||
      element.querySelector(".fa-duotone.fa-right-to-line") ||
      element.querySelector(".fa-duotone.fa-person-running-fast")
    );
  }) ?? null;
}

function getCinenerdleConnectorType(connectorElement) {
  if (!connectorElement) {
    return null;
  }

  if (connectorElement.querySelector(".fa-duotone.fa-right-to-line")) {
    return CINENERDLE_SKIP_CONNECTOR_TYPE;
  }

  if (connectorElement.querySelector(".fa-duotone.fa-person-running-fast")) {
    return "escape";
  }

  if (connectorElement.querySelector(".fa-solid.fa-link")) {
    return "link";
  }

  return null;
}

function getCinenerdleFirstConnectorPerson(connectorElement) {
  if (!connectorElement) {
    return "";
  }

  const connectorCards = Array.from(connectorElement.querySelectorAll(".oswald")).filter((element) => {
    return element.querySelector(".fa-solid.fa-link");
  });

  if (connectorCards.length === 0) {
    return "";
  }

  const firstConnectorCard = connectorCards[0];
  const textCandidates = Array.from(firstConnectorCard.querySelectorAll("div"))
    .map((element) => normalizeText(element.textContent))
    .filter(Boolean)
    .filter((text) => text !== "×××" && text !== "SKIP" && text !== "ESCAPE");
  const personLabel = textCandidates.find((text) => {
    return !text.includes("×");
  }) ?? "";

  return normalizeTitleCase(personLabel);
}

function getCinenerdleRoundEntries() {
  const battleBoard = document.querySelector("#battle-board");
  if (!battleBoard) {
    return [];
  }

  const entriesByRound = new Map();

  Array.from(battleBoard.querySelectorAll("img[alt]")).forEach((imageElement) => {
    const cardElement = getCinenerdleRoundCardElement(imageElement, battleBoard);
    if (!cardElement) {
      return;
    }

    const roundLabelElement = findCinenerdleRoundLabel(cardElement);
    const roundNumber = parseCinenerdleRoundNumber(roundLabelElement?.textContent ?? "");
    const movieLabel = getCinenerdleMovieLabel(cardElement);
    if (roundNumber === null || !movieLabel) {
      return;
    }

    const wrapperElement = getCinenerdleRoundWrapper(cardElement);
    const connectorElement = wrapperElement ? getCinenerdleConnectorElement(wrapperElement) : null;

    entriesByRound.set(roundNumber, {
      roundNumber,
      movieLabel,
      connectorType: getCinenerdleConnectorType(connectorElement),
      connectorPerson: getCinenerdleFirstConnectorPerson(connectorElement),
    });
  });

  return Array.from(entriesByRound.values()).sort((left, right) => {
    return left.roundNumber - right.roundNumber;
  });
}

function buildCinenerdleBattleHash() {
  const roundEntries = getCinenerdleRoundEntries();
  if (roundEntries.length === 0) {
    return "";
  }

  const segments = ["cinenerdle"];
  let lastMovieLabel = "";

  roundEntries.forEach((roundEntry, index) => {
    if (index === 0) {
      segments.push(roundEntry.movieLabel);
      lastMovieLabel = roundEntry.movieLabel;
      return;
    }

    if (roundEntry.connectorType === "link" && roundEntry.connectorPerson) {
      segments.push(roundEntry.connectorPerson);
    }

    if (roundEntry.connectorType && CINENERDLE_BREAK_CONNECTOR_TYPES.has(roundEntry.connectorType)) {
      segments.push("");
    }

    if (
      roundEntry.connectorType === CINENERDLE_SKIP_CONNECTOR_TYPE &&
      roundEntry.movieLabel === lastMovieLabel
    ) {
      return;
    }

    segments.push(roundEntry.movieLabel);
    lastMovieLabel = roundEntry.movieLabel;
  });

  return `#${segments.map(serializeHashSegment).join("|")}`;
}

function getCinenerdleBattleUrl() {
  const battleHash = buildCinenerdleBattleHash();

  if (!battleHash) {
    return BACONDEGREES_HOME_URL;
  }

  return `${BACONDEGREES_HOME_URL}/${battleHash}`;
}

function attachCinenerdleGameOverLink() {
  if (!isCinenerdleBattlePage()) {
    return;
  }

  const gameOverElement = findCinenerdleGameOverElement();
  if (!gameOverElement || gameOverElement.dataset[CINENERDLE_GAME_OVER_DATASET_KEY] === "true") {
    return;
  }

  gameOverElement.dataset[CINENERDLE_GAME_OVER_DATASET_KEY] = "true";
  gameOverElement.style.cursor = "pointer";
  gameOverElement.style.textDecoration = "underline";
  gameOverElement.style.textUnderlineOffset = "4px";
  gameOverElement.tabIndex = 0;
  gameOverElement.title = "Open BaconDegrees420";

  const openBaconDegreesHome = () => {
    window.open(getCinenerdleBattleUrl(), "_blank", "noopener,noreferrer");
  };

  gameOverElement.addEventListener("click", openBaconDegreesHome);
  gameOverElement.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openBaconDegreesHome();
    }
  });
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
