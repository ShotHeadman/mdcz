import { parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

const movie = (body: string): string => `
  <movie>
    <title>Example</title>
    ${body}
  </movie>
`;

describe("runtime NFO snapshot identifier admission contract", () => {
  it.each([
    {
      condition: "standard uniqueid[type]",
      body: `<uniqueid type="${Website.DMM}">DMM-001</uniqueid><num>IGNORED-001</num><javdbid>source-id</javdbid>`,
      number: "DMM-001",
      website: Website.DMM,
    },
    {
      condition: "MDCx external identifier",
      body: "<num>ABC-123</num><dmmid>provider-id</dmmid>",
      number: "ABC-123",
      website: Website.DMM,
    },
    {
      condition: "number without a recognized source",
      body: "<num>ABP-123</num>",
      number: "ABP-123",
      website: undefined,
    },
    {
      condition: "untyped uniqueid without a recognized source",
      body: "<uniqueid>UNTYPED-123</uniqueid>",
      number: "UNTYPED-123",
      website: undefined,
    },
  ])("accepts $condition as number=$number, website=$website", ({ body, number, website }) => {
    expect(parseNfoSnapshot(movie(body)).crawlerData).toMatchObject({
      number,
      website,
    });
  });

  it("rejects a snapshot without a reliable number", () => {
    expect(() => parseNfoSnapshot(movie("<javdbid>source-id</javdbid>"))).toThrow("NFO missing number");
  });
});
