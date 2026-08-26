import { defaultConfiguration } from "@mdcz/shared/config";
import { diffSettingsRegistrySchemaPaths, FIELD_KEYS, SETTINGS_SCHEMA_EXEMPTIONS } from "@mdcz/shared/settingsRegistry";
import { describe, expect, it } from "vitest";

const collectStaticLeafPaths = (value: unknown, prefix = ""): string[] => {
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    return prefix ? [prefix] : [];
  }

  if (Object.keys(value).length === 0) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    collectStaticLeafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
};

describe("settings registry and configuration schema", () => {
  it("covers static configuration leaves in both directions", () => {
    const schemaLeaves = collectStaticLeafPaths(defaultConfiguration);
    const diff = diffSettingsRegistrySchemaPaths(schemaLeaves, FIELD_KEYS);

    expect(
      diff.registryOnly,
      `Registry keys missing from configurationSchema: ${diff.registryOnly.join(", ")}`,
    ).toEqual([]);
    expect(diff.schemaOnly, `Configuration leaves missing from FIELD_REGISTRY: ${diff.schemaOnly.join(", ")}`).toEqual(
      [],
    );
    expect(diff.staleExemptions, `Stale settings exemptions: ${diff.staleExemptions.join(", ")}`).toEqual([]);
    expect(SETTINGS_SCHEMA_EXEMPTIONS.every((entry) => entry.reason.length > 0)).toBe(true);
    expect(SETTINGS_SCHEMA_EXEMPTIONS).toContainEqual(
      expect.objectContaining({ path: "personSync.actorAliases", kind: "dynamic-record" }),
    );
  });
  it("reports each drift category by exact key", () => {
    const diff = diffSettingsRegistrySchemaPaths(
      ["known.schema", "missing.registry", "internal.value"],
      ["known.schema", "missing.schema"],
      [
        { path: "internal.value", kind: "internal", reason: "Not user configurable." },
        { path: "removed.value", kind: "internal", reason: "Synthetic stale exemption." },
      ],
    );

    expect(diff).toEqual({
      registryOnly: ["missing.schema"],
      schemaOnly: ["missing.registry"],
      staleExemptions: ["removed.value"],
    });
  });
});
