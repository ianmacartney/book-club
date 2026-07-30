#!/usr/bin/env python3
"""Import the club's chat-archive history into Convex.

Run AFTER all five members have signed up and joined the club (labeled
invites set their display names: Peter, Henry, Billy, Ian S — plus you,
Ian M).

Usage: python3 scripts/import-history.py <clubId> [--dry-run]

Reads:
  .context/books-era{1..4}.json  — reconstructed past books (from chat)
  tmp/checkins.json              — parsed daily star/storm reports

Everything is idempotent: books dedupe on (title, startedDay), check-ins
are insert-if-absent, the ghost user on username.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLUB_ID = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
DRY = "--dry-run" in sys.argv

# Chat nicknames → display names used in the app.
ALIASES = {
    "pete": "Peter", "petey": "Peter", "peter": "Peter",
    "henry": "Henry", "schoon": "Henry", "schoony": "Henry",
    "billy": "Billy", "bill": "Billy",
    "ian m": "Ian M", "ian": "Ian M", "ian macartney": "Ian M",
    "ian s": "Ian S", "ian sugg": "Ian S", "sugg": "Ian S",
    "tucker": "Tucker", "tuck": "Tucker",
}

def canon(name: str) -> str:
    return ALIASES.get(name.strip().lower(), name.strip())

def run(fn: str, args: dict):
    if DRY:
        print(f"  [dry-run] {fn} {json.dumps(args)[:120]}…")
        return None
    out = subprocess.run(
        ["npx", "convex", "run", fn, json.dumps(args)],
        cwd=ROOT, capture_output=True, text=True,
    )
    if out.returncode != 0:
        print(f"FAILED {fn}: {out.stderr.strip()[-500:]}", file=sys.stderr)
        sys.exit(1)
    return out.stdout.strip()

# 1. Ghost user for Tucker (early member, not coming back).
print("Creating ghost user Tucker…")
run("setup:createGhostUser", {
    "username": "Tucker",
    "name": "Tucker",
    "timezone": "America/New_York",
})

# 2. Past books (merged + deduplicated across eras), chronological.
books = json.loads((ROOT / ".context" / "books-merged.json").read_text())
books.sort(key=lambda b: b["startedDay"])
print(f"Importing {len(books)} past books…")
for b in books:
    args = {
        "clubId": CLUB_ID,
        "title": b["title"],
        "startedDay": b["startedDay"],
        "endedDay": b["endedDay"],
        "rotationNames": [canon(n) for n in b["rotationNames"]],
        "sections": [
            {
                "title": s["title"],
                "byName": canon(s["byName"]),
                "day": s["day"],
                "quotes": s.get("quotes") or "",
                "thoughts": s.get("thoughts") or "",
            }
            for s in b.get("sections", [])
        ],
    }
    if b.get("author"):
        args["author"] = b["author"]
    if b.get("punishment"):
        args["punishment"] = b["punishment"]
    if b.get("suggestedByName"):
        args["suggestedByName"] = canon(b["suggestedByName"])
    if b.get("resultTallies"):
        args["resultTallies"] = [
            {"name": canon(t["name"]), "clouds": t["clouds"]}
            for t in b["resultTallies"]
        ]
    if b.get("loserNames"):
        args["loserNames"] = [canon(n) for n in b["loserNames"]]
    if b.get("abandoned"):
        args["abandoned"] = True
    res = run("setup:importPastBook", args)
    label = f"{b['startedDay']}  {b['title']}"
    print(f"  {'SKIP (exists)' if res == 'null' else 'ok  '}  {label}")

# 3. Daily check-ins, batched.
checkins = json.loads((ROOT / "tmp" / "checkins.json").read_text())
for c in checkins:
    c["userName"] = canon(c["userName"])
print(f"Importing {len(checkins)} check-ins…")
BATCH = 400
total_in = total_skip = 0
for i in range(0, len(checkins), BATCH):
    res = run("setup:importCheckins", {
        "clubId": CLUB_ID,
        "checkins": checkins[i : i + BATCH],
    })
    if res:
        stats = json.loads(res)
        total_in += stats["inserted"]
        total_skip += stats["skipped"]
    print(f"  batch {i // BATCH + 1}: {min(i + BATCH, len(checkins))}/{len(checkins)}")
print(f"Check-ins: {total_in} inserted, {total_skip} already present.")
print("Done.")
