# Little Light — Destiny Companion

A dark-lavender Destiny 2 companion hosted on GitHub Pages, with inventory-management workflows inspired by [Destiny Item Manager](https://destinyitemmanager.com/) and [Shard or Keep](https://shardorkeep.com/). Independent community project; not affiliated with Bungie or those projects.

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

## Connect your Bungie account (no server required)

Bungie supports **Public** OAuth clients for apps that cannot keep a client secret confidential. Public clients must not submit a client secret and do not receive a refresh token, so the app asks you to sign in again when the access token expires. See [Bungie's OAuth documentation](https://github.com/Bungie-net/api/wiki/OAuth-Documentation).

1. Open the [Bungie Application Portal](https://www.bungie.net/en/Application). Create or edit an app with **Client Type: Public**.
2. Set **Origin** to `https://lesbunny.github.io`.
3. Set the registered **Redirect URL** to `https://lesbunny.github.io/test/` exactly, including the trailing slash.
4. Enable `ReadBasicUserProfile`, `ReadDestinyInventoryAndVault`, and `MoveEquipDestinyItems`.
5. Open [Little Light](https://lesbunny.github.io/test/), click **Connect Bungie**, paste the app's API Key and Public OAuth Client ID, then choose **Save & sign in to Bungie**.

The API Key and Client ID are public application identifiers; the app keeps them in your browser preferences, not hardcoded in source. Set the Bungie application Origin to this site's origin so Bungie can restrict API use to the intended site. Do **not** use a Confidential client for this browser-only flow, do not paste a client secret into the site, and do not commit credentials into source code.

### Important about making the repository private

A private repository does **not** automatically make a published GitHub Pages website private. GitHub documents that Pages sites remain publicly accessible when published from a private repository; on GitHub Free, changing a repository to private automatically unpublishes its Pages site. See [GitHub's repository visibility notes](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility) and [Pages visibility documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site). Keeping the source private is not a way to hide secrets embedded in a deployed static page.

## Safety boundaries

- Bungie's public Destiny API exposes item transfer, equip, lock and Postmaster-pull operations, but not an item-dismantle endpoint. **Dismantling always happens in-game, by you.** The Shard List tracks confirmed candidates and stages them on the selected Guardian.
- Staging excludes items that are locked, exotic, protected or loadout-referenced, exact matches to DIM's keeper wishlist, high-stat armor (65+ total), and tracked weapons with 500+ kills or unverifiable tracked-kill data. A choosy-only roll is a prompt for review, not permission to dismantle.
- Roll databases are community curation, not a universal god-roll oracle. These lists mainly describe weapon perk combinations; inspect your actual roll and confirm every item before dismantling.
- Bulk actions show a preview and require explicit confirmation. Network failures can produce partial success; read the operation report and refresh before repeating a bulk action.
- Vault free space and inventory counts depend on the latest Bungie response. Recheck in-game if you are close to capacity.
- Farming Mode runs only while this app tab remains open. It stops on reload and must be explicitly enabled again. It never destroys items.

## Development

The GitHub Pages workflow publishes the `site/` directory and validates the browser JavaScript on each push to `main`. This is a static client-side project and has no backend service to deploy.

## Upstream references

- [Bungie OAuth documentation](https://github.com/Bungie-net/api/wiki/OAuth-Documentation)
- [Bungie CORS / Origin guidance](https://github.com/Bungie-net/api/wiki/Cross-Origin-Resource-Sharing-%28Origin-header%29)
- [Official Bungie API reference](https://bungie-net.github.io/)
- [DIM Inventory guide](https://github.com/DestinyItemManager/DIM/wiki/Inventory)
- [DIM Wish Lists guide](https://github.com/DestinyItemManager/DIM/wiki/Wish-Lists)
- [Community wishlist source repository](https://github.com/48klocs/dim-wish-list-sources)
