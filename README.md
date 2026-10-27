# Little Light — Destiny Companion

A dark-lavender Destiny 2 inventory companion hosted on GitHub Pages. It is an independent community project inspired by workflows in [Destiny Item Manager](https://destinyitemmanager.com/) and [Shard or Keep](https://shardorkeep.com/); it is not affiliated with Bungie or those projects.

## Live features

- **Bungie connection:** browser-based OAuth for a Public Bungie API application, live profile/character/inventory sync, manifest-based item names/icons/perks and local tagging.
- **Real inventory actions:** preview-confirmed transfers to/from the Vault, equip, lock/unlock and pulling items from the Postmaster.
- **Farming Mode:** watches the selected character's eligible gear buckets while the site stays open and attempts safe transfers to the Vault to maintain 1–9 empty slots per bucket. It does not dismantle items.
- **Bulk actions:** move unequipped character weapons/armor to Vault, prepare a confirmed Shard List dismantling session, stage eligible infusion fuel, and review/apply a maximum-power set.
- **Postmaster:** inspect items returned by Bungie and pull them to the owning Guardian.
- **Shard List & vault review:** manually confirm junk, identify exact DIM wishlist perk matches, review duplicates/high-stat armor and use the queue to stage safe items. The site never dismantles items.
- **Community roll data:** downloads DIM's curated `voltron.txt` wishlist and `choosy_voltron.txt` review list from [48klocs/dim-wish-list-sources](https://github.com/48klocs/dim-wish-list-sources). “No wishlist match” does not mean an item is bad.
- **Setup audit:** a transparent heuristic over the selected Guardian's equipped items and active socket names. It is not a claim of LLM-powered build analysis.
- **Local data:** browser-stored notes, tags, Shard List and loadout snapshots; CSV / JSON import and export.

## Connect your own Bungie account

A public GitHub Pages app cannot safely hold a confidential OAuth client secret. You must register your own Public client in the [Bungie Application Portal](https://www.bungie.net/en/Application) and configure its allowed origin/callback. Little Light never asks for your Bungie password and does not ask you to paste a client secret.

1. Create a **Public** app in the Bungie Application Portal.
2. Select scopes **ReadBasicUserProfile**, **ReadDestinyInventoryAndVault**, and **MoveEquipDestinyItems**. Bungie's portal fixes scopes on the registered app.
3. Set the app **Origin** to `https://lesbunny.github.io`.
4. Set the registered **Redirect URL** to `https://lesbunny.github.io/test/` exactly, including the trailing slash.
5. On the site, click **Connect Bungie**, paste the API Key and Public OAuth Client ID from your app, then choose **Save & sign in to Bungie**.
6. If Bungie rejects the authorization-code exchange, recheck the app's client type, scope and exact callback. Public clients don't receive refresh tokens, so an expired browser session needs a new sign-in.

The API Key and client ID are stored in this browser's local storage; the OAuth access token is kept in session storage. They are not written to this repository. Don't use a Confidential app for a public static site and never commit secrets.

## Destructive-action and data-safety limits

- **Dismantling is always in-game and manual.** The published Destiny API exposes transfer/equip/lock/Postmaster actions but no public dismantle-item endpoint. Shard List is a confirmation and staging queue, not a dismantle button.
- Staging excludes locked items, Exotics, known DIM-wishlist matches / choosy-list flags, loadout/local protection, high-stat armor (65+ total), and weapons marked as tracked when their kill count is 500+ or cannot be verified.
- Community roll data is a safeguard, not a universal god-roll oracle. Its coverage is weapons/perk combinations from curated wishlists. You should inspect each item's actual perks and confirm every shard candidate yourself.
- Bulk moves and max-power equipment require a confirmation dialog. API operations may partially succeed; check the operation report and refresh the site before repeating failed actions.
- Real inventory calls require Bungie to allow the registered site's origin and API scopes. If connection fails, no live action is considered successful.
- Vault capacity is displayed as 1,300 slots in line with Bungie's published inventory update. Treat the count as an estimate and verify in game.
- Farming Mode runs only while the site is open and authorized. It is not a background service and it won't run while the browser is closed.

## Deploy / develop

The Actions workflow deploys `site/` to GitHub Pages on pushes to `main`. JavaScript syntax checks run before upload.

The site uses plain HTML, CSS and JavaScript; no package installation is required. For local development, serve `site/` over HTTP rather than opening `index.html` from a `file://` URL:

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
