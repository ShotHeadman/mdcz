import { expect, it } from "vitest";
import { applyLibraryEdit, type LibraryEdit, libraryEditSchema } from "./libraryEdit";
import type { CrawlerData } from "./types";

it("applies one field operation without losing list order or actor profiles", () => {
  const profiles = [
    { name: "ＡＩ", aliases: ["Alias"], height_cm: 170, photo_url: "https://example.com/a.jpg" },
    { name: "Actor B", aliases: ["B"] },
  ];
  const data: CrawlerData = {
    title: "Movie",
    number: "ABC-123",
    studio: "Old studio",
    actors: ["ＡＩ", "Actor B"],
    actor_profiles: profiles,
    genres: ["Drama", "HD"],
    scene_images: [],
  };
  const cases: { edit: LibraryEdit; changes: Partial<CrawlerData> | null }[] = [
    { edit: { field: "studio", operation: "set", value: "New studio" }, changes: { studio: "New studio" } },
    { edit: { field: "studio", operation: "clear" }, changes: { studio: undefined } },
    { edit: { field: "publisher", operation: "clear" }, changes: null },
    { edit: { field: "genres", operation: "add", value: "HD" }, changes: null },
    { edit: { field: "genres", operation: "add", value: "hd" }, changes: { genres: ["Drama", "HD", "hd"] } },
    { edit: { field: "genres", operation: "remove", value: "hd" }, changes: null },
    { edit: { field: "genres", operation: "remove", value: "HD" }, changes: { genres: ["Drama"] } },
    {
      edit: { field: "genres", operation: "rename", from: "HD", to: "High definition" },
      changes: { genres: ["Drama", "High definition"] },
    },
    { edit: { field: "genres", operation: "rename", from: "HD", to: "Drama" }, changes: { genres: ["Drama"] } },
    { edit: { field: "genres", operation: "rename", from: "HD", to: "HD" }, changes: null },
    { edit: { field: "actors", operation: "add", value: "a i" }, changes: null },
    { edit: { field: "actors", operation: "add", value: "C" }, changes: { actors: ["ＡＩ", "Actor B", "C"] } },
    {
      edit: { field: "actors", operation: "remove", value: "AI" },
      changes: { actors: ["Actor B"], actor_profiles: [profiles[1]] },
    },
    {
      edit: { field: "actors", operation: "rename", from: "AI", to: "New name" },
      changes: { actors: ["New name", "Actor B"], actor_profiles: [{ ...profiles[0], name: "New name" }, profiles[1]] },
    },
    {
      edit: { field: "actors", operation: "rename", from: "AI", to: "Actor B" },
      changes: { actors: ["Actor B"], actor_profiles: [profiles[1]] },
    },
    {
      edit: { field: "actors", operation: "rename", from: "AI", to: "ai" },
      changes: { actors: ["ai", "Actor B"], actor_profiles: [{ ...profiles[0], name: "ai" }, profiles[1]] },
    },
    { edit: { field: "actors", operation: "remove", value: "A-I" }, changes: null },
  ];
  for (const { edit, changes } of cases) {
    const original = structuredClone(data);
    expect(applyLibraryEdit(data, edit), JSON.stringify(edit)).toEqual(changes ? { ...data, ...changes } : null);
    expect(data).toEqual(original);
  }
  for (const edit of [
    { field: "title", operation: "set", value: "X" },
    { field: "actors", operation: "set", value: "X" },
    { field: "genres", operation: "rename", from: "HD", to: " " },
  ]) {
    expect(libraryEditSchema.safeParse(edit).success).toBe(false);
  }
});
