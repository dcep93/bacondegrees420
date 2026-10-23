# Film release year refresh

The bundled snapshot stores Hard Candy (TMDb 2652) as 2005, while the current
movie details response uses 2006. The user approved fixing and deploying the
previously proposed same-ID, same-title year update.

Allow release-year changes when the normalized title matches for the same TMDb
ID. Retain the validation error for conflicting titles. Derive the display year
and lookup fields from the release date selected by the existing timestamp-aware
metadata merge, falling back to the cached year if no date is available.

This fixes refreshes without changing the snapshot, clearing user data, changing
the IndexedDB schema, or adding migrations. Updating only the snapshot would
leave existing caches broken; dropping all validation would broaden the change
unnecessarily.

Verify the 2005-to-2006 update, older and sparse responses, title conflicts, and
the forced-refresh path saving new credits. Run tests, build, and lint, then
commit and push main and verify the Firebase deployment and live refresh.
