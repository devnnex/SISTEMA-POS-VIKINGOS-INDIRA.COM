import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("el esquema contiene los módulos críticos y restricciones", async () => {
  const sql = await read("src-tauri/migrations/0001_initial.sql");
  for (const table of ["settings", "users", "products", "categories", "customers", "sales", "sale_items", "payments", "cash_sessions", "cash_movements", "inventory_movements", "expenses", "backup_history"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  const rust = await read("src-tauri/src/lib.rs");
  assert.match(rust, /PRAGMA foreign_keys=ON/);
  assert.match(rust, /PRAGMA journal_mode=WAL/);
  assert.match(sql, /CHECK \(stock_quantity >= 0\)/);
});

test("el instalador es NSIS e incluye WebView2 offline", async () => {
  const config = JSON.parse(await read("src-tauri/tauri.conf.json"));
  assert.deepEqual(config.bundle.targets, ["nsis"]);
  assert.equal(config.bundle.windows.webviewInstallMode.type, "offlineInstaller");
  assert.equal(config.bundle.windows.digestAlgorithm, "sha256");
});

test("la landing resuelve releases sin fijar una versión", async () => {
  const script = await read("app.js");
  assert.match(script, /releases\/latest/);
  assert.match(script, /api\.github\.com/);
  assert.doesNotMatch(script, /releases\/download\/v\d/);
});
