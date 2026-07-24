#!/usr/bin/env node
/**
 * Export the book club's iMessage history to JSON for review + backfill.
 *
 * Requires read access to the Messages database. Either grant the terminal
 * app Full Disk Access (System Settings → Privacy & Security → Full Disk
 * Access) or copy the DB first and point --db at the copy:
 *
 *   cp ~/Library/Messages/chat.db /tmp/chat.db
 *
 * Usage:
 *   node scripts/export-imessage.mjs --list
 *       List group chats (name, participants, message count) to find the club.
 *   node scripts/export-imessage.mjs --chat <chat ROWID> [--since 2026-07-01] [--out messages.json]
 *       Dump that chat's messages as JSON: { date, sender, text }.
 *
 * Options: --db <path> (default ~/Library/Messages/chat.db)
 */
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const dbPath = opt("db", `${homedir()}/Library/Messages/chat.db`);
const db = new DatabaseSync(`file:${dbPath}?mode=ro&immutable=1`, {
  readOnly: true,
});

// Apple stores dates as nanoseconds since 2001-01-01 — too big for JS
// numbers, so read them as BigInt.
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);
const toIso = (appleNs) =>
  new Date(Number(BigInt(appleNs) / 1000000n) + APPLE_EPOCH_MS).toISOString();

/**
 * Newer macOS versions often leave message.text NULL and store the content
 * in the `attributedBody` typedstream blob. This is the standard heuristic:
 * the text follows the "NSString" class marker, length-prefixed.
 */
function textFromAttributedBody(blob) {
  if (blob == null) return null;
  const buf = Buffer.from(blob);
  const marker = buf.indexOf(Buffer.from("NSString"));
  if (marker === -1) return null;
  let i = marker + "NSString".length + 5; // skip class metadata
  let length;
  if (buf[i] === 0x81) {
    length = buf.readUInt16LE(i + 1);
    i += 3;
  } else if (buf[i] === 0x82) {
    length = buf.readUInt32LE(i + 1);
    i += 5;
  } else {
    length = buf[i];
    i += 1;
  }
  return buf.subarray(i, i + length).toString("utf8");
}

if (args.includes("--list")) {
  const chats = db
    .prepare(
      `SELECT c.ROWID as id,
              COALESCE(NULLIF(c.display_name, ''), c.chat_identifier) as name,
              (SELECT COUNT(*) FROM chat_message_join j WHERE j.chat_id = c.ROWID) as messages,
              (SELECT GROUP_CONCAT(h.id, ', ')
                 FROM chat_handle_join ch JOIN handle h ON h.ROWID = ch.handle_id
                WHERE ch.chat_id = c.ROWID) as participants
         FROM chat c
        ORDER BY messages DESC`,
    )
    .all();
  for (const c of chats.filter((c) => c.messages > 0)) {
    console.log(
      `#${c.id}  ${c.name}  (${c.messages} msgs)\n    ${c.participants ?? "?"}`,
    );
  }
  process.exit(0);
}

const chatId = opt("chat");
if (!chatId) {
  console.error("Pass --list to find the chat, then --chat <id> to export.");
  process.exit(1);
}
const since = opt("since", "2001-01-02");
const sinceAppleNs = BigInt(Date.parse(since) - APPLE_EPOCH_MS) * 1000000n;

const stmt = db.prepare(
  `SELECT m.date, m.is_from_me, h.id as sender, m.text, m.attributedBody
     FROM message m
     JOIN chat_message_join j ON j.message_id = m.ROWID
     LEFT JOIN handle h ON h.ROWID = m.handle_id
    WHERE j.chat_id = ? AND m.date >= ?
    ORDER BY m.date ASC`,
);
stmt.setReadBigInts(true);
const rows = stmt.all(Number(chatId), sinceAppleNs);

const messages = rows
  .map((r) => ({
    date: toIso(r.date),
    sender: r.is_from_me ? "me" : (r.sender ?? "unknown"),
    text: r.text ?? textFromAttributedBody(r.attributedBody),
  }))
  .filter((m) => m.text != null && m.text.trim().length > 0);

const out = opt("out");
const json = JSON.stringify(messages, null, 2);
if (out) {
  writeFileSync(out, json);
  console.error(`Wrote ${messages.length} messages to ${out}`);
} else {
  console.log(json);
}
