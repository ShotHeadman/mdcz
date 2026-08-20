import { parseNfoSnapshot as parseDesktopNfo } from "@main/utils/nfo";
import { parseNfoSnapshot as parseRuntimeNfo } from "@mdcz/runtime/maintenance";
import { describe, expect, it } from "vitest";

const nfo = (identifier: string): string => `
  <movie>
    <title>Example</title>
    ${identifier}
    <actor><name>Actor A</name><thumb>actor.jpg</thumb></actor>
  </movie>
`;

describe("desktop/runtime NFO parser parity boundary", () => {
  it("documents the intentional website requirement difference", () => {
    const input = nfo("<num>ABC-123</num>");

    expect(() => parseDesktopNfo(input)).toThrow("NFO missing website");
    expect(parseRuntimeNfo(input).crawlerData).toMatchObject({
      number: "ABC-123",
      title: "Example",
      actors: ["Actor A"],
    });
  });

  it("keeps MDCX provider identifiers available only in the runtime parser", () => {
    const input = nfo("<num>JAVDB-123</num><javdbid>source-id</javdbid>");

    expect(() => parseDesktopNfo(input)).toThrow("NFO missing website");
    expect(parseRuntimeNfo(input).crawlerData).toMatchObject({
      number: "JAVDB-123",
      website: "javdb",
    });
  });

  it("agrees on standard uniqueid actor data", () => {
    const input = nfo('<uniqueid type="dmm">DMM-123</uniqueid>');

    expect(parseDesktopNfo(input).crawlerData).toMatchObject({ number: "DMM-123", website: "dmm" });
    expect(parseRuntimeNfo(input).crawlerData).toMatchObject({ number: "DMM-123", website: "dmm" });
  });
});
