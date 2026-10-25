import { configurationSchema } from "@mdcz/shared/config";
import { diffSettingsRegistrySchemaPaths, FIELD_KEYS, SETTINGS_SCHEMA_EXEMPTIONS } from "@mdcz/shared/settingsRegistry";
import { describe, expect, it } from "vitest";

const collectJsonSchemaLeafPaths = (schema: unknown, prefix = ""): string[] => {
  if (schema && typeof schema === "object" && "properties" in schema) {
    const properties = (schema as { properties?: Record<string, unknown> }).properties;
    if (!properties) throw new Error(`Object schema has no properties at ${prefix || "root"}`);
    return Object.entries(properties).flatMap(([key, child]) =>
      collectJsonSchemaLeafPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return prefix ? [prefix] : [];
};

describe("settings registry and configuration schema", () => {
  it("covers static configuration leaves in both directions", () => {
    const schemaLeaves = collectJsonSchemaLeafPaths(configurationSchema.toJSONSchema({ unrepresentable: "any" }));
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
      expect.objectContaining({ path: "scrape.numberMappings", kind: "dynamic-record" }),
    );
    expect(schemaLeaves).toContain("translate.llmTemperature");
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
