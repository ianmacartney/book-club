#!/usr/bin/env bash
# Tag what we just shipped, so "which commit is the club actually running?" is
# answerable from git instead of from memory.
#
#   tag-release.sh --check          verify the tree is clean (run BEFORE shipping)
#   tag-release.sh <kind> [note]    tag HEAD and push the tag (run AFTER shipping)
#
# Kinds in use: mobile-ota, mobile-build, web-dev, web-prod.
#
# Why --check runs first: `eas update` and `vite build` bundle the WORKING TREE,
# so shipping with uncommitted changes publishes code that exists nowhere in git
# — and any tag we then write would point at a commit that isn't what shipped.
# Cheaper to refuse up front than to discover it later.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

require_clean_tree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    cat >&2 <<'MSG'
✖ Working tree is dirty. Commit (or stash) before shipping — what gets bundled
  is the working tree, so a release tag would not match what you shipped.
MSG
    git status --short >&2
    echo >&2
    echo "  To ship anyway without a tag: ALLOW_DIRTY=1 <command>" >&2
    exit 1
  fi
}

if [[ "${1:-}" == "--check" ]]; then
  [[ "${ALLOW_DIRTY:-}" == "1" ]] && {
    echo "⚠ ALLOW_DIRTY=1 — shipping a dirty tree, no tag will be written"
    exit 0
  }
  require_clean_tree
  exit 0
fi

KIND="${1:?usage: tag-release.sh <kind> [note]  |  tag-release.sh --check}"
NOTE="${2:-}"

if [[ "${ALLOW_DIRTY:-}" == "1" ]]; then
  echo "⚠ ALLOW_DIRTY=1 — skipping the release tag"
  exit 0
fi
require_clean_tree

TAG="$KIND/$(date +%Y%m%d-%H%M%S)"
SUBJECT="$(git log -1 --pretty=%s)"

# Mobile releases are pinned to expo.version, which is what runtimeVersion
# (appVersion policy) gates OTA delivery on — worth recording in the tag.
VERSION_LINE=""
if [[ "$KIND" == mobile-* && -f mobile/app.json ]]; then
  VERSION_LINE="app version: $(node -p "require('./mobile/app.json').expo.version")"
fi

git tag -a "$TAG" -m "$KIND

commit:  $(git rev-parse --short HEAD) $SUBJECT
${VERSION_LINE}
${NOTE:+note:    $NOTE}"

git push -q origin "$TAG"
echo "✔ tagged $TAG and pushed"
