let hasShownCinenerdleValidationAlert = false;

export function resetCinenerdleValidationAlertState(): void {
  hasShownCinenerdleValidationAlert = false;
}

export function recordCinenerdleValidationDetails(details: unknown): void {
  void details;
}

export function throwCinenerdleValidationError(
  message: string,
  details?: unknown,
): never {
  if (details !== undefined) {
    recordCinenerdleValidationDetails(details);
  }

  if (typeof window !== "undefined" && !hasShownCinenerdleValidationAlert) {
    hasShownCinenerdleValidationAlert = true;
    window.alert(message);
  }

  throw new Error(message);
}
