import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDirectory } from "../../../tests/harness/tempDirectory";

import { defaultWebStaticDir } from "./http/staticWeb";

describe("defaultWebStaticDir", () => {
  const originalCwd = process.cwd();
  const originalWebDistDir = process.env.MDCZ_WEB_DIST_DIR;

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalWebDistDir === undefined) {
      delete process.env.MDCZ_WEB_DIST_DIR;
    } else {
      process.env.MDCZ_WEB_DIST_DIR = originalWebDistDir;
    }
  });

  it("prefers the explicit MDCZ_WEB_DIST_DIR", () => {
    process.env.MDCZ_WEB_DIST_DIR = "custom-web";

    expect(defaultWebStaticDir()).toBe(resolve(originalCwd, "custom-web"));
  });

  it("finds the server WebUI dist when started from the repository root", async () => {
    const directory = await createTempDirectory("default-web");
    const webRoot = join(directory.path, "apps/server/dist/web");

    try {
      delete process.env.MDCZ_WEB_DIST_DIR;
      await mkdir(webRoot, { recursive: true });
      await writeFile(join(webRoot, "index.html"), "<!doctype html>", "utf8");
      process.chdir(directory.path);

      expect(defaultWebStaticDir()).toBe(webRoot);
    } finally {
      process.chdir(originalCwd);
      await directory.cleanup();
    }
  });
});
