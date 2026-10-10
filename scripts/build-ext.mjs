// Builds extension/ into dist-ext/: esbuild bundles each script, and the
// other files are copied. It stops when the manifest version is not the
// package.json version, so AMO signs the version that npm publishes.
//   node scripts/build-ext.mjs        the release build, which AMO signs
//   node scripts/build-ext.mjs --e2e  dist-e2e/: the same, with
//                                     e2e/extension/background.js (the test
//                                     messages) in place of the background,
//                                     and host access to the local test site.
//                                     None of it reaches dist-ext/.
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
if (manifest.version !== pkg.version) {
  console.error(`extension/manifest.json has version ${manifest.version}, but package.json has ${pkg.version}. Make them equal.`);
  process.exit(1);
}

const e2e = process.argv.includes("--e2e");
const out = e2e ? "dist-e2e" : "dist-ext";
rmSync(out, { recursive: true, force: true });
const files = readdirSync("extension");
await build({
  entryPoints: files.filter((f) => f.endsWith(".js")).map((f) => `extension/${f}`),
  outdir: out,
  bundle: true,
  format: "iife",
  target: "firefox153",
  logLevel: "warning",
});
// amo-metadata.json is the AMO listing, not a part of the add-on.
for (const file of files.filter((f) => !f.endsWith(".js") && f !== "amo-metadata.json")) cpSync(`extension/${file}`, `${out}/${file}`, { recursive: true });
if (e2e) {
  await build({ entryPoints: ["e2e/extension/background.js"], outfile: `${out}/background.js`, bundle: true, format: "iife", target: "firefox153", logLevel: "warning", allowOverwrite: true });
  // The E2E test serves demo/site/ on localhost. The release build asks the user for each site instead.
  // "tabs" lets the test find a data: tab that foxpass cannot script (failure modes H10, H13).
  const withHosts = { ...manifest, permissions: [...manifest.permissions, "tabs"], host_permissions: ["http://localhost/*", "http://127.0.0.1/*"] };
  writeFileSync(`${out}/manifest.json`, `${JSON.stringify(withHosts, null, 2)}\n`);
}
console.log(`Built ${out}/ (version ${pkg.version}).`);
