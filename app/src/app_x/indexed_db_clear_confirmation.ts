export function formatIndexedDbClearConfirmationMessage(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `Clear the TMDB cache?\n\nThe browser estimates IndexedDB usage at about ${megabytes.toFixed(2)} MB for this site.`;
}
