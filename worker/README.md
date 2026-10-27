# Little Light Bungie Worker

This Worker is the private side of the GitHub Pages app. It exchanges Bungie OAuth codes using a server-side client secret, refreshes tokens, and proxies a narrow allow-list of Destiny API routes. **Do not move the Bungie client secret into `site/` or commit it to GitHub.**

## 1. Deploy to your own Cloudflare account

From an Arch terminal, install Node.js/npm if needed, then run:

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

Wrangler prints the deployed Worker URL, generally `https://little-light-bungie.<your-account>.workers.dev`. Keep that URL handy. This repository deploys only the static `site/` directory to GitHub Pages; the Worker is a separate service in your own account.

## 2. Add the four secrets

Run each command and paste the value when Wrangler prompts you. The values are stored as Cloudflare Worker secrets, not in this repo.

```bash
npx wrangler secret put BUNGIE_API_KEY
npx wrangler secret put BUNGIE_CLIENT_ID
npx wrangler secret put BUNGIE_CLIENT_SECRET
npx wrangler secret put STATE_SECRET
```

- `BUNGIE_API_KEY`: the API key in your Bungie developer application.
- `BUNGIE_CLIENT_ID`: the numeric OAuth client ID from that application.
- `BUNGIE_CLIENT_SECRET`: the OAuth client secret from that application.
- `STATE_SECRET`: a random string of at least 32 characters used to sign OAuth state. Generate one with `openssl rand -hex 32`; paste the output when Wrangler prompts. Do not commit it.

The Worker is configured by `wrangler.toml` for the public site origin and the exact return URL. If you use a fork or a different Pages URL, change `ALLOWED_ORIGIN` and `SITE_URL` there and redeploy.

## 3. Configure the Bungie application

Open the [Bungie Application Portal](https://www.bungie.net/en/Application) and register an application that provides an OAuth client secret (the client secret must remain server-side). Enable these scopes:

- `ReadBasicUserProfile`
- `ReadDestinyInventoryAndVault`
- `MoveEquipDestinyItems`

Set **Origin** to:

```text
https://lesbunny.github.io
```

Set the registered **Redirect URL** to your actual Worker callback, exactly:

```text
https://YOUR-WORKER-HOST.workers.dev/oauth/callback
```

Replace `YOUR-WORKER-HOST` with the URL Wrangler gave you. Use HTTPS and preserve `/oauth/callback`. The registered redirect must match the Worker you deployed.

## 4. Connect from Little Light

1. Open [Little Light](https://lesbunny.github.io/test/).
2. Click **Connect Bungie**.
3. Paste only your Worker base URL (for example, `https://little-light-bungie.your-account.workers.dev`)—no path and no trailing `/oauth/callback`.
4. Click **Save & sign in to Bungie**, select your platform membership if prompted, and let the site load the inventory.

The setup modal checks `/health` first and warns if required secrets are missing. Your access/refresh tokens remain in this browser session storage. The Worker has the client secret and API key; the browser does not.

## Security / scope

The Worker CORS allow-list is limited to `https://lesbunny.github.io`, and the `/api/` proxy allows only profile/inventory reads plus TransferItem, PullFromPostmaster, EquipItem and SetLockState. It does not expose arbitrary Bungie proxy paths. OAuth state is HMAC-signed and expires after 10 minutes.

The API can move/equip/lock items and pull Postmaster gear. It does not expose an item-dismantle endpoint, so Little Light never dismantles items. You still confirm the Shard List yourself and dismantle in-game.

If you later change the Worker URL, update the Bungie application's Redirect URL, then change the Worker URL in Little Light's Connect dialog.
