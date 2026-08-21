import { defaultConfiguration } from "@mdcz/shared/config";
import {
  diffSettingsRegistrySchemaPaths,
  FIELD_KEYS,
  FIELD_REGISTRY,
  SETTINGS_FIELD_REGISTRY,
  SETTINGS_SCHEMA_EXEMPTIONS,
} from "@mdcz/shared/settingsRegistry";
import { SETTINGS_FORM_EXCLUDED_FIELDS, SETTINGS_FORM_FIELD_KEYS } from "@mdcz/views/settings";
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

  it("locks the current settings/tool surface split", () => {
    const toolFields = FIELD_REGISTRY.filter((entry) => entry.surface === "tools");
    const hiddenSettings = SETTINGS_FIELD_REGISTRY.filter((entry) => entry.visibility === "hidden");
    const visibleSettings: string[] = SETTINGS_FIELD_REGISTRY.filter((entry) => entry.visibility !== "hidden").map(
      (entry) => entry.key,
    );
    const formKeys: string[] = [...SETTINGS_FORM_FIELD_KEYS];
    const excludedKeys: string[] = SETTINGS_FORM_EXCLUDED_FIELDS.map((entry) => entry.key);

    expect(toolFields.map((entry) => entry.key)).toEqual([
      "personSync.personOverviewSources",
      "personSync.personImageSources",
      "jellyfin.url",
      "jellyfin.apiKey",
      "jellyfin.userId",
      "jellyfin.refreshPersonAfterSync",
      "jellyfin.lockOverviewAfterSync",
      "emby.url",
      "emby.apiKey",
      "emby.userId",
      "emby.refreshPersonAfterSync",
    ]);
    expect(hiddenSettings.map((entry) => entry.key)).toEqual(["scrape.r18MetadataLanguage"]);
    expect(SETTINGS_FORM_EXCLUDED_FIELDS.every((entry) => entry.reason.length > 0)).toBe(true);
    expect(new Set(excludedKeys)).toEqual(
      new Set([...toolFields.map((entry) => entry.key), ...hiddenSettings.map((entry) => entry.key)]),
    );
    expect(new Set(formKeys).size).toBe(formKeys.length);
    expect(
      formKeys.filter((key) => !visibleSettings.includes(key)),
      `Form keys missing from visible settings registry: ${formKeys.filter((key) => !visibleSettings.includes(key)).join(", ")}`,
    ).toEqual([]);
    expect(
      visibleSettings.filter((key) => !formKeys.includes(key)),
      `Visible settings registry keys missing from the form list: ${visibleSettings.filter((key) => !formKeys.includes(key)).join(", ")}`,
    ).toEqual([]);
    expect(formKeys.some((key) => excludedKeys.includes(key))).toBe(false);
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
