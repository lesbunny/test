# Little Light — Destiny Companion

A dark-lavender Destiny 2 inventory companion hosted on GitHub Pages. It is an independent community project inspired by workflows in [Destiny Item Manager](https://destinyitemmanager.com/) and [Shard or Keep](https://shardorkeep.com/); it is not affiliated with Bungie or those projects.

## Live features

- **Bungie connection:** OAuth through the included Cloudflare Worker, live profile/character/inventory sync, manifest-based item names/icons/perks and local tagging. You must deploy the Worker and add your own Bungie credentials as Cloudflare secrets.
- **Real inventory actions:** preview-confirmed transfers to/from the Vault, equip, lock/unlock and pulling items from the Postmaster.
- **Farming Mode:** watches the selected character's eligible gear buckets while the site stays open and attempts safe transfers to the Vault to maintain 1–9 empty slots per bucket. It does not dismantle items.
- **Bulk actions:** move unequipped character weapons/armor to Vault, prepare a confirmed Shard List dismantling session, stage eligible infusion fuel, and review/apply a maximum-power set.
- **Postmaster:** inspect items returned by Bungie and pull them to the owning Guardian.
- **Shard List & vault review:** manually confirm junk, identify exact DIM wishlist perk matches, review duplicates/high-stat armor and use the queue to stage safe items. The site never dismantles items.
- **Community roll data:** downloads DIM's default keeper wishlist (`voltron.txt`) and the extra opinionated trash-roll entries in `choosy_voltron.txt` from [48klocs/dim-wish-list-sources](https://github.com/48klocs/dim-wish-list-sources). Exact matches to the default list are protected as keepers; choosy-only matches are shown as trash candidates but still require you to manually confirm each item. “No wishlist match” does not mean an item is bad.
- **Setup audit:** a transparent heuristic over the selected Guardian's equipped items and active socket names. It is not a claim of LLM-powered build analysis.
- **Local data:** browser-stored notes, tags, Shard List and loadout snapshots; CSV / JSON import and export.

## Connect your own Bungie account

The Pages site is static, and Bungie's authorization-code exchange requires a client secret. The app therefore uses the included **Cloudflare Worker** as a small server-side OAuth/API bridge. The secret and API key stay in your own Cloudflare account; they are not included in the public repo or entered into the Pages UI.

Follow the detailed [Worker deployment guide](worker/README.md):

1. Deploy `worker/` to your own Cloudflare Workers account.
2. Add `BUNGIE_API_KEY`, `BUNGIE_CLIENT_ID`, `BUNGIE_CLIENT_SECRET`, and a random `STATE_SECRET` as **Cloudflare Worker secrets**.
3. Register a Bungie application that supplies a client secret. Enable **ReadBasicUserProfile**, **ReadDestinyInventoryAndVault**, and **MoveEquipDestinyItems**.
4. Set the Bungie application's **Origin** to `https://lesbunny.github.io` and its registered **Redirect URL** to your own Worker URL ending exactly in `/oauth/callback`.
5. On [Little Light](https://lesbunny.github.io/test/), click **Connect Bungie**, enter only the Worker base URL, and choose **Save & sign in to Bungie**.

The Pages app stores the Worker URL in browser local storage and OAuth tokens in session storage. The Worker signs OAuth state, restricts CORS to the Pages origin, and proxies only a short allow-list of required Destiny API routes. Do not commit API keys, client secrets, state secrets, or tokens.

## Destructive-action and data-safety limits

- **Dismantling is always in-game and manual.** The published Destiny API exposes transfer/equip/lock/Postmaster actions but no public dismantle-item endpoint. Shard List is a confirmation and staging queue, not a dismantle button.
- Staging excludes locked items, Exotics, exact matches to DIM's default `voltron.txt` keeper wishlist, loadout/local protection, high-stat armor (65+ total), and weapons marked as tracked when their kill count is 500+ or cannot be verified. Choosy-only wishlist matches are trash candidates, not automatic dismantle decisions; they still need your manual confirmation.
- Community roll data is a safeguard, not a universal god-roll oracle. Its coverage is weapons/perk combinations from curated wishlists. You should inspect each item's actual perks and confirm every shard candidate yourself.
- Bulk moves and max-power equipment require a confirmation dialog. API operations may partially succeed; check the operation report and refresh the site before repeating failed actions.
- Real inventory calls require Bungie to allow the registered site's origin and API scopes. If connection fails, no live action is considered successful.
- Vault capacity is displayed as 1,300 slots in line with Bungie's published inventory update. Treat the count as an estimate and verify in game.
- Farming Mode runs only while the site is open and authorized. It is not a background service and it won't run while the browser is closed.

## Deploy / develop

The Actions workflow deploys `site/` to GitHub Pages on pushes to `main`. JavaScript syntax checks run before upload.

The Pages site uses plain HTML, CSS and JavaScript. The separate `worker/` backend runs on Cloudflare Workers; see its README for `npm install`, `wrangler login`, `wrangler deploy` and secret setup. For local Pages development, serve `site/` over HTTP rather than opening `index.html` from a `file://` URL:

```bash
python -m http.server 8000 --directory site
```

Open `http://localhost:8000/`. Bungie’s registered callback/origin must be updated if you want to test OAuth from a different host.

## Sources

- [Bungie OAuth documentation](https://github.com/Bungie-net/api/wiki/OAuth-Documentation)
- [Bungie Destiny API reference](https://bungie-net.github.io/)
- [Bungie OAuth scopes](https://github.com/Bungie-net/api/wiki/Scopes)
- [DIM wishlists documentation](https://github.com/DestinyItemManager/DIM/wiki/Wish-Lists)
- [DIM wish-list source files](https://github.com/48klocs/dim-wish-list-sources)
- [Bungie Inventory, Vault and Postmaster help](https://help.bungie.net/hc/en-us/articles/360049199931-Destiny-2-Inventory-Management-Postmaster-Vault-and-Character-Inventory)
