const CINENERDLE_BATTLE_ORIGIN = "https://www.cinenerdle2.app";
const CINENERDLE_BATTLE_PATHNAME = "/battle";
const BACONDEGREES_HOME_URL = "https://bacondegrees420.web.app";
const CINENERDLE_GAME_OVER_DATASET_KEY = "bacondegreesCinenerdleGameOverLink";
const CINENERDLE_FANCY_TOOLTIP_DATASET_KEY = "bacondegreesFancyTooltipAttached";
const CINENERDLE_HIDE_STYLES_ID = "bacondegrees-cinenerdle-hide-styles";
const CINENERDLE_POSTER_HOVER_DATASET_KEY = "bacondegreesCinenerdlePosterHoverAttached";
const CINENERDLE_POSTER_PREVIEW_ID = "bacondegrees-cinenerdle-poster-preview";
const CINENERDLE_POSTER_PREVIEW_HIDE_DELAY_MS = 250;
const CINENERDLE_POSTER_PREVIEW_CLASS_NAMES = [
  "h-auto",
  "w-full",
  "object-contain",
  "transition-opacity",
  "duration-300",
  "opacity-100",
];
const CINENERDLE_BREAK_CONNECTOR_TYPES = new Set(["escape"]);
const CINENERDLE_SKIP_CONNECTOR_TYPE = "skip";

let cinenerdlePosterPreviewElement = null;
let cinenerdleHoveredPosterElement = null;
let cinenerdlePosterPreviewHovered = false;
let cinenerdlePosterPreviewHideTimeoutId = null;

if (window.location.hostname === "www.cinenerdle2.app") {
  injectCinenerdleHideStyles();
  window.setInterval(() => {
    attachCinenerdleGameOverLink();
    attachCinenerdlePosterHoverPreviews();
  }, 1000);
}

function injectCinenerdleHideStyles() {
  if (document.getElementById(CINENERDLE_HIDE_STYLES_ID)) {
    return;
  }

  const styleElement = document.createElement("style");
  styleElement.id = CINENERDLE_HIDE_STYLES_ID;
  styleElement.textContent = `
    #AdThrive_Footer_1_tablet {
      display: none !important;
    }
  `;

  const parentElement = document.head || document.documentElement;
  if (!parentElement) {
    return;
  }

  parentElement.appendChild(styleElement);
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

function clearCinenerdlePosterPreviewHideTimeout() {
  if (cinenerdlePosterPreviewHideTimeoutId === null) {
    return;
  }

  window.clearTimeout(cinenerdlePosterPreviewHideTimeoutId);
  cinenerdlePosterPreviewHideTimeoutId = null;
}

function hideCinenerdlePosterPreview() {
  const previewElement = cinenerdlePosterPreviewElement;
  if (!previewElement) {
    return;
  }

  clearCinenerdlePosterPreviewHideTimeout();
  previewElement.style.opacity = "0";
  previewElement.style.visibility = "hidden";
  previewElement.style.pointerEvents = "none";
  previewElement.style.transform = "translate(-50%, -50%) scale(0.98)";
}

function scheduleCinenerdlePosterPreviewHide() {
  clearCinenerdlePosterPreviewHideTimeout();

  cinenerdlePosterPreviewHideTimeoutId = window.setTimeout(() => {
    cinenerdlePosterPreviewHideTimeoutId = null;

    if (cinenerdleHoveredPosterElement || cinenerdlePosterPreviewHovered) {
      return;
    }

    hideCinenerdlePosterPreview();
  }, CINENERDLE_POSTER_PREVIEW_HIDE_DELAY_MS);
}

function updateCinenerdlePosterPreviewSize() {
  const previewElement = cinenerdlePosterPreviewElement;
  if (!previewElement) {
    return;
  }

  const { naturalWidth, naturalHeight } = previewElement;
  if (!naturalWidth || !naturalHeight) {
    return;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (!viewportWidth || !viewportHeight) {
    return;
  }

  const scale = Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
  previewElement.style.width = `${Math.round(naturalWidth * scale)}px`;
  previewElement.style.height = `${Math.round(naturalHeight * scale)}px`;
}

function getCinenerdlePosterPreviewElement() {
  if (cinenerdlePosterPreviewElement?.isConnected) {
    return cinenerdlePosterPreviewElement;
  }

  const existingPreviewElement = document.getElementById(CINENERDLE_POSTER_PREVIEW_ID);
  if (existingPreviewElement instanceof HTMLImageElement) {
    cinenerdlePosterPreviewElement = existingPreviewElement;
    return cinenerdlePosterPreviewElement;
  }

  const parentElement = document.body || document.documentElement;
  if (!parentElement) {
    return null;
  }

  const previewElement = document.createElement("img");
  previewElement.id = CINENERDLE_POSTER_PREVIEW_ID;
  previewElement.setAttribute("aria-hidden", "true");
  Object.assign(previewElement.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    zIndex: "2147483647",
    maxWidth: "100vw",
    maxHeight: "100vh",
    width: "0px",
    height: "0px",
    objectFit: "contain",
    pointerEvents: "none",
    opacity: "0",
    visibility: "hidden",
    transform: "translate(-50%, -50%) scale(0.98)",
    transition: "opacity 120ms ease, transform 120ms ease, visibility 120ms ease",
  });

  previewElement.addEventListener("load", () => {
    updateCinenerdlePosterPreviewSize();
  });
  previewElement.addEventListener("mouseenter", () => {
    cinenerdlePosterPreviewHovered = true;
    clearCinenerdlePosterPreviewHideTimeout();
  });
  previewElement.addEventListener("mouseleave", () => {
    cinenerdlePosterPreviewHovered = false;
    scheduleCinenerdlePosterPreviewHide();
  });
  window.addEventListener("resize", () => {
    if (previewElement.style.visibility === "visible") {
      updateCinenerdlePosterPreviewSize();
    }
  });

  parentElement.appendChild(previewElement);
  cinenerdlePosterPreviewElement = previewElement;
  return cinenerdlePosterPreviewElement;
}

function showCinenerdlePosterPreview(imageElement) {
  const previewElement = getCinenerdlePosterPreviewElement();
  if (!previewElement) {
    return;
  }

  clearCinenerdlePosterPreviewHideTimeout();
  cinenerdleHoveredPosterElement = imageElement;
  previewElement.alt = imageElement.alt;
  previewElement.style.width = "0px";
  previewElement.style.height = "0px";
  previewElement.style.opacity = "1";
  previewElement.style.visibility = "visible";
  previewElement.style.pointerEvents = "auto";
  previewElement.style.transform = "translate(-50%, -50%) scale(1)";

  const previewSource = imageElement.currentSrc || imageElement.src;
  if (previewElement.src !== previewSource) {
    previewElement.src = previewSource;
  }

  if (previewElement.complete) {
    updateCinenerdlePosterPreviewSize();
  }
}

function hasCinenerdlePosterPreviewClasses(imageElement) {
  return CINENERDLE_POSTER_PREVIEW_CLASS_NAMES.every((className) => {
    return imageElement.classList.contains(className);
  });
}

function isCinenerdleBattlePosterImage(imageElement, battleBoard) {
  if (!(imageElement instanceof HTMLImageElement)) {
    return false;
  }

  if (!hasCinenerdlePosterPreviewClasses(imageElement)) {
    return false;
  }

  return Boolean(getCinenerdleRoundCardElement(imageElement, battleBoard));
}

function getCinenerdleBattlePosterImages() {
  const battleBoard = document.querySelector("#battle-board");
  if (!battleBoard) {
    return [];
  }

  return Array.from(battleBoard.querySelectorAll("img[alt]")).filter((imageElement) => {
    return isCinenerdleBattlePosterImage(imageElement, battleBoard);
  });
}

function attachCinenerdlePosterHoverPreviews() {
  if (!isCinenerdleBattlePage()) {
    return;
  }

  getCinenerdleBattlePosterImages().forEach((imageElement) => {
    if (imageElement.dataset[CINENERDLE_POSTER_HOVER_DATASET_KEY] === "true") {
      return;
    }

    imageElement.dataset[CINENERDLE_POSTER_HOVER_DATASET_KEY] = "true";
    imageElement.addEventListener("mouseenter", () => {
      showCinenerdlePosterPreview(imageElement);
    });
    imageElement.addEventListener("mouseleave", () => {
      if (cinenerdleHoveredPosterElement === imageElement) {
        cinenerdleHoveredPosterElement = null;
      }

      scheduleCinenerdlePosterPreviewHide();
    });
  });
}

function attachFancyTooltip(element, label) {
  if (!element || element.dataset[CINENERDLE_FANCY_TOOLTIP_DATASET_KEY] === "true") {
    return;
  }

  element.dataset[CINENERDLE_FANCY_TOOLTIP_DATASET_KEY] = "true";

  const tooltipElement = document.createElement("span");
  tooltipElement.textContent = label;
  tooltipElement.setAttribute("role", "tooltip");
  Object.assign(tooltipElement.style, {
    position: "fixed",
    top: "0",
    left: "0",
    zIndex: "2147483647",
    minWidth: "max-content",
    maxWidth: "220px",
    padding: "10px 14px",
    border: "1px solid rgba(228, 193, 150, 0.38)",
    borderRadius: "18px",
    background:
      "linear-gradient(180deg, rgba(33, 24, 19, 0.98) 0%, rgba(14, 10, 8, 0.98) 100%)",
    boxShadow: "0 24px 48px rgba(0, 0, 0, 0.42)",
    color: "#fef3c7",
    fontSize: "0.92rem",
    fontWeight: "600",
    lineHeight: "1.35",
    whiteSpace: "normal",
    pointerEvents: "none",
    opacity: "0",
    visibility: "hidden",
    transform: "translate(-50%, 4px)",
    transition: "opacity 120ms ease, transform 120ms ease, visibility 120ms ease",
  });
  document.body.appendChild(tooltipElement);

  const positionTooltip = () => {
    const rect = element.getBoundingClientRect();
    tooltipElement.style.left = `${rect.left + rect.width / 2}px`;
    tooltipElement.style.top = `${rect.bottom + 10}px`;
  };

  const showTooltip = () => {
    positionTooltip();
    tooltipElement.style.opacity = "1";
    tooltipElement.style.visibility = "visible";
    tooltipElement.style.transform = "translate(-50%, 0)";
  };

  const hideTooltip = () => {
    tooltipElement.style.opacity = "0";
    tooltipElement.style.visibility = "hidden";
    tooltipElement.style.transform = "translate(-50%, 4px)";
  };

  element.addEventListener("blur", hideTooltip);
  element.addEventListener("focus", showTooltip);
  element.addEventListener("mouseenter", showTooltip);
  element.addEventListener("mouseleave", hideTooltip);
  window.addEventListener("scroll", () => {
    if (tooltipElement.style.visibility === "visible") {
      positionTooltip();
    }
  }, { passive: true });
  window.addEventListener("resize", () => {
    if (tooltipElement.style.visibility === "visible") {
      positionTooltip();
    }
  });
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
  attachFancyTooltip(gameOverElement, "Open BaconDegrees420");

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
