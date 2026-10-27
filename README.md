# Little Light — Destiny Companion

A dark-lavender Destiny 2 companion hosted on GitHub Pages, with inventory-management workflows inspired by [Destiny Item Manager](https://destinyitemmanager.com/) and [Shard or Keep](https://shardorkeep.com/). Independent community project; not affiliated with Bungie or those projects.

## Recent fixes (2026-10-27)

- **Unknown items fixed:** item definitions now load from Bungie component manifest paths (and correctly unwrap full world-content files). Names, icons, and rarities resolve again.
- **Inventory sorting:** DIM-style owner + bucket order, with power / name / stats / rarity sort options.
- **Tags & search:** Favorite / Keep / Junk / Infuse / Archive quick tags; richer `is:` / `bucket:` / `perk:` / `power:` search with negation.
- **Material Design 3** tokens and polish (surfaces, chips, buttons, elevation).
- **Keyboard shortcuts:** `?` help, `/` search, `I` `F` `L` `C` `D` navigation.

## Features

- **Direct Bungie connection:** uses Bungie's documented Public OAuth client flow directly from the browser. No Cloudflare account, paid backend, server or OAuth client secret is needed.
- **Live Guardian inventory:** reads the selected Destiny profile, characters, Vault, gear stats, active perks, equipped state, locks and available Postmaster items using Bungie's API and item manifest.
- **Farming Mode:** when explicitly enabled, checks the selected Guardian's eligible item buckets while the tab remains open and moves safe candidates to the Vault when needed to maintain the chosen number of open slots. It never dismantles items.
- **Bulk actions:** move unequipped character weapons/armor into the Vault; prepare a confirmed Shard List dismantling session; stage high-power infusion fuel; preview and equip a maximum-power set.
- **Postmaster:** inspect Postmaster items across Guardians and pull selected items to the owning Guardian.
- **Shard List & vault review:** confirm potential junk manually, inspect duplicates, compare with community weapon wishlists, protect exotics/high-stat armor/locked gear and stage items for an in-game dismantling session.
- **Community roll data:** loads [DIM's Voltron wishlist](https://github.com/48klocs/dim-wish-list-sources) and its extra opinionated choosy list. Exact matches to the default keeper list are protected. Choosy-only matches are flagged for review, not automatically dismantled. A missing match never proves an item is bad.
- **Maximum-power planner and loadout audit:** provides an inventory-aware highest-power preview and a transparent keyword-based setup review. The setup audit is heuristic—not an LLM-powered optimizer or a complete mod/subclass solver.
- **Local-first preferences:** browser-saved tags, notes, Shard List and loadout snapshots; CSV/JSON import and export.

## Safety boundaries

- Bungie's public Destiny API exposes item transfer, equip, lock and Postmaster-pull operations, but not an item-dismantle endpoint. **Dismantling always happens in-game, by you.**
- Farming Mode runs only while this app tab remains open. It never destroys items.

## Development

The GitHub Pages workflow publishes the `site/` directory. This is a static client-side project with no backend.

## Upstream references

- [Bungie OAuth documentation](https://github.com/Bungie-net/api/wiki/OAuth-Documentation)
- [Official Bungie API reference](https://bungie-net.github.io/)
- [DIM Inventory guide](https://github.com/DestinyItemManager/DIM/wiki/Inventory)
- [Community wishlist source repository](https://github.com/48klocs/dim-wish-list-sources)
