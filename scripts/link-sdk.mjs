#!/usr/bin/env node
/**
 * Packs the Paperclip plugin SDK into `.paperclip-sdk/`.
 *
 * `@paperclipai/plugin-sdk` and `@paperclipai/shared` are workspace packages
 * inside the Paperclip repository and are not published to npm. Rather than
 * committing 800 KB of tarballs, this script produces them from a checkout the
 * developer already has.
 *
 * Usage:
 *   pnpm setup:sdk --paperclip /path/to/paperclip
 *   PAPERCLIP_REPO=/path/to/paperclip pnpm setup:sdk
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(pluginRoot, ".paperclip-sdk");

/** Packages to pack, in the order the plugin depends on them. */
const PACKAGES = [
  { name: "@paperclipai/plugin-sdk", path: "packages/plugins/sdk" },
  { name: "@paperclipai/shared", path: "packages/shared" },
];

function resolveRepo() {
  const flagIndex = process.argv.indexOf("--paperclip");
  const fromFlag = flagIndex !== -1 ? process.argv[flagIndex + 1] : undefined;
  const repo = fromFlag ?? process.env.PAPERCLIP_REPO;

  if (!repo) {
    console.error(
      "Missing Paperclip checkout.\n\n" +
        "  pnpm setup:sdk --paperclip /path/to/paperclip\n" +
        "  PAPERCLIP_REPO=/path/to/paperclip pnpm setup:sdk\n",
    );
    process.exit(1);
  }

  const absolute = resolve(repo.replace(/^~/, process.env.HOME ?? "~"));
  if (!existsSync(join(absolute, "pnpm-workspace.yaml"))) {
    console.error(`Not a Paperclip checkout: ${absolute}`);
    process.exit(1);
  }
  return absolute;
}

const repo = resolveRepo();

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const pkg of PACKAGES) {
  const packageDir = join(repo, pkg.path);
  if (!existsSync(packageDir)) {
    console.error(`Package not found: ${packageDir}`);
    process.exit(1);
  }

  console.log(`Packing ${pkg.name} …`);
  // `pnpm pack` writes the tarball into the package directory; move it over so
  // the plugin's package.json can reference a stable relative path.
  execFileSync("pnpm", ["pack", "--pack-destination", outDir], {
    cwd: packageDir,
    stdio: "inherit",
  });
}

const produced = readdirSync(outDir).filter((f) => f.endsWith(".tgz"));

// Normalise names so package.json can pin exact files regardless of the
// version the checkout happens to be on.
for (const file of produced) {
  const normalised = file.replace(/-\d+\.\d+\.\d+.*\.tgz$/, (match) => match);
  if (normalised !== file) renameSync(join(outDir, file), join(outDir, normalised));
}

console.log(`\nWrote ${produced.length} package(s) to .paperclip-sdk/:`);
for (const file of readdirSync(outDir)) console.log(`  ${file}`);
console.log(
  "\nIf the versions differ from the ones pinned in package.json and " +
    "pnpm-workspace.yaml, update those file: references to match.",
);
