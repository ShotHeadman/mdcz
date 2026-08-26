import { BaseRosterOfficialAdapter } from "@mdcz/runtime/actorSource/sources/official/BaseRosterOfficialAdapter";
import type { OfficialLookupRequest, OfficialLookupResult } from "@mdcz/runtime/actorSource/sources/official/types";
import { afterEach, describe, expect, it, vi } from "vitest";

class TestRosterAdapter extends BaseRosterOfficialAdapter<string[]> {
  constructor(loadRoster: () => Promise<string[]>, setDomainLimit: ReturnType<typeof vi.fn>) {
    super(
      {
        networkClient: {
          setDomainLimit,
        },
      } as never,
      {
        key: "test-roster",
        rateLimitedHosts: ["studio.example.com", "images.example.com"],
      },
    );
    this.loadRoster = loadRoster;
  }

  private readonly loadRoster: () => Promise<string[]>;

  matchesHints(): boolean {
    return false;
  }

  async lookup(_query: OfficialLookupRequest): Promise<OfficialLookupResult | null> {
    const roster = await this.loadCachedRoster(this.loadRoster);
    return {
      profile: {
        name: roster[0] ?? "unknown",
      },
      sourceHints: [],
    };
  }
}

describe("BaseRosterOfficialAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies domain limits and reuses the cached roster within the same bucket", async () => {
    const setDomainLimit = vi.fn();
    const loadRoster = vi.fn(async () => ["Actor A"]);
    const adapter = new TestRosterAdapter(loadRoster, setDomainLimit);

    await adapter.lookup({
      queryNames: ["Actor A"],
      fallbackName: "Actor A",
    });
    await adapter.lookup({
      queryNames: ["Actor A"],
      fallbackName: "Actor A",
    });

    expect(setDomainLimit).toHaveBeenNthCalledWith(1, "studio.example.com", 1, 1);
    expect(setDomainLimit).toHaveBeenNthCalledWith(2, "images.example.com", 1, 1);
    expect(loadRoster).toHaveBeenCalledTimes(1);
  });

  it("clears the cached roster after the cache bucket rolls over", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    const setDomainLimit = vi.fn();
    const loadRoster = vi.fn(async () => ["Actor A"]);
    const adapter = new TestRosterAdapter(loadRoster, setDomainLimit);

    nowSpy.mockReturnValue(0);
    await adapter.lookup({
      queryNames: ["Actor A"],
      fallbackName: "Actor A",
    });

    nowSpy.mockReturnValue(31 * 60 * 1000);
    await adapter.lookup({
      queryNames: ["Actor A"],
      fallbackName: "Actor A",
    });

    expect(loadRoster).toHaveBeenCalledTimes(2);
  });
});
