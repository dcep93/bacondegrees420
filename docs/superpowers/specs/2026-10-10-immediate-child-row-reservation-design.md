# Immediate child-row reservation

Approved with `yesi` on 2026-10-10. Implement and verify without further design or planning approval pauses.

On an expandable card click, synchronously select the card, truncate obsolete descendants, and reserve the next child row before cache reads or network requests. Start one smooth vertical scroll to that reserved row on the first frame, while retaining horizontal selected-card alignment. Filled rows and reservations use the same responsive dimensions. Arrival of cached, refreshed, empty, or failed results must preserve the reserved space and must not issue another vertical reveal. Smooth scrolling may finish after a fast response, but its destination must not be retargeted. Existing same-card reselect navigation remains available.

Keep the reservation scoped to normal entity generations; preserve root, escape-break, and puzzle presentations. Guard asynchronous scroll work with lifecycle and selection identity so superseded responses cannot navigate the current selection. Do not change fetch/cache policy or credit ordering.

Record focused dev-only diagnostics in the existing title-to-clipboard log: reservation dimensions, vertical request target and reason, and post-commit geometry with selection identity. Do not enable general verbose render logs or console logging.

Verify with held-response browser tests: reservation exists during the click, has the final height, and is revealed while the response is blocked; release results and assert stable document geometry and no additional vertical request. Cover cached responses, fast responses, empty/failing results, rapid selection supersession, and narrow viewports. Run relevant unit/browser coverage and final lint. Commit and push task-owned changes on main.

Self-review: immediate means synchronous reservation plus first-frame smooth-scroll start, not waiting for network completion or an instant jump. Empty/failure rows retain space. No open design questions or unrelated refactors.

## Implementation and verification

Implemented synchronous selection/reservation, shared entity-row sizing (including entity roots; decorative and puzzle roots keep their presentation), one first-frame vertical reveal, guarded asynchronous scrolls, and retained empty reservations during background record rebuilds. Repeated clicks on a pending reservation rejoin the load instead of treating the empty row as finalized. Focused clipboard entries record the reserved geometry and scroll reason/target; existing commit entries record result geometry.

Verification: all 554 unit tests pass. Nine targeted browser tests pass, including held and fast responses, empty and failed responses, superseded and repeated selections, cached reselects, a narrow viewport with a different card width, deep-link cache reloads, and the existing delayed-refresh scenario. The browser assertions compare row height, row position, document height, scroll position, and vertical request count across response arrival and check that card content fits. The new immediate-reservation test fails against the pre-change implementation with height 0 at click time.

The broader existing homepage suite has 11 failures involving startup network mocks, prior data/badge expectations, and tooltip controls. All 11 reproduce against the pre-change implementation; the other two existing homepage cases pass both before and after this change.
