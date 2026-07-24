#!/usr/bin/env bash
# Start The Odyssey once all five members have joined.
#
# Usage: ./scripts/start-odyssey.sh <clubId>
#
# Rotation (round-robin over 25 sections, Book 4 split in half):
#   Peter  → 1, 5, 10, 15, 20
#   Henry  → 2, 6, 11, 16, 21
#   Billy  → 3, 7, 12, 17, 22
#   Ian M  → 4 (first half), 8, 13, 18, 23
#   Ian S  → 4 (second half), 9, 14, 19, 24
set -euo pipefail

CLUB_ID="${1:?usage: $0 <clubId>}"

npx convex run setup:startBookAsAdmin "$(cat <<EOF
{
  "clubId": "$CLUB_ID",
  "title": "The Odyssey",
  "author": "Homer (tr. Emily Wilson)",
  "punishment": "1 mile farmer's carry with 45 pound DBs or plates. Every time you put them down you have to run 0.25 miles (or one lap on a track back to your weights).",
  "suggestedByName": "Peter",
  "rotationNames": ["Peter", "Henry", "Billy", "Ian M", "Ian S"],
  "sectionTitles": [
    "Book 1", "Book 2", "Book 3",
    "Book 4 (first half)", "Book 4 (second half)",
    "Book 5", "Book 6", "Book 7", "Book 8", "Book 9",
    "Book 10", "Book 11", "Book 12", "Book 13", "Book 14",
    "Book 15", "Book 16", "Book 17", "Book 18", "Book 19",
    "Book 20", "Book 21", "Book 22", "Book 23", "Book 24"
  ]
}
EOF
)"
