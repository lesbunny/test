#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source_dir="$root/.cache/dim"
revision=60581be6c7063e7115a40e5939a791d58d3448f4
mkdir -p "$root/.cache"
if [ ! -d "$source_dir/.git" ]; then
  git clone --no-checkout https://github.com/DestinyItemManager/DIM.git "$source_dir"
fi
# This directory is a disposable build cache; application edits live in overlay.patch.
git -C "$source_dir" reset --hard "$revision"
git -C "$source_dir" clean -fd -- src
git -C "$source_dir" submodule update --init --depth 1
git -C "$source_dir" apply "$root/integrations/dim/overlay.patch"
(
  cd "$source_dir"
  corepack pnpm install --frozen-lockfile --ignore-scripts
  rm -rf dist
  NODE_OPTIONS=--max-old-space-size=6144 PUBLIC_PATH=./ VERSION=8.148.0-little-light corepack pnpm exec rspack --config ./config/webpack.ts --env=release --node-env=production
)
node --test "$root/tests/engine-auth.cjs"
rm -rf "$root/site/engine"
mkdir -p "$root/site/engine"
cp -a "$source_dir/dist/." "$root/site/engine/"
cp "$root/integrations/dim/LICENSE.md" "$root/site/engine/LICENSE.md"
