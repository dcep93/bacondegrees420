# Focused load and card-selection diagnostics

Add dev-only entries to the existing title-to-clipboard log. Keep normal startup and card clicks near five diagnostic entries each; existing TMDb fetch entries remain intact. Do not change loading, selection, sorting, scrolling, or cache behavior.

Startup records cache source/readiness and time, prepared-tree timing, the first DOM commit, the first frame, and one bounded post-load layout sample. Card selection records pointer-down versus click identity/order, immediate visual selection and child-row presence, resolved effect identity/cache timing, and child-tree commits (placeholder and cached/refreshed children). Include lifecycle/selection IDs, elapsed milliseconds, row/card identities, and scroll/layout measurements. Fallback paths can produce an extra commit entry.

Use narrowly filtered existing generator debug hooks; do not reenable general per-render or per-scroll output. Capture immutable summaries and keep DOM sampling dev-only. Verify lint and relevant existing tests, including delayed refresh/placeholder browser behavior where available. Commit and push task-owned changes on main.

Approved by the user with `yesi`. Self-review: scope, log budget, diagnostics destination, and validation are explicit; no behavior changes or open design questions.
