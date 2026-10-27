# DIM integration

Little Light builds the MIT-licensed Destiny Item Manager application from commit
`60581be6c7063e7115a40e5939a791d58d3448f4` (version 8.148.0).
Source: https://github.com/DestinyItemManager/DIM
The original copyright and license are preserved in LICENSE.md and the built engine.

`overlay.patch` contains Little Light's changes: session-only Public OAuth via the
existing connection screen, optional DIM Sync, a Material dark theme, and hash
routing for static hosting. Inventory actions, search, organizers, optimization,
loadouts, vendors, collections and progression use DIM's implementation.

Build with `bash scripts/build-dim.sh`. It checks out the pinned source in
`.cache/dim`, installs its locked pnpm dependencies, applies our patch, and writes
`site/engine`. Generated bundles and the dependency cache are not committed.
The GitHub Pages workflow performs this build before publishing.

Bungie and DIM Sync are separate integrations. No upstream application credentials
are reused. Live features require the user's Public Bungie app. DIM Sync is disabled
unless separately configured with the user's own DIM API key. No upstream analytics
or Sentry reporting is enabled. Advanced write actions remain subject to Bungie's
permissions, just as in upstream DIM.
