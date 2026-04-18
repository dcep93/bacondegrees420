let hasShownCinenerdleValidationAlert = false;

export function formatCinenerdleValidationValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

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
