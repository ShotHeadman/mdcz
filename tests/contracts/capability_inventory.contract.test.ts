import { SHARED_CAPABILITIES } from "@mdcz/shared/capabilities";
import {
  CAPABILITY_OVERLAP_PAIRS,
  type CapabilityInventoryDesktopExhaustive,
  type CapabilityInventoryServerExhaustive,
  DESKTOP_ONLY_CHANNELS,
  SERVER_ONLY_PROCEDURES,
} from "@mdcz/shared/capabilityInventory";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import { describe, expect, it } from "vitest";

const _desktopExhaustive: CapabilityInventoryDesktopExhaustive = true;
const _serverExhaustive: CapabilityInventoryServerExhaustive = true;

const uniqueSorted = (values: string[]): string[] => [...values].sort((left, right) => left.localeCompare(right));

const duplicates = (values: string[]): string[] =>
  uniqueSorted(values).filter((value, index, sorted) => value === sorted[index - 1]);

describe("dual-host capability inventory", () => {
  it("classifies every desktop channel exactly once", () => {
    void _desktopExhaustive;
    const classified = [
      ...CAPABILITY_OVERLAP_PAIRS.map((pair) => pair.desktop),
      ...DESKTOP_ONLY_CHANNELS.map((entry) => entry.channel),
    ];
    expect(duplicates(classified)).toEqual([]);
    expect(uniqueSorted(classified)).toEqual(uniqueSorted(Object.values(IpcChannel)));
  });

  it("classifies every server procedure exactly once", () => {
    void _serverExhaustive;
    const classified = [
      ...CAPABILITY_OVERLAP_PAIRS.map((pair) => pair.server),
      ...SERVER_ONLY_PROCEDURES.map((entry) => entry.path),
    ];
    expect(duplicates(classified)).toEqual([]);
  });

  it("keeps manifest rows inside the overlap inventory", () => {
    const overlapById = Object.fromEntries(CAPABILITY_OVERLAP_PAIRS.map((pair) => [pair.id, pair]));

    expect(DESKTOP_ONLY_CHANNELS.every((entry) => entry.reason.length > 0)).toBe(true);
    expect(SERVER_ONLY_PROCEDURES.every((entry) => entry.reason.length > 0)).toBe(true);

    for (const capability of SHARED_CAPABILITIES) {
      const pair = overlapById[capability.id];
      expect(pair).toBeDefined();
      expect(pair?.desktop).toBe(capability.desktop);
      expect(pair?.server).toBe(capability.server);
    }
  });
});
