Agent rules for this subtree:

- Tests should construct the exact state they need inline or via `__tests__/factories.ts`.
- Do not add `console.log`, `console.debug`, `console.warn`, or similar debug instrumentation in this subtree, except for the TMDb fetch/prefetch raw-response logging seam in `tmdb.ts`.
- When debug logging is needed, record entries with the in-memory cinenerdle debug log in dev mode instead.
- When timing or perf logging is needed, do not use `console.*`; write those entries to the in-memory cinenerdle debug log so they are copied via the existing clipboard debug tool.
- In dev mode, clicking the `BaconDegrees420` title copies the current debug log array to the clipboard.
- When tracing bugs that may depend on real app data, check `/Users/danielcepeda/repos/bacondegrees420/app/public/dump.json`; it is a useful real-data snapshot for reproducing and understanding issues.
- When the user says to "reset logs", keep the clipboard debug flow and `addCinenerdleDebugLog` instrumentation available, but remove the current `addCinenerdleDebugLog` callsites so clicking the title reports `0 logs splice copied`.
- Exception: do not remove the TMDb fetch/prefetch clipboard log callsites in `tmdb.ts` during a log reset; those should stay active.
- Adding logs back to the clipboard flow after a reset is as simple as calling `addCinenerdleDebugLog` again at the desired callsites.
- For Cinenerdle IndexedDB changes, do not add legacy-data fallback, repair, or read-time migration logic.
- Prefer bumping `INDEXED_DB_VERSION` and rebuilding the cache from scratch over supporting older cached schemas or partially populated records.
- Changes in this subtree must pass ESLint before handoff; run `npm run lint` in `/Users/danielcepeda/repos/bacondegrees420/app` and fix any failures.
- When code in this subtree changes, always run `npm run lint` immediately before finalizing and immediately before sending the user the final handoff message.
