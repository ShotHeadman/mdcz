import { parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

describe("maintenance NFO snapshot identifiers", () => {
  it("maps a verified MDCx provider identifier", () => {
    const parsed = parseNfoSnapshot(`
      <movie>
        <title>External NFO</title>
        <num>ABC-123</num>
        <dmmid>provider-id</dmmid>
      </movie>
    `);

    expect(parsed.crawlerData).toMatchObject({
      number: "ABC-123",
      title: "External NFO",
      website: Website.DMM,
    });
  });

  it("keeps source-unknown NFO data usable without trusting website text", () => {
    const parsed = parseNfoSnapshot(`
      <movie>
        <title>External Title</title>
        <num>ABP-123</num>
        <thumb aspect="poster">poster.jpg</thumb>
        <trailer>https://example.com/trailer.mp4</trailer>
        <trailer_source_url>https://example.com/source.mp4</trailer_source_url>
        <website>https://javdb.com/v/example</website>
      </movie>
    `);

    expect(parsed.crawlerData).toMatchObject({
      title: "External Title",
      number: "ABP-123",
      poster_url: "poster.jpg",
      trailer_url: "https://example.com/trailer.mp4",
      trailer_source_url: "https://example.com/source.mp4",
      website: undefined,
    });
  });

  it("prefers a standard uniqueid over external fallback fields", () => {
    const parsed = parseNfoSnapshot(`
      <movie>
        <title>Standard Title</title>
        <uniqueid type="${Website.DMM}">DMM-001</uniqueid>
        <num>SHOULD-NOT-WIN</num>
        <javdbid>external-id</javdbid>
      </movie>
    `);

    expect(parsed.crawlerData).toMatchObject({ number: "DMM-001", website: Website.DMM });
  });

  it("rejects NFO files without a reliable number", () => {
    expect(() =>
      parseNfoSnapshot(`
        <movie>
          <title>No Number</title>
          <javdbid>source-id</javdbid>
        </movie>
      `),
    ).toThrow("NFO missing number");
  });
});
