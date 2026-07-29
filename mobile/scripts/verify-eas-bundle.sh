#!/usr/bin/env bash
# Bundle the app the way EAS Build does — from an isolated copy of ONLY the
# mobile/ directory — and fail if Metro can't resolve something.
#
# This is the check that would have caught EAS build #4. The app imports the
# shared Convex API from *outside* mobile/ (../convex/_generated/api); EAS
# uploads only the project directory, so in the cloud that parent path doesn't
# exist. A plain `npx expo export` here passes regardless, because the real
# convex/ is sitting right next to us. Copying to /tmp removes it.
#
# Usage: npm run verify:eas [-- --keep]
set -euo pipefail

cd "$(dirname "$0")/.."
MOBILE_DIR="$PWD"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

TMP="$(mktemp -d)/proj"
mkdir -p "$TMP"
cleanup() { [[ "$KEEP" == "1" ]] || rm -rf "$(dirname "$TMP")"; }
trap cleanup EXIT

# Mirror what a git-based EAS upload contains: tracked files plus untracked
# ones that aren't gitignored (so uncommitted work-in-progress is tested too).
# Filter to files that still exist — a tracked-but-deleted file would
# otherwise abort the copy.
git ls-files --cached --others --exclude-standard | while IFS= read -r f; do
  [[ -e "$f" ]] && printf '%s\n' "$f"
done >"$TMP/../filelist"

# tar rather than rsync: -T is portable across macOS bsdtar and GNU tar,
# whereas rsync's missing-file flags differ between versions.
tar -cf - -T "$TMP/../filelist" | (cd "$TMP" && tar -xf -)

echo "→ isolated copy at $TMP ($(wc -l <"$TMP/../filelist" | tr -d ' ') files, no parent convex/)"

if [[ -e "$TMP/../convex" ]]; then
  echo "✖ sanity check failed: a parent convex/ leaked into the sandbox" >&2
  exit 1
fi

echo "→ npm ci (clean install, as the build container does)"
npm ci --prefix "$TMP" --silent

echo "→ expo export --platform ios"
if (cd "$TMP" && npx expo export --platform ios >"$TMP/../export.log" 2>&1); then
  grep -E "iOS Bundled|Exported" "$TMP/../export.log" || true
  echo "✔ bundles cleanly in an EAS-equivalent sandbox"
else
  echo "✖ BUNDLE FAILED in the EAS-equivalent sandbox (it may still work locally)" >&2
  echo >&2
  grep -vE "^\s*$" "$TMP/../export.log" | tail -30 >&2
  echo >&2
  echo "If this is an unresolved module from outside mobile/, add a redirect in metro.config.js" >&2
  echo "(see DISTRIBUTION.md → Gotchas that will bite a cloud build)." >&2
  exit 1
fi
