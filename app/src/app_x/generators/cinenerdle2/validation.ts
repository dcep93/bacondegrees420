let hasShownCinenerdleValidationAlert = false;

export function resetCinenerdleValidationAlertState(): void {
  hasShownCinenerdleValidationAlert = false;
}

function canUseValidationClipboardFallback(): boolean {
  return typeof document !== "undefined" && typeof document.createElement === "function";
}

function copyValidationTextWithDomFallback(text: string): boolean {
  if (!canUseValidationClipboardFallback() || !document.body) {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

export function copyCinenerdleValidationDetailsToClipboard(details: unknown): void {
  const text = JSON.stringify(details, null, 2);

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => {
        copyValidationTextWithDomFallback(text);
      });
      return;
    }

    copyValidationTextWithDomFallback(text);
  } catch {
    // Best-effort logging only. Validation should still bail out even if clipboard copy fails.
  }
}

export function throwCinenerdleValidationError(
  message: string,
  details?: unknown,
): never {
  if (details !== undefined) {
    copyCinenerdleValidationDetailsToClipboard(details);
  }

  if (typeof window !== "undefined" && !hasShownCinenerdleValidationAlert) {
    hasShownCinenerdleValidationAlert = true;
    window.alert(message);
  }

  throw new Error(message);
}
