#!/usr/bin/env node
/**
 * Guard against pkg.pr.new integrity drift — the failure mode that killed EAS
 * build #3 in the "Install dependencies" phase.
 *
 * Any dependency resolved from a non-registry URL (we install
 * @convex-dev/auth from pkg.pr.new) can be republished in place upstream. When
 * that happens the local `npm ci` still passes from cache, but EAS's clean
 * container re-downloads the tarball, its hash no longer matches the lockfile
 * `integrity`, and install dies with EINTEGRITY.
 *
 * This re-downloads each such tarball and compares its real hash to the
 * lockfile, which is exactly the check the cloud container performs.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

// Registry tarballs are immutable, so only URL deps can drift.
const urlDeps = Object.entries(lock.packages ?? {}).filter(
  ([, v]) =>
    v.resolved?.startsWith("http") &&
    !v.resolved.startsWith("https://registry.npmjs.org/"),
);

if (urlDeps.length === 0) {
  console.log("✔ no non-registry URL dependencies to verify");
  process.exit(0);
}

/**
 * pkg.pr.new rate-limits, and answers with a bare 404 when it does — the same
 * status a pruned build would give. Retry before believing it.
 */
async function fetchTarball(url, attempts = 3) {
  let reason = "unknown";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return { ok: true, res };
      reason = `HTTP ${res.status}`;
    } catch (err) {
      reason = err.message;
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  return { ok: false, reason };
}

let failed = false;
let unreachable = false;

for (const [name, entry] of urlDeps) {
  const short = name.replace(/^node_modules\//, "");
  if (!entry.integrity) {
    console.log(`⚠ ${short}: no integrity in lockfile, skipping`);
    continue;
  }
  const attempt = await fetchTarball(entry.resolved);
  if (!attempt.ok) {
    // Don't fail the build on this: an unreachable URL says nothing about
    // integrity, and a false failure here blocks shipping for no reason. A
    // *persistent* failure does matter, hence the parting note below.
    console.log(
      `⚠ ${short}: could not fetch (${attempt.reason}) — ${entry.resolved}`,
    );
    unreachable = true;
    continue;
  }
  const res = attempt.res;
  const buf = Buffer.from(await res.arrayBuffer());
  const live = `sha512-${createHash("sha512").update(buf).digest("base64")}`;

  if (live === entry.integrity) {
    console.log(`✔ ${short} integrity matches upstream`);
  } else {
    failed = true;
    // pkg.pr.new exposes the commit this tag currently points at.
    const commit = res.headers.get("x-commit-key")?.split(":").pop();
    console.error(
      [
        `✖ ${short}: INTEGRITY DRIFT — upstream republished this URL.`,
        `    resolved:  ${entry.resolved}`,
        `    lockfile:  ${entry.integrity}`,
        `    upstream:  ${live}`,
        `  EAS Build will fail in "Install dependencies" with EINTEGRITY.`,
        commit
          ? `  Fix: pin to the immutable commit URL and reinstall, e.g.\n` +
            `    npm pkg set dependencies.${short}="${entry.resolved.replace(/@[^@/]+$/, "")}@${commit.slice(0, 7)}" && npm install`
          : `  Fix: pin the dependency to an immutable commit URL and reinstall.`,
      ].join("\n"),
    );
  }
}

if (unreachable) {
  console.log(
    [
      "",
      "⚠ At least one URL dependency was unreachable after retries. Usually this",
      "  is pkg.pr.new rate-limiting and safe to ignore. If it persists, the",
      "  build upstream may have been pruned — EAS's clean `npm ci` would then",
      "  fail too, so re-pin to a commit that still resolves.",
    ].join("\n"),
  );
}

process.exit(failed ? 1 : 0);
