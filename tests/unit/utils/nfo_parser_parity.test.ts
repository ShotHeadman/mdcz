import { parseNfoSnapshot as parseDesktopNfo } from "@main/utils/nfo";
import { parseNfoSnapshot as parseRuntimeNfo } from "@mdcz/runtime/maintenance";
import { describe, expect, it } from "vitest";

const movie = (body: string): string => `
  <movie>
    ${body}
  </movie>
`;

const capture = (
  parse: (xml: string) => unknown,
  xml: string,
): { ok: true; value: unknown } | { ok: false; error: string } => {
  try {
    return { ok: true, value: parse(xml) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

describe("desktop/runtime NFO parser accepted-input differences", () => {
  it("1. missing website: desktop rejects, runtime accepts number-only NFO", () => {
    const input = movie("<title>Example</title><num>ABC-123</num>");
    expect(capture(parseDesktopNfo, input)).toEqual({ ok: false, error: "NFO missing website" });
    expect(capture(parseRuntimeNfo, input)).toMatchObject({
      ok: true,
      value: { crawlerData: { number: "ABC-123", title: "Example" } },
    });
  });

  it("2. number fallback: runtime reads <num> when uniqueid is absent", () => {
    const input = movie("<title>Example</title><num>ABC-123</num>");
    expect(capture(parseDesktopNfo, input).ok).toBe(false);
    expect(parseRuntimeNfo(input).crawlerData.number).toBe("ABC-123");
  });

  it("3. provider tag: runtime maps <javdbid>, desktop still requires uniqueid type", () => {
    const input = movie("<title>Example</title><num>JAVDB-123</num><javdbid>source-id</javdbid>");
    expect(capture(parseDesktopNfo, input)).toEqual({ ok: false, error: "NFO missing website" });
    expect(parseRuntimeNfo(input).crawlerData).toMatchObject({ number: "JAVDB-123", website: "javdb" });
  });

  it("4. uniqueid type case: desktop rejects DMM, runtime lowercases and accepts", () => {
    const input = movie('<title>Example</title><uniqueid type="DMM">DMM-123</uniqueid>');
    expect(capture(parseDesktopNfo, input)).toEqual({ ok: false, error: "NFO missing website" });
    expect(parseRuntimeNfo(input).crawlerData).toMatchObject({ number: "DMM-123", website: "dmm" });
  });

  it("5. multiple uniqueid nodes: desktop throws, runtime takes the first typed id", () => {
    const input = movie(
      '<title>Example</title><uniqueid type="dmm">DMM-123</uniqueid><uniqueid type="javdb">JAVDB-123</uniqueid>',
    );
    expect(capture(parseDesktopNfo, input).ok).toBe(false);
    expect(parseRuntimeNfo(input).crawlerData).toMatchObject({ number: "DMM-123", website: "dmm" });
  });

  it("6. error classification and order differ on missing fields and missing root", () => {
    expect(capture(parseDesktopNfo, "<not-movie />")).toEqual({ ok: false, error: "Invalid NFO root" });
    expect(capture(parseRuntimeNfo, "<not-movie />")).toEqual({ ok: false, error: "Invalid NFO movie node" });

    const missingNumber = movie('<title>Example</title><uniqueid type="dmm"></uniqueid>');
    expect(capture(parseDesktopNfo, missingNumber)).toEqual({ ok: false, error: "NFO missing required fields" });
    expect(capture(parseRuntimeNfo, missingNumber)).toEqual({ ok: false, error: "NFO missing number" });

    const missingTitle = movie('<uniqueid type="dmm">DMM-123</uniqueid>');
    expect(capture(parseDesktopNfo, missingTitle)).toEqual({ ok: false, error: "NFO missing required fields" });
    expect(capture(parseRuntimeNfo, missingTitle)).toEqual({ ok: false, error: "NFO missing title" });
  });

  it("agrees on standard uniqueid, actors, thumbs, managed tags, and local state", () => {
    const input = movie(`
      <title>Example</title>
      <uniqueid type="dmm">DMM-123</uniqueid>
      <actor><name>Actor A</name><thumb>actor.jpg</thumb></actor>
      <thumb aspect="poster">poster.jpg</thumb>
      <tag>流出</tag>
      <tag>mdcz:content_type:uncensored</tag>
      <tag>保留</tag>
    `);

    const desktop = parseDesktopNfo(input);
    const runtime = parseRuntimeNfo(input);
    expect(desktop.crawlerData).toMatchObject({
      number: "DMM-123",
      website: "dmm",
      title: "Example",
      actors: ["Actor A"],
      content_type: "uncensored",
    });
    expect(runtime.crawlerData).toMatchObject({
      number: "DMM-123",
      website: "dmm",
      title: "Example",
      actors: ["Actor A"],
      content_type: "uncensored",
    });
    expect(desktop.localState).toEqual({ uncensoredChoice: "leak", tags: ["保留"] });
    expect(runtime.localState).toEqual({ uncensoredChoice: "leak", tags: ["保留"] });
  });
});
