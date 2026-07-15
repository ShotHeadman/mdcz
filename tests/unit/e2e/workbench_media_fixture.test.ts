import { access, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertWorkbenchRefreshArtifacts } from "../../e2e/live/workbench-refresh-journey";
import {
  cleanupWorkbenchMediaFixture,
  createWorkbenchMediaFixture,
  createWorkbenchRefreshMediaFixture,
  prepareWorkbenchMediaFixture,
  resolveWorkbenchMediaFixturePaths,
  WORKBENCH_REFRESH_STALE_TITLE,
} from "../../live/workbench-fixture";

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) {
      continue;
    }
    await cleanupWorkbenchMediaFixture({
      mediaRoot: root,
      fixtureDir: path.join(root, "workbench", "web", "scrape-live"),
      fixturePath: path.join(root, "workbench", "web", "scrape-live", "SSIS-497.mp4"),
      outputDir: path.join(root, "workbench", "web", "scrape-live", "JAV_output"),
      fileName: "SSIS-497.mp4",
    });
    await cleanupWorkbenchMediaFixture({
      mediaRoot: root,
      fixtureDir: path.join(root, "workbench", "desktop", "scrape-live"),
      fixturePath: path.join(root, "workbench", "desktop", "scrape-live", "SSIS-497.mp4"),
      outputDir: path.join(root, "workbench", "desktop", "scrape-live", "JAV_output"),
      fileName: "SSIS-497.mp4",
    });
    await cleanupWorkbenchMediaFixture({
      mediaRoot: root,
      fixtureDir: path.join(root, "workbench", "web", "refresh-live"),
      fixturePath: path.join(root, "workbench", "web", "refresh-live", "SSIS-497.mp4"),
      outputDir: path.join(root, "workbench", "web", "refresh-live", "JAV_output"),
      fileName: "SSIS-497.mp4",
    });
  }
});

const createIsolatedRoot = (label: string): string => {
  const root = path.join(
    tmpdir(),
    `mdcz-workbench-fixture-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  tempRoots.push(root);
  return root;
};

describe("workbench media fixture helper", () => {
  it("prepares a zero-byte fixture under the isolated workbench path", async () => {
    const mediaRoot = createIsolatedRoot("size");
    const fixture = createWorkbenchMediaFixture({
      target: "web",
      journey: "scrape-live",
      number: "SSIS-497",
      mediaRoot,
    });

    await fixture.prepare();
    await fixture.assertZeroByte();

    const fileStat = await stat(fixture.fixturePath);
    expect(fileStat.size).toBe(0);
    expect(fixture.fixtureDir).toBe(path.join(mediaRoot, "workbench", "web", "scrape-live"));
    expect(fixture.fileName).toBe("SSIS-497.mp4");
  });

  it("prepares a refresh fixture with zero-byte media and stale NFO title", async () => {
    const mediaRoot = createIsolatedRoot("refresh");
    const fixture = createWorkbenchRefreshMediaFixture({
      target: "web",
      number: "SSIS-497",
      mediaRoot,
    });

    await fixture.prepare();
    await fixture.assertZeroByte();
    await fixture.assertStaleNfo();

    expect(fixture.journey).toBe("refresh-live");
    expect(fixture.fixtureDir).toBe(path.join(mediaRoot, "workbench", "web", "refresh-live"));
    expect(fixture.nfoPath).toBe(path.join(fixture.fixtureDir, "SSIS-497.nfo"));
    expect(fixture.staleTitle).toBe(WORKBENCH_REFRESH_STALE_TITLE);

    const nfoContent = await readFile(fixture.nfoPath, "utf8");
    expect(nfoContent).toBe(fixture.seedNfoContent);
    expect(nfoContent).toContain(`<title>${WORKBENCH_REFRESH_STALE_TITLE}</title>`);
    expect(nfoContent).toContain(`<originaltitle>${WORKBENCH_REFRESH_STALE_TITLE}</originaltitle>`);
    expect(nfoContent).toContain("SSIS-497");
    // Seed must omit production markers so post-apply assertions can prove rewrite.
    expect(nfoContent).not.toContain("<dateadded>");
    expect(nfoContent).not.toContain("<mdcz>");
  });

  it("rejects an untouched refresh seed as applied output", async () => {
    const mediaRoot = createIsolatedRoot("refresh-seed-only");
    const fixture = createWorkbenchRefreshMediaFixture({
      target: "web",
      number: "SSIS-497",
      mediaRoot,
    });

    await fixture.prepare();

    await expect(
      assertWorkbenchRefreshArtifacts({
        fixture,
        number: "SSIS-497",
        seedNfoContent: fixture.seedNfoContent,
      }),
    ).rejects.toThrow("Refresh left seed-only NFO content");
  });

  it("accepts a production rewrite with a remote title and dateadded marker", async () => {
    const mediaRoot = createIsolatedRoot("refresh-applied");
    const fixture = createWorkbenchRefreshMediaFixture({
      target: "web",
      number: "SSIS-497",
      mediaRoot,
    });

    await fixture.prepare();
    await writeFile(
      fixture.nfoPath,
      fixture.seedNfoContent
        .replaceAll(WORKBENCH_REFRESH_STALE_TITLE, "Remote SSIS-497 Title")
        .replace("</movie>", "  <dateadded>2026-07-15T00:00:00.000Z</dateadded>\n</movie>"),
      "utf8",
    );

    await expect(
      assertWorkbenchRefreshArtifacts({
        fixture,
        number: "SSIS-497",
        seedNfoContent: fixture.seedNfoContent,
      }),
    ).resolves.toEqual([fixture.nfoPath]);
  });

  it("keeps web and desktop fixture directories isolated", async () => {
    const mediaRoot = createIsolatedRoot("isolation");
    const web = createWorkbenchMediaFixture({
      target: "web",
      journey: "scrape-live",
      number: "SSIS-497",
      mediaRoot,
    });
    const desktop = createWorkbenchMediaFixture({
      target: "desktop",
      journey: "scrape-live",
      number: "SSIS-497",
      mediaRoot,
    });

    await web.prepare();
    await desktop.prepare();

    expect(web.fixtureDir).not.toBe(desktop.fixtureDir);
    expect(web.fixturePath).not.toBe(desktop.fixturePath);

    await writeFile(web.fixturePath, Buffer.from("pollute-web"));
    await desktop.assertZeroByte();
    await expect(stat(desktop.fixturePath)).resolves.toMatchObject({ size: 0 });
  });

  it("cleans up fixtures idempotently", async () => {
    const mediaRoot = createIsolatedRoot("cleanup");
    const paths = resolveWorkbenchMediaFixturePaths({
      target: "desktop",
      journey: "scrape-live",
      number: "ssis-243",
      mediaRoot,
    });

    await prepareWorkbenchMediaFixture(paths);
    await access(paths.fixturePath);

    await cleanupWorkbenchMediaFixture(paths);
    await expect(access(paths.fixtureDir)).rejects.toMatchObject({ code: "ENOENT" });

    await cleanupWorkbenchMediaFixture(paths);
    await expect(access(paths.fixtureDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
