`dump.json` under `__tests__/` is a manual debugging artifact for humans/Codex to inspect when tracing cinenerdle bugs.

Agent rules for this subtree:

- Never import `__tests__/dump.json` in unit tests.
- Tests should construct the exact state they need inline or via `__tests__/factories.ts`.
- Keep test fixtures small and intentional; do not rely on large captured dumps as test data.
- Do not add `console.log`, `console.debug`, `console.warn`, or similar debug instrumentation in this subtree.
- When debug logging is needed, record entries with the in-memory cinenerdle debug log in dev mode instead.
- In dev mode, clicking the `BaconDegrees420` title copies the current debug log array to the clipboard.
