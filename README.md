# Little Light — Destiny Companion

A dark-lavender Destiny 2 companion hosted on GitHub Pages, with inventory-management workflows inspired by [Destiny Item Manager](https://destinyitemmanager.com/) and [Shard or Keep](https://shardorkeep.com/). Independent community project; not affiliated with Bungie or those projects.

## Features

- **Bungie connection:** OAuth starts at a Cloudflare Worker. The Worker holds the Bungie API key and OAuth client secret, while the browser stores the returned access/refresh tokens for this session. The page never asks you to paste a secret into it.
- **Live Guardian inventory:** reads the selected Destiny profile, characters, Vault, gear stats, active perks, equipped state, locks and available Postmaster items using Bungie's API and item manifest.
- **Farming Mode:** when enabled, checks the selected Guardian's eligible item buckets while the tab remains open and moves one safe candidate to the Vault when needed to maintain the chosen number of open slots. It never dismantles items.
- **Bulk actions:** move unequipped character weapons/armor into the Vault; prepare a confirmed Shard List dismantling session; stage high-power infusion fuel; preview and equip a maximum-power set.
- **Postmaster:** inspect Postmaster items across Guardians and pull selected items to the owning Guardian.
- **Shard List & vault review:** confirm potential junk manually, inspect duplicate rolls, compare with community weapon wishlists, protect exotics/high-stat armor/locked gear and use the list to stage items for an in-game dismantling session.
- **Community roll data:** loads [DIM's Voltron wishlist](https://github.com/48klocs/dim-wish-list-sources) and its optional opinionated choosy wishlist. Exact matches to the default keeper list are protected. Choosy-only matches are flagged for review, not automatically dismantled. A missing match never proves an item is bad.
- **Maximum-power planner and loadout audit:** builds an inventory-aware highest-power preview and a transparent keyword-based setup review. The setup audit is heuristic—not an LLM-powered optimizer and not a complete mod/subclass solver.
- **Local-first preferences:** browser-saved tags, notes, Shard List and loadout snapshots; CSV/JSON import and export.

## Connect your Bungie account

The static website cannot safely keep a confidential OAuth secret: GitHub Pages serves its JavaScript to visitors even if the repository is private. The project therefore includes a small Cloudflare Worker in the worker directory.

Follow **[Connect your Bungie account](worker/README.md#connect-your-bungie-account)** for setup. In brief:

1. Deploy the worker directory to your Cloudflare account.
2. Add BUNGIE_API_KEY, BUNGIE_CLIENT_ID, BUNGIE_CLIENT_SECRET, and STATE_SECRET as Cloudflare Worker secrets.
3. Configure your Bungie application Origin as https://lesbunny.github.io and its Redirect URL as your deployed Worker URL plus /oauth/callback.
4. Enable ReadBasicUserProfile, ReadDestinyInventoryAndVault, and MoveEquipDestinyItems.
5. In [Little Light](https://lesbunny.github.io/test/), click **Connect Bungie**, paste only the HTTPS Worker base URL, and choose **Save & sign in to Bungie**.

**Never put the OAuth client secret or Bungie API key in the site directory or any client-side JavaScript.** Don't commit these secrets to GitHub, even if you plan to make the source repository private. Cloudflare's Worker secret store is the intended place for them.

## Safety boundaries

- The public Destiny API exposes item transfer, equip, lock and Postmaster-pull operations, but not an item-dismantle endpoint. **Dismantling always happens in-game, by you.** The Shard List only tracks confirmed candidates and stages them on the selected Guardian.
- Staging excludes items that are locked, exotic, protected or loadout-referenced, exact matches to DIM's keeper wishlist, high-stat armor (65+ total), and tracked weapons with 500+ kills or unverifiable tracked-kill data. A choosy-only roll is a suggestion to review, not permission to dismantle.
- Roll databases are community curation, not a universal god-roll oracle. The lists mainly describe weapon perk combinations; inspect your actual roll and confirm every item before dismantling.
- Bulk actions show a preview and require explicit confirmation. Network failures can produce partial success; read the operation report and refresh before repeating a bulk action.
- Vault free space and inventory counts depend on the latest Bungie response. Recheck in game if you are close to capacity.
- Farming Mode runs only while this app tab remains open. It does not run in the background and never destroys items.

## Development

The Pages workflow publishes the site directory and validates JavaScript plus the Worker's unit tests on each push to main.

To work locally, install Node.js and npm, then run these commands from the worker directory: npm install, npm test, and npm run dev. For a deploy, run npx wrangler login, configure the secrets listed above, and run npm run deploy. See [the Worker setup guide](worker/README.md).

## Upstream references

- [Bungie OAuth documentation](https://github.com/Bungie-net/api/wiki/OAuth-Documentation)
- [Official Bungie API reference](https://bungie-net.github.io/)
- [DIM Inventory guide](https://github.com/DestinyItemManager/DIM/wiki/Inventory)
- [DIM Wish Lists guide](https://github.com/DestinyItemManager/DIM/wiki/Wish-Lists)
- [Community wishlist source repository](https://github.com/48klocs/dim-wish-list-sources)
