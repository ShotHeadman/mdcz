import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { PARKED_SOURCE_PREFIX } from "./MoveOutput";
import { recoverInterruptedPublications } from "./recoverInterruptedPublications";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

it("removes staging, restores parked sources, and never overwrites an occupied original name", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mdcz-recover-"));
  directories.push(root);
  const movie = path.join(root, "ABC-123");
  await mkdir(path.join(movie, ".mdcz-staging-dir"), { recursive: true });
  await writeFile(path.join(movie, ".mdcz-staging-dir", "poster.jpg"), "poster");
  await writeFile(path.join(movie, `ABC-123.mp4.mdcz-staging-${randomUUID()}.part`), "partial");
  const parked = path.join(movie, `${PARKED_SOURCE_PREFIX}${randomUUID()}-ABC-123-cd1.mp4`);
  await writeFile(parked, "cd1");
  const blocked = path.join(movie, `${PARKED_SOURCE_PREFIX}${randomUUID()}-ABC-123-cd2.mp4`);
  await writeFile(blocked, "parked cd2");
  await writeFile(path.join(movie, "ABC-123-cd2.mp4"), "current cd2");
  const logger = { warn: vi.fn() };

  await recoverInterruptedPublications([{ hostPath: root }], logger);

  expect(existsSync(path.join(movie, ".mdcz-staging-dir"))).toBe(false);
  expect(existsSync(parked)).toBe(false);
  await expect(readFile(path.join(movie, "ABC-123-cd1.mp4"), "utf8")).resolves.toBe("cd1");
  await expect(readFile(path.join(movie, "ABC-123-cd2.mp4"), "utf8")).resolves.toBe("current cd2");
  await expect(readFile(blocked, "utf8")).resolves.toBe("parked cd2");
  expect(logger.warn).toHaveBeenCalledOnce();
  expect(logger.warn.mock.calls[0]?.[0]).toContain("ABC-123-cd2.mp4");
});
