# Preserve credit ordering through refresh and cache reload

Approved with `yesi` on 2026-10-03. Keep tag priority and the existing alternating credit-order/popularity merge. Fix changed ordering inputs, rather than permanently freezing rendered cards.

## Refresh

When a person fetch enriches a matching credit in a parent film, replace that credit in its existing queue position and retain the parent credit's order and popularity. Missing order stays missing. New connections may be appended, and a direct fetch of the parent may legitimately replace its credits/ranking inputs. Merge all roles for the same film cumulatively within a person update.

## Browser cache

Persist the source credit responses for both films and people alongside the existing compact cached fields. Reload these exact responses, including array order, omitted order values, per-credit popularity, multiple roles and otherwise filtered credits. Make these fields required (null means no credits), bump IndexedDB version, and rebuild the browser cache instead of migrating legacy rows. The existing compact version-13 seed/import/export format remains unchanged; importing it explicitly initializes the new cache representation. This scope guarantees fidelity of browser cache writes/reloads, not recovery of information absent from compact imported snapshots.

## Verification

Regression tests reproduce the Musker/Clements movement on person refresh, stable in-place crew replacement, missing order, multiple roles for one film, and unchanged alternating output across cache save/load for both parent kinds. Run the existing related tests, lint, and a real IndexedDB browser reload check. Stage only task-owned changes and commit/push main.

Self-review: consistency is defined for unchanged parent ordering inputs; genuinely new parent credits, popularity and tag changes can still reorder cards. No fixed-position UI feature, new logging, legacy read fallback, or unresolved design decisions.
