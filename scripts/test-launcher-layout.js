"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const macAppExec = path.join(
  root,
  "launcher",
  "mac",
  "SeMa.app",
  "Contents",
  "MacOS",
  "SeMa"
);
const buildSh = path.join(root, "launcher", "mac", "build-sema-app.sh");
const templateStub = path.join(root, "launcher", "mac", "templates", "SeMa");

assert.ok(fs.existsSync(buildSh), "launcher/mac/build-sema-app.sh must exist");
assert.ok(fs.existsSync(templateStub), "launcher/mac/templates/SeMa must exist");
assert.ok(fs.existsSync(macAppExec), "launcher/mac/SeMa.app/.../SeMa must exist");
assert.ok(
  !fs.existsSync(path.join(root, "launcher", "SeMa.app")),
  "old launcher/SeMa.app must be removed"
);

const startSh = path.join(root, "launcher", "mac", "start-sema.sh");
assert.ok(fs.existsSync(startSh), "launcher/mac/start-sema.sh must exist");
assert.ok(
  !fs.existsSync(path.join(root, "launcher", "start-sema.sh")),
  "old launcher/start-sema.sh must be removed"
);

const winVbs = path.join(root, "launcher", "windows", "SeMa.vbs");
assert.ok(fs.existsSync(winVbs), "launcher/windows/SeMa.vbs must exist");
assert.ok(
  !fs.existsSync(path.join(root, "launcher", "SeMa.vbs")),
  "old launcher/SeMa.vbs must be removed"
);
assert.ok(
  fs.existsSync(path.join(root, "launcher", "windows", "build-sema-exe.ps1")),
  "launcher/windows/build-sema-exe.ps1 must exist"
);
assert.ok(
  fs.existsSync(path.join(root, "launcher", "windows", "install-shortcut.ps1")),
  "launcher/windows/install-shortcut.ps1 must exist"
);

if (process.platform !== "win32") {
  const r = spawnSync("bash", [startSh, "--check"], {
    encoding: "utf8",
    env: process.env,
  });
  assert.strictEqual(
    r.status,
    0,
    `start-sema.sh --check failed: ${r.stderr || r.stdout}`
  );
}

if (process.platform === "darwin") {
  const st = fs.statSync(macAppExec);
  assert.ok(st.mode & 0o111, "SeMa.app executable bit must be set");
  const r = spawnSync("bash", [buildSh, "--check"], {
    encoding: "utf8",
    env: process.env,
  });
  assert.strictEqual(
    r.status,
    0,
    `build-sema-app.sh --check failed: ${r.stderr || r.stdout}`
  );
  const stubCheck = spawnSync("bash", [macAppExec, "--check"], {
    encoding: "utf8",
    env: process.env,
  });
  assert.strictEqual(
    stubCheck.status,
    0,
    `SeMa.app --check failed: ${stubCheck.stderr || stubCheck.stdout}`
  );
}

console.log("launcher layout smoke OK");
