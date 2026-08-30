#!/usr/bin/env node
/**
 * Assemble Tauri updater latest.json from staged release assets.
 *
 * Usage: node scripts/build-latest-json.mjs releases/<version>
 *
 * Expects env:
 *   VERSION    - semver without v (e.g. 1.2.3)
 *   TAG        - git tag (e.g. v1.2.3)
 *   REPOSITORY - owner/repo
 *   NOTES      - optional release notes for the updater UI (defaults to "SeMa <tag>")
 */
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const version = process.env.VERSION;
const tag = process.env.TAG;
const repository = process.env.REPOSITORY;
const notesEnv = (process.env.NOTES || "").trim();

if (!dir || !version || !tag || !repository) {
  console.error(
    "usage: VERSION=… TAG=… REPOSITORY=owner/repo node scripts/build-latest-json.mjs <assets-dir>",
  );
  process.exit(1);
}

function readSig(filePath) {
  const sigPath = `${filePath}.sig`;
  if (!fs.existsSync(sigPath)) {
    throw new Error(`missing signature: ${sigPath}`);
  }
  return fs.readFileSync(sigPath, "utf8").trim();
}

function assetUrl(fileName) {
  return `https://github.com/${repository}/releases/download/${tag}/${fileName}`;
}

function requireFile(fileName) {
  const full = path.join(dir, fileName);
  if (!fs.existsSync(full)) {
    const listing = fs.existsSync(dir)
      ? fs.readdirSync(dir).join("\n  ")
      : `(missing directory ${dir})`;
    throw new Error(`missing asset: ${full}\nfiles in dir:\n  ${listing}`);
  }
  return full;
}

const platforms = {
  "darwin-aarch64": {
    file: `SeMa_${version}_macOS_aarch64.app.tar.gz`,
  },
  "darwin-x86_64": {
    file: `SeMa_${version}_macOS_x64.app.tar.gz`,
  },
  "windows-x86_64": {
    file: `SeMa_${version}_Windows_x64-setup.exe`,
  },
};

const outPlatforms = {};
for (const [key, { file }] of Object.entries(platforms)) {
  const full = requireFile(file);
  outPlatforms[key] = {
    signature: readSig(full),
    url: assetUrl(file),
  };
}

const latest = {
  version,
  notes: notesEnv || `SeMa ${tag}`,
  pub_date: new Date().toISOString(),
  platforms: outPlatforms,
};

const outPath = path.join(dir, "latest.json");
fs.writeFileSync(outPath, `${JSON.stringify(latest, null, 2)}\n`);
console.log(`wrote ${outPath}`);
console.log(JSON.stringify(latest, null, 2));
