import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { mediaRootSchema, scanTaskSchema } from "@mdcz/shared/serverDtos";
import { describe, expect, it } from "vitest";
import { buildMediaRootDto, buildScanTaskDto } from "../factories/serverDtos";

const readFixture = async (name: string): Promise<unknown> => {
  const path = fileURLToPath(new URL(`../fixtures/contracts/${name}.json`, import.meta.url));
  return JSON.parse(await readFile(path, "utf8"));
};

describe("shared server DTO contracts", () => {
  it("keeps media-root fixtures and factories compatible with the shared schema", async () => {
    const fixture = await readFixture("media-root");

    expect(mediaRootSchema.parse(fixture)).toEqual(fixture);
    expect(mediaRootSchema.parse(buildMediaRootDto({ id: "factory-root" }))).toMatchObject({
      id: "factory-root",
      rootType: "mounted-filesystem",
    });
  });

  it("uses completedAt in scan-task fixtures and typed factories", async () => {
    const fixture = await readFixture("scan-task");
    const parsedFixture = scanTaskSchema.parse(fixture);
    const factoryTask = scanTaskSchema.parse(buildScanTaskDto({ status: "running", completedAt: null }));

    expect(parsedFixture.completedAt).toBe("2026-01-01T00:00:01.000Z");
    expect(parsedFixture).not.toHaveProperty("finishedAt");
    expect(factoryTask).toMatchObject({ status: "running", completedAt: null });
  });
});
