#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const desktopRoot = path.join(workspaceRoot, "apps", "desktop");
const userDataDir = path.resolve(
  workspaceRoot,
  process.env.MDCZ_RECORD_DESKTOP_USER_DATA_DIR?.trim() || ".tmp/recording-desktop-user-data",
);
await mkdir(userDataDir, { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userDataDir}`, desktopRoot],
  cwd: desktopRoot,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  console.log("Use Playwright Inspector to record the Desktop journey, then resume to finalize fixtures.");
  await page.pause();
} finally {
  await app.close();
}
