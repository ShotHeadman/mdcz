import { NFO_FIELD_OPTIONS } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { applyLibraryEdit, type LibraryEdit } from "@mdcz/shared/libraryEdit";
import { applyNfoEditorChanges } from "@mdcz/shared/nfoEditor";
import type { CrawlerData, NfoEditorField } from "@mdcz/shared/types";
import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { buildMovieTags } from "../maintenance/movieTags";
import { parseNfoSnapshot } from "../maintenance/nfoSnapshot";
import { NfoGenerator } from "./nfo";

describe("NFO editor merge", () => {
  it("merges only edited fields while preserving each NFO's remaining values and node metadata", () => {
    const existingXml = `<?xml version="1.0"?><movie custom="keep">
      <title>Old</title><originaltitle>Original</originaltitle><num>ABC-123</num>
      <uniqueid type="dmm" default="true">ABC-123</uniqueid><uniqueid type="imdb">007</uniqueid>
      <plot>Old plot</plot><outline>Old outline</outline><director>Excluded Director</director>
      <studio>Old studio</studio><genre>Drama</genre><rating>7.100000</rating>
      <set custom="keep"><name>Series</name><overview>Collection overview</overview></set>
      <actor role="lead"><name>ＡＩ</name><thumb>actor.jpg</thumb><order>7</order></actor>
      <actor role="guest"><name>ジューン・ラブジョイ</name><thumb>guest.jpg</thumb></actor>
      <thumb aspect="poster" custom="keep">poster.jpg</thumb><thumb aspect="poster">poster-2.jpg</thumb>
      <thumb aspect="landscape" custom="keep">thumb.jpg</thumb><thumb aspect="thumb">thumb-2.jpg</thumb>
      <fanart custom="keep"><thumb custom="keep">fanart.jpg</thumb><thumb>fanart-2.jpg</thumb></fanart>
      <fileinfo><streamdetails><video><width>1920</width><durationinseconds>3600</durationinseconds></video><audio><codec>AAC</codec></audio></streamdetails></fileinfo>
      <dateadded>2025-01-01</dateadded><lockedfields>Name|Genres</lockedfields>
      <tag>Custom tag</tag><tag>中文字幕</tag><tag>mdcz:content_type:VR</tag>
      <providerid source="local">007</providerid>
      <mdcz><custom keep="yes">007</custom><original_plot>Original plot</original_plot>
        <source_url site="dmm">https://example.com/movie</source_url>
        <thumb_source_url>https://example.com/thumb.jpg</thumb_source_url>
      </mdcz>
    </movie>`;
    const generator = new NfoGenerator();
    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, ignoreDeclaration: true });
    const original = parser.parse(existingXml).movie;
    const snapshot = parseNfoSnapshot(existingXml);
    const cases: { changes: Partial<CrawlerData>; movieFields: string[]; mdczFields?: string[] }[] = [
      {
        changes: { title: "New", title_zh: undefined },
        movieFields: ["title", "originaltitle"],
        mdczFields: ["raw_title"],
      },
      { changes: { studio: "New studio" }, movieFields: ["studio"] },
      { changes: { publisher: "New publisher" }, movieFields: ["publisher"] },
      { changes: { director: "Still excluded" }, movieFields: [] },
      { changes: { series: "New series" }, movieFields: ["set"] },
      { changes: { series: undefined }, movieFields: ["set"] },
      { changes: { genres: [] }, movieFields: ["genre"] },
      { changes: { number: "NEW-1", website: Website.JAVDB }, movieFields: ["num", "uniqueid"] },
      { changes: { poster_url: "new-poster.jpg" }, movieFields: ["thumb"] },
      { changes: { thumb_url: "new-thumb.jpg" }, movieFields: ["thumb"] },
      { changes: { fanart_url: "new-fanart.jpg" }, movieFields: ["fanart"] },
      { changes: { fanart_url: undefined }, movieFields: ["fanart"] },
      { changes: { durationSeconds: 42 }, movieFields: ["runtime", "fileinfo"] },
      { changes: { durationSeconds: undefined }, movieFields: ["runtime", "fileinfo"] },
      {
        changes: { plot: "New plot", plot_zh: undefined },
        movieFields: ["plot", "outline"],
        mdczFields: ["original_plot"],
      },
      { changes: { release_date: "2026-11-10" }, movieFields: ["premiered", "releasedate", "year"] },
      { changes: { rating: undefined }, movieFields: ["rating"] },
      { changes: { content_type: "New type" }, movieFields: ["tag"] },
      { changes: { thumb_source_url: undefined }, movieFields: [], mdczFields: ["thumb_source_url"] },
      { changes: { scene_images: ["https://example.com/scene.jpg"] }, movieFields: [], mdczFields: ["scene_images"] },
      { changes: { actors: ["AI", "ジューンラブジョイ"] }, movieFields: ["actor"] },
      {
        changes: { actor_profiles: [{ name: "AI", photo_url: "https://example.com/actor.jpg" }] },
        movieFields: ["actor"],
      },
    ];
    for (const { changes, movieFields, mdczFields = [] } of cases) {
      const fields = Object.keys(changes) as NfoEditorField[];
      const edited = applyNfoEditorChanges(snapshot.crawlerData, { ...snapshot.crawlerData, ...changes }, fields);
      const merged = generator.mergeEditableXml(existingXml, edited, fields, {
        buildTags: buildMovieTags,
        localState: snapshot.localState,
        enabledFields: NFO_FIELD_OPTIONS.filter((field) => field !== "director"),
      });
      const movie = parser.parse(merged).movie;
      const { mdcz, ...remaining } = movie;
      const { mdcz: baselineMdcz, ...originalRemaining } = original;
      const originalMdcz = { ...baselineMdcz };
      for (const field of movieFields) {
        delete remaining[field];
        delete originalRemaining[field];
      }
      expect(remaining, fields.join(",")).toEqual(originalRemaining);
      for (const field of [...mdczFields, "published"]) {
        delete mdcz[field];
        delete originalMdcz[field];
      }
      expect(mdcz).toEqual(originalMdcz);
      expect(merged.match(/<\?xml/gu)).toHaveLength(1);
      if (changes.series) expect(movie.set).toEqual({ ...original.set, name: changes.series });
      if (changes.number)
        expect(movie.uniqueid).toEqual([
          { "@_type": Website.JAVDB, "@_default": "true", "#text": "NEW-1" },
          { "@_type": "imdb", "#text": "007" },
        ]);
      if (fields.includes("poster_url"))
        expect(movie.thumb).toEqual([{ ...original.thumb[0], "#text": "new-poster.jpg" }, ...original.thumb.slice(1)]);
      if (fields.includes("thumb_url"))
        expect(movie.thumb[2]).toEqual({ ...original.thumb[2], "#text": "new-thumb.jpg" });
      if (changes.fanart_url)
        expect(movie.fanart).toEqual({
          ...original.fanart,
          thumb: [{ ...original.fanart.thumb[0], "#text": "new-fanart.jpg" }, original.fanart.thumb[1]],
        });
      if (fields.includes("durationSeconds")) {
        expect(parseNfoSnapshot(merged).crawlerData.durationSeconds).toBe(changes.durationSeconds);
        expect(movie.fileinfo.streamdetails.video.width).toBe("1920");
        expect(movie.fileinfo.streamdetails.audio).toEqual({ codec: "AAC" });
      }
      if (fields.includes("actors")) {
        expect(movie.actor[0]).toMatchObject({ name: "AI", thumb: "actor.jpg", "@_role": "lead" });
        expect(movie.actor[1]["@_role"]).toBeUndefined();
        expect(movie.actor[1].thumb).toBeUndefined();
      }
      if (fields.includes("actor_profiles"))
        expect(movie.actor[0]).toMatchObject({
          name: "ＡＩ",
          thumb: "https://example.com/actor.jpg",
          "@_role": "lead",
          order: "7",
        });
      if (fields.includes("content_type"))
        expect(movie.tag).toEqual(["Custom tag", "中文字幕", "mdcz:content_type:New type"]);
      if (fields.includes("thumb_source_url")) expect(parser.parse(merged).movie.mdcz.thumb_source_url).toBeUndefined();
    }
    const batchEdits: LibraryEdit[] = [
      { field: "studio", operation: "set", value: "Batch studio" },
      { field: "studio", operation: "clear" },
      { field: "genres", operation: "add", value: "HD" },
      { field: "genres", operation: "remove", value: "Drama" },
      { field: "genres", operation: "rename", from: "Drama", to: "HD" },
      { field: "actors", operation: "add", value: "New actor" },
      { field: "actors", operation: "remove", value: "AI" },
      { field: "actors", operation: "rename", from: "AI", to: "Renamed" },
      { field: "actors", operation: "rename", from: "AI", to: "ジューン・ラブジョイ" },
    ];
    for (const edit of batchEdits) {
      const data = applyLibraryEdit(snapshot.crawlerData, edit);
      if (!data) throw new Error("Expected a changed movie");
      const merged = generator.mergeEditableXml(
        existingXml,
        data,
        [edit.field],
        { localState: snapshot.localState },
        edit,
      );
      const movie = parser.parse(merged).movie;
      expect(parseNfoSnapshot(merged).crawlerData[edit.field]).toEqual(data[edit.field] ?? undefined);
      const editedElement = { actors: "actor", genres: "genre", studio: "studio" }[
        edit.field as "actors" | "genres" | "studio"
      ];
      const remainder = { ...movie };
      const baseline = { ...original };
      for (const field of [editedElement, "mdcz"]) {
        delete remainder[field];
        delete baseline[field];
      }
      expect(remainder).toEqual(baseline);
      if (edit.field !== "actors") continue;
      const actors = Array.isArray(movie.actor) ? movie.actor : [movie.actor];
      if (edit.operation === "rename" && edit.to === "Renamed")
        expect(actors[0]).toEqual({ ...original.actor[0], name: "Renamed" });
      if (edit.operation === "rename" && edit.to === "ジューン・ラブジョイ")
        expect(actors).toEqual([original.actor[1]]);
      if (edit.operation === "add") expect(actors.slice(0, 2)).toEqual(original.actor);
      if (edit.operation === "remove") expect(actors).toEqual([original.actor[1]]);
    }
    expect(generator.mergeEditableXml(existingXml, snapshot.crawlerData, [])).toBe(existingXml);
    expect(() => generator.mergeEditableXml("<movie><title>Broken</movie>", snapshot.crawlerData, ["studio"])).toThrow(
      "Invalid NFO XML",
    );
  });
});
