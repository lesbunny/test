# Little Light — Destiny Companion

A dark-lavender, local-first Destiny inventory companion designed for GitHub Pages. The project is inspired by workflows in [Destiny Item Manager](https://destinyitemmanager.com/) and [Shard or Keep](https://shardorkeep.com/), but is an independent prototype and is not affiliated with either project or Bungie.

## Features in this build

- **Inventory browser:** search by name, perk, tag, owner or bucket; common filters; inspect gear, mark protection tags, add notes, move/equip items in the local workspace.
- **Farming Mode planner:** choose a Guardian, set 1–9 empty spaces per eligible item bucket, and preview which safe-to-move items would be moved to the Vault. Equipped gear, locked/protected gear, non-transferable gear, and items referenced by a saved loadout are excluded. When enabled, imported/local inventory changes are checked again.
- **Loadouts:** snapshot a Guardian's equipped setup; loadout items are protected from local farming/triage operations; apply a saved snapshot to the local workspace.
- **Compare:** compare up to three armor pieces from imported stat values.
- **Vault review:** conservative duplicate-name/perk and low-stat candidate suggestions. No dismantling or destructive actions.
- **Data portability:** import flexible CSV inventory exports or Little Light JSON backups; export workspace JSON, inventory CSV or a Farming Mode plan CSV.
- **Local persistence:** data is stored in `localStorage` in the browser where the site is opened.

## Important limitations

This is a static GitHub Pages app. It does **not** yet have a Bungie OAuth/API integration, live inventory sync, full Destiny manifest/perk database, real item transfer/equip operations, socket/mod/subclass editing, or dismantling. Farming Mode plans and applies moves **only to the local workspace**—it does not touch your actual game account. Sample inventory is clearly labelled and should be replaced with your own export for meaningful results.

## Publish on GitHub Pages

1. Open **Settings → Pages** in this repository.
2. Set **Build and deployment → Source** to **GitHub Actions**.
3. The included workflow deploys the `site/` folder automatically on pushes to `main` and can be run manually from **Actions → Deploy Little Light to GitHub Pages**.
4. Once the first workflow succeeds, open the Pages URL shown in **Settings → Pages**. For this project repository it should be `https://lesbunny.github.io/test/`.

## Local development

The app has no build step or dependency install. Serve the repository's `site/` folder over HTTP, for example:

```bash
python -m http.server 8000 --directory site
```

Then open `http://localhost:8000/`. Browser storage is origin-specific, so localhost data and GitHub Pages data are separate.

## Import guidance

The CSV importer maps common columns such as `Name`, `Bucket`/`Slot`, `Type`, `Owner`/`Character`, `Power`, `Rarity`, `Equipped`, `Locked`, `Tags`, `Notes`, `Perks`, and armor stats. Unknown location columns default to `Vault`. Raw Bungie profile JSON is not treated as a ready-made inventory: turning hashes into actual item names/perks requires resolving Bungie's Destiny manifest, which is not implemented here.