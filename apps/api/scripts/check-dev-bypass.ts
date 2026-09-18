// Build guard: ensure the dev Google bypass can never leak into a
// production bundle. Dynamic imports collapse statically during
// `bun build`, so we grep the dist output (not just the source).
//
// Usage: bun scripts/check-dev-bypass.ts [file...]
// Exits non-zero (fails the build) if "google.dev" appears in the bundle.

const files = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ["dist/index.js"];

const hits: string[] = [];
for (const f of files) {
  const txt = await Bun.file(f).text();
  for (const _m of txt.matchAll(/google\.dev/g)) {
    hits.push(`${f} contains "google.dev" — dev bypass leaked into bundle!`);
  }
}

if (hits.length > 0) {
  console.error("❌ Dev bypass check FAILED:");
  for (const h of hits) console.error(`   ${h}`);
  process.exit(1);
}
console.log("✅ Dev bypass check passed — no google.dev reference in production bundle.");
process.exit(0);