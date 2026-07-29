#!/usr/bin/env bash
# Print the real error for a failed EAS build.
#
# Why this exists: the web log viewer requires auth and the raw log artifact is
# an undocumented binary blob (not gzip — don't bother trying to decompress it).
# The structured error is reachable through the GraphQL API using the session
# eas-cli already stored, which is far faster than clicking through the
# dashboard.
#
# Usage: npm run build:why            # most recent failed build
#        npm run build:why -- <id>    # a specific build id
set -euo pipefail

cd "$(dirname "$0")/.."

STATE="$HOME/.expo/state.json"
if [[ ! -f "$STATE" ]]; then
  echo "✖ not logged in to Expo (no $STATE). Run: npx eas-cli login" >&2
  exit 1
fi
TOKEN="$(node -e "process.stdout.write(require('$STATE').auth?.sessionSecret ?? '')")"
if [[ -z "$TOKEN" ]]; then
  echo "✖ no Expo session found. Run: npx eas-cli login" >&2
  exit 1
fi

BUILD_ID="${1:-}"
if [[ -z "$BUILD_ID" ]]; then
  echo "→ finding the most recent failed build…"
  BUILD_ID="$(npx eas-cli build:list --status errored --limit 1 --json --non-interactive 2>/dev/null |
    node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const b=JSON.parse(d);process.stdout.write(b[0]?.id??'')}catch{}})")"
  if [[ -z "$BUILD_ID" ]]; then
    echo "✔ no failed builds found" >&2
    exit 0
  fi
fi

curl -s https://api.expo.dev/graphql \
  -H "expo-session: $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"query\":\"query{builds{byId(buildId:\\\"$BUILD_ID\\\"){id status gitCommitHash error{errorCode message}}}}\"}" |
  node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d);
  if (j.errors) { console.error('✖ API error:', JSON.stringify(j.errors,null,2)); process.exit(1) }
  const b=j.data?.builds?.byId;
  if (!b) { console.error('✖ build not found'); process.exit(1) }
  console.log('build:   ' + b.id);
  console.log('status:  ' + b.status);
  console.log('commit:  ' + (b.gitCommitHash ?? '(none)'));
  console.log('code:    ' + (b.error?.errorCode ?? '(none)'));
  console.log('message: ' + (b.error?.message ?? '(none)'));
  const m = b.error?.message ?? '';
  if (/Install dependencies/i.test(m))
    console.log('\n→ Likely dependency integrity drift. Run: npm run verify:deps');
  if (/Bundle JavaScript/i.test(m))
    console.log('\n→ Likely a module unresolvable outside mobile/. Run: npm run verify:eas');
})
"
