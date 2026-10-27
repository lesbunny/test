# Native feature coverage

The supplied [complete inventory](requested-feature-inventory.txt) is the requested scope. This document distinguishes working implementations from remaining work; a menu or read-only definition browser does not count as complete parity.

## Delivered natively

- One dark Material-inspired workspace, account selector, dashboard, equipped slot rows, vault, weapons, armor, Postmaster, global search, item inspection, tags/notes, comparison, maximum power, conservative Shard List, bulk housekeeping, and farming.
- Resolved Bungie item names and real artwork; deterministic equipment-slot and item sorting.
- Organizer tables with 60-row pages, column and multi-column sort, checkbox range selection, bulk annotation undo, live move/lock previews, and CSV export/annotation merge (exact string IDs, multiline notes, unmatched-ID reporting).
- Search boolean groups, NOT, OR, AND, phrases, power/stat comparisons and ranges; saved searches remain available in Inventory board.
- Native loadout editor: individual gear slots, current equipment, partial snapshots, random candidate gear with search/class/exotic constraints, rename/duplicate, missing-item retention, shareable immutable snapshots, saved-item protection, gear application preview.
- In-game loadout slots: inspect, copy gear into native editor, preview equip or overwrite-current-setup. Per-item sockets: active plugs, eligible reusable plug options, preview and revalidation using only InsertSocketPlugFree. No resource-spending endpoint. These adapters are unit-tested; live outcomes remain unverified.
- Native optimizer: reported stats, weights including zero, minima/maxima, class, exotic constraints, pins, eligible-gear query, top ten evaluated candidates, bounded-search disclosure, edit/save candidates.
- Public Armory: official manifest downloads/cache, weapon/armor/plug/catalyst-name categories, search/pages, definition details, known plug pools, stat names, screenshots, owned copies, reference links.
- Native activity definitions, collectible definitions, triumph definitions. Authenticated read adapters for collectible/triumph status, character ranks, item objectives, and vendor sale offers/costs. Authenticated results need live verification.
- Personal wishlist text with positive/negative item hashes and wildcard keep entries, exact active-perk matching, community-keeper protection. Existing curated community lists remain supported.
- Incoming loot feed, duplicate inspection, keyboard keep/junk tagging, reviewed-state persistence; existing New Drops summary retained.
- Per-item infusion candidate research with conservative protection filters; existing bulk fuel staging retained.
- Drag/drop on the character/vault board, contextual inspector shortcuts, keyboard help, density preferences, optional 15-minute visible-tab sync, static offline-shell cache and web manifest.

## Partially covered / remaining details

| Requested group | Remaining work |
| --- | --- |
| Shard A–B: public site/database | Editorial home/guides/changelog/support, curated ranking and explanation pages, source/loot-table crosslinks, armor set bonuses, community-tested perk numbers, complete catalyst acquisition research. |
| Shard C: account | Avatar polish, app-wide deletion including reference caches, hosted account lifecycle. Local backup/data management already exists. |
| Shard D / DIM B–D: inventory/search | Single-character mode, complete smart-space reservations, auto-completion/history, full DIM predicates/stat arithmetic/custom totals, Champion grouping, double-click equip. |
| Shard E–F: appraisal | Enhanced-perk equivalence, tier-aware duplicate ranking, missing-perk gap UI, Armor 3.0 archetypes/artifice/tuning/attainable-spread dominance/set/exotic-class-item/event-selector modeling. No letter grades are invented from incomplete evidence. |
| Shard G–I: cleanup | Ranked dominance queue, one-at-a-time Shard List keyboard session, comprehensive mod/subclass/artifact synergy audit. Existing staging remains conservative. |
| Shard J / DIM N–P: builds | Natural-language AI builder and refinement, automatic replacement repair, batch loadout-level mod/subclass/aspect/fragment/fashion application, in-game loadout names/icons customization, class-independent configuration semantics, advanced build analysis. |
| Shard K / DIM R–T: progression | Activity lifetime completion history, To play plans, seal/gilding hierarchy, destination-based completion routing, complete catalyst tracking, Pathfinder/milestones, collection/triumph tree navigation, vendor purchases. Native read-only record/vendor pages are a foundation, not equivalents of all of these. |
| DIM E–K: management | Lock/tag synchronization policy, external GitHub wishlist subscriptions, curator editing, Clarity insights, configurable organizer columns, shift-cell filters, custom stat totals, compare multi-column ordering. |
| DIM O: optimizer | Mod-energy/socket constraints, fragment/Font bonuses, tuning, artifice, masterwork assumptions, armor set bonuses, global exhaustive search on large collections. |
| DIM V: sync/integrations | Cross-device cloud sync, Stream Deck integration, production installability matrix, complete offline/live-state UX. Local backups and offline shell do not provide cloud sync. |

## External prerequisites and validation boundaries

- Hosted AI generation requires a real backend/provider integration; no backend or provider is configured in this repository. Do not put provider secrets into static JavaScript.
- Cross-device synchronization needs an authenticated storage service. Snapshot links are self-contained public build copies, not cloud accounts.
- Full armor and socket parity requires a dedicated model of current game definitions, compatibility rules, and verified live fixtures. Reported totals are not an acceptable replacement.
- Real Bungie operations require a configured Public OAuth application, active account, and granted scopes. Existing unit fixtures cover adapter contracts; current account-state outcomes remain unverified.
- Native UI must remain native: do not reintroduce an upstream app iframe or runtime to close these gaps.
