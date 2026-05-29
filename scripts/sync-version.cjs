#!/usr/bin/env node
// Sync version from Cargo.toml → package.json, tauri.conf.json, README.md
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

const cargo = fs.readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf-8");
const m = cargo.match(/^version\s*=\s*"([^"]+)"/m);
if (!m) { console.error("Cannot find version in Cargo.toml"); process.exit(1); }
const version = m[1];
console.log(`Source version (Cargo.toml): ${version}`);

// package.json
const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`  package.json → ${version}`);

// tauri.conf.json
const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");
console.log(`  tauri.conf.json → ${version}`);

// README.md badge
const readmePath = path.join(root, "README.md");
let readme = fs.readFileSync(readmePath, "utf-8");
readme = readme.replace(/version-[0-9.]*-blue/, `version-${version}-blue`);
fs.writeFileSync(readmePath, readme);
console.log(`  README.md badge → ${version}`);

console.log("Done.");
