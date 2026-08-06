/**
 * `output: "standalone"` emits a self-contained server under .next/standalone,
 * but Next.js does not copy the static assets or /public into it — and
 * `next start` refuses to run in standalone mode. This puts the pieces together
 * so `npm start` works locally exactly the way the container runs it.
 */
import { cp, access } from "node:fs/promises";
import { constants } from "node:fs";

const copies = [
  { from: ".next/static", to: ".next/standalone/.next/static" },
  { from: "public", to: ".next/standalone/public" },
];

for (const { from, to } of copies) {
  try {
    await access(from, constants.R_OK);
  } catch {
    continue; // nothing to copy (e.g. no public dir)
  }
  await cp(from, to, { recursive: true, force: true });
  console.log(`• ${from} → ${to}`);
}
console.log("standalone build ready — run: npm start");
