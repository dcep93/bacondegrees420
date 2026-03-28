`dump.json` under `__tests__/` is a manual debugging artifact for humans/Codex to inspect when tracing cinenerdle bugs.

Agent rules for this subtree:

- Never import `__tests__/dump.json` in unit tests.
- Tests should construct the exact state they need inline or via `__tests__/factories.ts`.
- Keep test fixtures small and intentional; do not rely on large captured dumps as test data.
