const alertedCinenerdleValidationMessages = new Set<string>();

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

export function throwCinenerdleValidationError(
  message: string,
  details?: unknown,
): never {
  if (details !== undefined) {
    console.error(message, details);
  } else {
    console.error(message);
  }

  if (typeof window !== "undefined" && !alertedCinenerdleValidationMessages.has(message)) {
    alertedCinenerdleValidationMessages.add(message);
    window.alert(message);
  }

  throw new Error(message);
}
