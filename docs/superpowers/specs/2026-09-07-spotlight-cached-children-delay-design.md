# Spotlight Cached-Children Delay Design

## Goal

Prevent a spotlight change from briefly showing cached children immediately before a typical fast TMDb refresh replaces them. Preserve cached children as a fallback when the refresh is slow or fails.

## Scope

This change applies to genuine movie or person spotlight changes in the Cinenerdle generator. Same-card reselection and initial tree loading keep their current behavior.

## Behavior

After resolving the selected card's best local record, the controller will use the existing direct-TMDb-source check to decide whether the selection requires a network refresh.

When no refresh is required, the controller will build and render cached children immediately, then perform the existing vertical and horizontal alignment.

When a refresh is required, the controller will:

1. Urgently replace all prior descendant rows with one mounted, empty child row.
2. Vertically scroll that empty row into view.
3. Start building the cached child row and refreshing the selected card from TMDb.
4. Start a 1000 ms cached-row fallback timer at the same time as the refresh.
5. If the refresh settles successfully before the timer, cancel the fallback and render the refreshed child row without ever showing cached children.
6. If the timer wins, render cached children while the refresh continues; replace them with refreshed children once the refresh succeeds.
7. If the refresh fails before the fallback appears, cancel the timer and render cached children immediately.

If the refresh fails after the fallback appears, the already-rendered cached children remain visible.

If either cached or refreshed data has no children, the corresponding final tree follows the generator's existing no-child semantics. The intentionally empty placeholder exists only during a required refresh.

## Cancellation and Concurrency

The fallback timer belongs to one selection effect. A settled flag will be checked after asynchronous cached-row preparation so a timer callback that has already fired cannot commit cached children after the refresh settles. A reveal-once guard will prevent the timer and error path from committing the same fallback twice.

The timer will be cleared when the refresh settles. Existing lifecycle and selection guards will continue rejecting updates from superseded spotlight selections or unmounted generators.

## Scrolling

An empty array already renders as a real generator row with reserved height. Vertical readiness will treat an indexed, mounted empty row as ready, allowing the placeholder to scroll into view promptly. Horizontal alignment will continue to require a rendered card and will run only for cached or refreshed nonempty rows.

## Implementation Boundary

The timing state machine will remain in the Cinenerdle controller, close to the selection fetch it coordinates. The generic generator will receive only the small readiness distinction needed to scroll a mounted empty row. No CSS masking, loading card, generic deferred-render framework, or new cache schema is needed.

## Error Handling

A failed required refresh will preserve usability by revealing cached children immediately. It will not leave the spotlight blank or let the outer selection-effect fallback erase available cached descendants.

## Verification

Coverage will stay intentionally lean:

- Focused controller tests will prove the three distinct branches: direct/no-fetch, fast refresh with canceled fallback, and slow or failed refresh with cached fallback.
- Existing movie and person cases will be consolidated where practical instead of duplicating the full timing matrix for both entity kinds.
- One Playwright scenario will verify that a fast required refresh exposes an empty child row rather than cached cards, then renders refreshed children.
- The wider suite will be audited conservatively. Only tests that are demonstrably stale, redundant, or superseded will be removed or consolidated; uncertain coverage will remain.
- Targeted tests, the complete unit suite, build, and required final lint will run before handoff.
