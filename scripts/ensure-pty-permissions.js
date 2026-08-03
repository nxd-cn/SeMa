#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  ensurePtySpawnHelperExecutable,
} = require("../pty-permissions");

const result = ensurePtySpawnHelperExecutable(
  path.join(__dirname, "..", "node_modules", "node-pty")
);

if (result.skipped) {
  process.exit(0);
}
if (!result.ok) {
  // Non-fatal: install may still work after a later chmod / rebuild.
  console.warn(
    `[sema] node-pty spawn-helper not ready (${result.reason || "unknown"}): ${result.helper}`
  );
  process.exit(0);
}
if (result.changed) {
  console.log(`[sema] restored execute bit on ${result.helper}`);
}
