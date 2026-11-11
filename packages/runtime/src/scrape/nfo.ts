import { mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { atomicWriteFile } from "@mdcz/media-store";
import { normalizeActorName } from "@mdcz/shared/actorAliases";
import type { NfoNamingMode } from "@mdcz/shared/assetNaming";
import { type Configuration, NFO_FIELD_OPTIONS, type NfoField } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { LibraryEdit } from "@mdcz/shared/libraryEdit";
import type {
  CrawlerData,
  DownloadedAssets,
  FileInfo,
  NfoEditableField,
  NfoEditorField,
  NfoLocalState,
  VideoMeta,
} from "@mdcz/shared/types";
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import type { SourceMap } from "./aggregation";
import {
  fingerprintNfo,
  fingerprintNfoField,
  formatFingerprints,
  parseFingerprints,
  publishedFingerprints,
} from "./nfoEdits";
import { renderTextTemplate } from "./utils/path";
import { buildMetadataTemplateData, type MetadataNaming } from "./utils/templateData";

const builder = new XMLBuilder({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  format: true,
  commentPropName: "#comment",
  suppressBooleanAttributes: false,
});
const parser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  commentPropName: "#comment",
  parseTagValue: false,
  // A merged NFO is rebuilt under its own declaration; keeping the parsed one would put a second one after it.
  ignoreDeclaration: true,
});

/**
 * Every `<movie>` child `buildXml` can write. The rest of an NFO belongs to the media server or another tool, and a
 * rewrite carries it over the way Jellyfin's own saver does.
 */
export const MDCZ_NFO_ELEMENTS: ReadonlySet<string> = new Set([
  "title",
  "originaltitle",
  "plot",
  "outline",
  "premiered",
  "releasedate",
  "dateadded",
  "lockedfields",
  "year",
  "runtime",
  "rating",
  "studio",
  "director",
  "publisher",
  "mpaa",
  "set",
  "trailer",
  "num",
  "uniqueid",
  "genre",
  "tag",
  "actor",
  "thumb",
  "fanart",
  "mdcz",
  "fileinfo",
]);

const OUTLINE_MAX_CHARS = 200;
const JELLYFIN_MOVIE_NFO_NAME = "movie.nfo";

type NfoFileWriter = (path: string, content: string) => Promise<void>;
type PathExists = (path: string) => Promise<boolean>;

export interface NfoOptions {
  assets?: DownloadedAssets;
  sources?: SourceMap;
  videoMeta?: VideoMeta;
  fileInfo?: FileInfo;
  localState?: NfoLocalState;
  nfoNaming?: NfoNamingMode;
  titleNaming?: MetadataNaming & Pick<Configuration["naming"], "nfoTitleTemplate">;
  enabledFields?: readonly NfoField[];
  includeRemoteSceneImageUrls?: boolean;
  allowRemoteTrailerFallback?: boolean;
  buildTags?: (data: CrawlerData, fileInfo: FileInfo | undefined, localState: NfoLocalState | undefined) => string[];
  pathExists?: PathExists;
  writeFile?: NfoFileWriter;
}

const toArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const profileMap = (
  profiles: CrawlerData["actor_profiles"] | undefined,
): Map<string, NonNullable<CrawlerData["actor_profiles"]>[number]> => {
  const map = new Map<string, NonNullable<CrawlerData["actor_profiles"]>[number]>();
  for (const profile of profiles ?? []) {
    const key = normalizeActorName(profile.name);
    if (key) {
      map.set(key, profile);
    }
  }
  return map;
};

const buildActorNodes = (actors: string[], profiles: CrawlerData["actor_profiles"] | undefined) => {
  const profileByName = profileMap(profiles);
  return actors
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name, index) => {
      const profile = profileByName.get(normalizeActorName(name));
      return {
        name,
        type: "Actor",
        // Jellyfin ignores a relative actor thumb and Emby stores it as a broken primary image, which also makes
        // "missing" photo sync skip the actor; only URLs the server can fetch itself belong here.
        thumb: profile?.photo_url && /^https?:\/\//iu.test(profile.photo_url) ? profile.photo_url : undefined,
        order: index,
        sortorder: index,
      };
    });
};

const parseReleaseYear = (releaseDate: string | undefined): number | undefined => {
  if (!releaseDate) return undefined;
  const matched = releaseDate.match(/^(\d{4})/u);
  if (!matched) return undefined;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildStringNodes = (values: string[]) => values.map((value) => value.trim()).filter((value) => value.length > 0);
const toRemoteImageSourceUrl = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized && /^https?:\/\//iu.test(normalized) ? normalized : undefined;
};
const truncateText = (value: string, maxChars: number): string => Array.from(value).slice(0, maxChars).join("");

const buildVideoNode = (videoMeta: VideoMeta | undefined): Record<string, unknown> | undefined => {
  if (!videoMeta) return undefined;
  const video: Record<string, unknown> = {};
  if (videoMeta.width !== undefined) video.width = videoMeta.width;
  if (videoMeta.height !== undefined) video.height = videoMeta.height;
  if (videoMeta.durationSeconds !== undefined) video.durationinseconds = Math.floor(videoMeta.durationSeconds);
  if (videoMeta.bitrate !== undefined) video.bitrate = videoMeta.bitrate;
  return Object.keys(video).length > 0 ? video : undefined;
};

const buildFanartNode = (
  data: CrawlerData,
  assets: DownloadedAssets | undefined,
): Record<string, unknown> | undefined => {
  if (assets?.fanart) {
    return { thumb: { "#text": basename(assets.fanart) } };
  }
  const primaryFanartUrl = data.fanart_url || data.thumb_url;
  return primaryFanartUrl ? { thumb: { "#text": primaryFanartUrl } } : undefined;
};

const isNfoFieldEnabled = (enabledFields: readonly NfoField[] | undefined, field: NfoField): boolean =>
  enabledFields === undefined || enabledFields.includes(field);

/** Converts the settings-layer ignore list into the generator's allow list. */
export const nfoIgnoreFieldsToEnabledFields = (
  ignoredFields: readonly NfoField[] | undefined,
): readonly NfoField[] | undefined =>
  ignoredFields === undefined ? undefined : NFO_FIELD_OPTIONS.filter((field) => !ignoredFields.includes(field));

const buildMdczNode = (
  data: CrawlerData,
  rawTitle: string | undefined,
  originalPlot: string | undefined,
  published: string,
  options: NfoOptions | undefined,
): Record<string, unknown> => {
  const enabledFields = options?.enabledFields;
  const includeRemoteSceneImageUrls = options?.includeRemoteSceneImageUrls ?? true;
  const allowRemoteTrailerFallback = options?.allowRemoteTrailerFallback ?? true;
  const remoteThumbSourceUrl = data.thumb_source_url ?? toRemoteImageSourceUrl(data.thumb_url);
  const thumbSourceUrl = isNfoFieldEnabled(enabledFields, "thumb") ? remoteThumbSourceUrl : undefined;
  const posterSourceUrl = isNfoFieldEnabled(enabledFields, "poster")
    ? (data.poster_source_url ?? toRemoteImageSourceUrl(data.poster_url))
    : undefined;
  const fanartSourceUrl = isNfoFieldEnabled(enabledFields, "fanart")
    ? (data.fanart_source_url ?? toRemoteImageSourceUrl(data.fanart_url) ?? remoteThumbSourceUrl)
    : undefined;
  const trailerSourceUrl =
    allowRemoteTrailerFallback && isNfoFieldEnabled(enabledFields, "trailer")
      ? (data.trailer_source_url ?? toRemoteImageSourceUrl(data.trailer_url))
      : undefined;
  const sceneImageUrls =
    includeRemoteSceneImageUrls && isNfoFieldEnabled(enabledFields, "sceneImages")
      ? data.scene_images
          .map((value) => toRemoteImageSourceUrl(value))
          .filter((value): value is string => Boolean(value))
      : [];

  const sourcePin = options?.localState?.sourcePin;
  return {
    raw_title: rawTitle,
    original_plot: originalPlot,
    source_url: sourcePin ? { "@_site": sourcePin.site, "#text": sourcePin.url } : undefined,
    thumb_source_url: thumbSourceUrl,
    poster_source_url: posterSourceUrl,
    fanart_source_url: fanartSourceUrl,
    trailer_source_url: trailerSourceUrl,
    scene_images: sceneImageUrls.length > 0 ? { image: sceneImageUrls } : undefined,
    published,
  };
};

export class NfoGenerator {
  buildXml(data: CrawlerData, options?: NfoOptions): string {
    if (!data.website) {
      throw new Error("NFO missing website");
    }

    return this.#buildXml(data, options);
  }

  #buildXml(data: CrawlerData, options?: NfoOptions): string {
    const localState = options?.localState;
    const rawTitle = data.title_zh?.trim() || data.title;
    const originaltitle = data.original_title?.trim() || data.title.trim();
    const titleNaming = options?.titleNaming;
    // A title the user edited is final as written; wrapping it in the template again would repeat the template.
    // `{number}` stays raw because its naming markers come from the video file, which not every NFO writer has.
    const title =
      !titleNaming || localState?.edits?.title === fingerprintNfoField({ title: rawTitle }, "title")
        ? rawTitle
        : renderTextTemplate(titleNaming.nfoTitleTemplate, {
            ...buildMetadataTemplateData(data, titleNaming),
            number: data.number,
          }) || rawTitle;
    const sourcePlot = data.plot?.trim();
    const plot = data.plot_zh?.trim() || sourcePlot;
    const outline = plot ? truncateText(plot, OUTLINE_MAX_CHARS) : undefined;
    const assets = options?.assets;
    const sources = options?.sources;
    const videoMeta = options?.videoMeta;
    const fileInfo = options?.fileInfo;
    const durationSeconds = videoMeta?.durationSeconds ?? data.durationSeconds;
    const runtimeMinutes = durationSeconds ? Math.round(durationSeconds / 60) : undefined;
    const genres = Array.from(new Set(buildStringNodes(toArray(data.genres))));
    const tags = Array.from(new Set(options?.buildTags?.(data, fileInfo, localState) ?? []));
    const videoNode = buildVideoNode(videoMeta);
    const movie: Record<string, unknown> = {};
    const enabledFields = options?.enabledFields;
    const allowRemoteTrailerFallback = options?.allowRemoteTrailerFallback ?? true;

    if (isNfoFieldEnabled(enabledFields, "sourceComment") && sources && Object.keys(sources).length > 0) {
      movie["#comment"] = buildSourceComment(data, sources);
    }

    movie.title = title;
    // Original-language tags are only written when they differ, so untranslated NFOs carry no duplicate text.
    movie.originaltitle = originaltitle !== title ? originaltitle : undefined;
    movie.plot = isNfoFieldEnabled(enabledFields, "plot") && plot && plot.length > 0 ? plot : undefined;
    movie.outline =
      isNfoFieldEnabled(enabledFields, "plot") && isNfoFieldEnabled(enabledFields, "outline") ? outline : undefined;
    movie.premiered = isNfoFieldEnabled(enabledFields, "release") ? data.release_date : undefined;
    movie.releasedate = isNfoFieldEnabled(enabledFields, "release") ? data.release_date : undefined;
    // Media servers sort "recently added" by this date, and a rewrite is not the movie arriving again.
    movie.dateadded = localState?.dateAdded ?? new Date().toISOString();
    movie.lockedfields = localState?.lockedFields?.length ? localState.lockedFields.join("|") : undefined;
    movie.year = isNfoFieldEnabled(enabledFields, "release") ? parseReleaseYear(data.release_date) : undefined;
    movie.runtime = isNfoFieldEnabled(enabledFields, "runtime") ? runtimeMinutes : undefined;
    movie.rating = isNfoFieldEnabled(enabledFields, "rating") ? data.rating : undefined;
    movie.studio = isNfoFieldEnabled(enabledFields, "studio") ? data.studio : undefined;
    movie.director = isNfoFieldEnabled(enabledFields, "director") ? data.director : undefined;
    movie.publisher = isNfoFieldEnabled(enabledFields, "publisher") ? data.publisher : undefined;
    movie.mpaa = "JP-18+";
    movie.set = isNfoFieldEnabled(enabledFields, "series") ? data.series : undefined;
    movie.trailer = isNfoFieldEnabled(enabledFields, "trailer")
      ? assets?.trailer
        ? basename(assets.trailer)
        : allowRemoteTrailerFallback
          ? data.trailer_url
          : undefined
      : undefined;
    movie.num = isNfoFieldEnabled(enabledFields, "num") ? data.number : undefined;
    movie.uniqueid = data.website ? { "@_type": data.website, "@_default": "true", "#text": data.number } : undefined;
    movie.genre = isNfoFieldEnabled(enabledFields, "genres") ? genres : undefined;
    movie.tag = isNfoFieldEnabled(enabledFields, "tags") && tags.length > 0 ? tags : undefined;
    movie.actor = buildActorNodes(toArray(data.actors), data.actor_profiles);

    const thumbs: Array<Record<string, unknown>> = [];
    if (isNfoFieldEnabled(enabledFields, "poster")) {
      if (assets?.poster) thumbs.push({ "@_aspect": "poster", "#text": basename(assets.poster) });
      else if (data.poster_url) thumbs.push({ "@_aspect": "poster", "#text": data.poster_url });
    }
    if (isNfoFieldEnabled(enabledFields, "thumb")) {
      if (assets?.thumb) thumbs.push({ "@_aspect": "thumb", "#text": basename(assets.thumb) });
      else if (data.thumb_url) thumbs.push({ "@_aspect": "thumb", "#text": data.thumb_url });
    }
    if (thumbs.length > 0) movie.thumb = thumbs;

    if (isNfoFieldEnabled(enabledFields, "fanart")) {
      const fanartNode = buildFanartNode(data, assets);
      if (fanartNode) movie.fanart = fanartNode;
    }
    movie.mdcz = buildMdczNode(
      data,
      rawTitle !== title ? rawTitle : undefined,
      isNfoFieldEnabled(enabledFields, "plot") && sourcePlot !== plot ? sourcePlot : undefined,
      formatFingerprints(publishedFingerprints(movie, localState)),
      options,
    );
    const fileinfo = videoNode ? { streamdetails: { video: videoNode } } : localState?.fileinfo;
    if (isNfoFieldEnabled(enabledFields, "fileinfo") && fileinfo) movie.fileinfo = fileinfo;

    const xmlBody = builder.build({ movie: { ...movie, ...localState?.foreignElements } });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xmlBody}`;
  }

  mergeEditableXml(
    existingXml: string,
    data: CrawlerData,
    changedFields: readonly NfoEditorField[],
    options?: NfoOptions,
    edit?: LibraryEdit,
  ): string {
    if (!changedFields.length) return existingXml;
    const validation = XMLValidator.validate(existingXml);
    if (validation !== true) throw new Error(`Invalid NFO XML: ${validation.err.msg}`);
    const fields = changedFields.filter((field) => isNfoEditorFieldEnabled(field, options?.enabledFields));
    if (!fields.length) return existingXml;
    return mergeNfoDocuments(existingXml, this.#buildXml(data, options), {
      movieFields: [...new Set(fields.flatMap((field) => EDITOR_FIELDS[field].movie ?? []))].filter(
        (field) =>
          (field !== "num" || isNfoFieldEnabled(options?.enabledFields, "num")) &&
          (field !== "outline" || isNfoFieldEnabled(options?.enabledFields, "outline")) &&
          (field !== "fileinfo" || isNfoFieldEnabled(options?.enabledFields, "fileinfo")),
      ),
      mdczFields: [...new Set([...fields.flatMap((field) => EDITOR_FIELDS[field].mdcz ?? []), "published"])],
      // Editing is not publishing: the changed values must still differ from MDCz's fingerprints.
      publishedFields: [],
      editorFields: fields,
      editorData: data,
      libraryEdit: edit,
    });
  }

  mergeTranslatedXml(existingXml: string, data: CrawlerData, options?: NfoOptions): string {
    return mergeNfoDocuments(existingXml, this.#buildXml(data, options), TRANSLATION_MERGE);
  }

  async writeNfo(nfoPath: string, data: CrawlerData, options?: NfoOptions): Promise<string> {
    const write = options?.writeFile ?? atomicWriteFile;
    const xml = this.buildXml(data, options);
    const nfoNaming = options?.nfoNaming ?? "both";
    const { primaryPath, canonicalPath, requiredPaths } = getNfoWritePaths(nfoPath, nfoNaming);
    if (!options?.writeFile) await mkdir(dirname(primaryPath), { recursive: true });

    for (const requiredPath of requiredPaths) await write(requiredPath, xml);
    return canonicalPath;
  }
}

export const nfoGenerator = new NfoGenerator();

export const resolveFilenameNfoPath = (nfoPath: string, videoPath?: string): string =>
  videoPath && dirname(resolve(nfoPath)) !== dirname(resolve(videoPath))
    ? replaceExtension(nfoPath, ".nfo")
    : replaceExtension(videoPath ?? nfoPath, ".nfo");

export const getNfoReadCandidates = (
  nfoPath: string,
  nfoNaming: NfoNamingMode = "both",
  videoPath?: string,
): string[] => {
  const plannedPath = resolveFilenameNfoPath(nfoPath, videoPath);
  const { primaryPath, moviePath, canonicalPath } = getNfoWritePaths(plannedPath, nfoNaming);
  // Callers may hand over the video itself when no NFO is known yet; it must never be read as one.
  return Array.from(new Set([canonicalPath, primaryPath, moviePath, replaceExtension(nfoPath, ".nfo")]));
};

type NfoMerge = {
  movieFields: readonly string[];
  mdczFields: readonly string[];
  /** Fields whose new values MDCz publishes, so they are not read back as someone's edits. */
  publishedFields: readonly NfoEditableField[];
  editorFields?: readonly NfoEditorField[];
  editorData?: CrawlerData;
  libraryEdit?: LibraryEdit;
};

const EDITOR_FIELDS: Record<NfoEditorField, { movie?: string[]; mdcz?: string[]; enabled?: NfoField }> = {
  title: { movie: ["title", "originaltitle"], mdcz: ["raw_title"] },
  title_zh: { movie: ["title", "originaltitle"], mdcz: ["raw_title"] },
  number: { movie: ["num", "uniqueid"] },
  website: { movie: ["uniqueid"] },
  actors: { movie: ["actor"] },
  actor_profiles: { movie: ["actor"] },
  genres: { movie: ["genre"], enabled: "genres" },
  content_type: { movie: ["tag"], enabled: "tags" },
  studio: { movie: ["studio"], enabled: "studio" },
  director: { movie: ["director"], enabled: "director" },
  publisher: { movie: ["publisher"], enabled: "publisher" },
  series: { movie: ["set"], enabled: "series" },
  plot: { movie: ["plot", "outline"], mdcz: ["original_plot"], enabled: "plot" },
  plot_zh: { movie: ["plot", "outline"], mdcz: ["original_plot"], enabled: "plot" },
  release_date: { movie: ["premiered", "releasedate", "year"], enabled: "release" },
  durationSeconds: { movie: ["runtime", "fileinfo"], enabled: "runtime" },
  rating: { movie: ["rating"], enabled: "rating" },
  thumb_url: { movie: ["thumb"], enabled: "thumb" },
  poster_url: { movie: ["thumb"], enabled: "poster" },
  fanart_url: { movie: ["fanart"], enabled: "fanart" },
  trailer_url: { movie: ["trailer"], enabled: "trailer" },
  thumb_source_url: { mdcz: ["thumb_source_url"], enabled: "thumb" },
  poster_source_url: { mdcz: ["poster_source_url"], enabled: "poster" },
  fanart_source_url: { mdcz: ["fanart_source_url"], enabled: "fanart" },
  trailer_source_url: { mdcz: ["trailer_source_url"], enabled: "trailer" },
  scene_images: { mdcz: ["scene_images"], enabled: "sceneImages" },
};

export const isNfoEditorFieldEnabled = (field: NfoEditorField, enabledFields?: readonly NfoField[]): boolean => {
  const enabled = EDITOR_FIELDS[field].enabled;
  return !enabled || isNfoFieldEnabled(enabledFields, enabled);
};

// A translation replaces only the text it translated; whatever else the NFO holds stays as written.
const TRANSLATION_MERGE: NfoMerge = {
  movieFields: ["title", "originaltitle", "plot", "outline"],
  mdczFields: ["raw_title", "original_plot", "published"],
  publishedFields: ["title", "originaltitle", "plot"],
};

const requireXmlRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
};

const toRecordOrEmpty = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const mergeNfoDocuments = (existingXml: string, generatedXml: string, merge: NfoMerge): string => {
  const existingRoot = requireXmlRecord(parser.parse(existingXml), "Invalid NFO root");
  const existingMovie = requireXmlRecord(existingRoot.movie, "Invalid NFO movie node");
  const generatedRoot = requireXmlRecord(parser.parse(generatedXml), "Invalid generated NFO root");
  const generatedMovie = requireXmlRecord(generatedRoot.movie, "Invalid generated NFO movie node");
  const existingMdcz = toRecordOrEmpty(existingMovie.mdcz);
  const generatedMdcz = requireXmlRecord(generatedMovie.mdcz, "Invalid generated NFO mdcz node");
  const generatedPublished = parseFingerprints(generatedMdcz.published);
  const published = formatFingerprints({
    ...fingerprintNfo(existingMovie),
    ...parseFingerprints(existingMdcz.published),
    ...Object.fromEntries(merge.publishedFields.map((field) => [field, generatedPublished[field]])),
  });

  for (const field of merge.movieFields) {
    const generated = generatedMovie[field];
    if (field === "actor") {
      existingMovie.actor = mergeActorNodes(
        existingMovie.actor,
        generated,
        merge.editorFields?.includes("actor_profiles") ?? false,
        !merge.libraryEdit && (merge.editorFields?.includes("actors") ?? false),
        merge.libraryEdit,
      );
      continue;
    }
    if (field === "uniqueid") {
      const ids = toArray(existingMovie.uniqueid);
      const index = ids.findIndex((id) => Object.values(Website).includes(toRecordOrEmpty(id)["@_type"] as Website));
      if (index < 0) ids.push(generated);
      else ids[index] = { ...toRecordOrEmpty(ids[index]), ...toRecordOrEmpty(generated) };
      existingMovie.uniqueid = ids;
      continue;
    }
    if (field === "set" && generated !== undefined && typeof existingMovie.set === "object") {
      const collection = toRecordOrEmpty(existingMovie.set);
      existingMovie.set = { ...collection, ["name" in collection ? "name" : "#text"]: generated };
      continue;
    }
    if (field === "thumb") {
      const thumbs = toArray(existingMovie.thumb);
      for (const [key, aspects] of [
        ["poster_url", ["poster"]],
        ["thumb_url", ["thumb", "landscape", ""]],
      ] as const) {
        if (!merge.editorFields?.includes(key)) continue;
        const index = thumbs.findIndex((thumb) =>
          (aspects as readonly string[]).includes(String(toRecordOrEmpty(thumb)["@_aspect"] ?? "").toLowerCase()),
        );
        const replacement = toArray(generated).find((thumb) =>
          (aspects as readonly string[]).includes(String(toRecordOrEmpty(thumb)["@_aspect"] ?? "").toLowerCase()),
        );
        if (replacement === undefined) {
          if (index >= 0) thumbs.splice(index, 1);
        } else if (index < 0) thumbs.push(replacement);
        else thumbs[index] = { ...toRecordOrEmpty(thumbs[index]), "#text": toRecordOrEmpty(replacement)["#text"] };
      }
      existingMovie.thumb = thumbs;
      continue;
    }
    if (field === "fanart") {
      const fanart = toRecordOrEmpty(existingMovie.fanart);
      const thumbs = toArray(fanart.thumb);
      const replacement = merge.editorData?.fanart_url ? toRecordOrEmpty(generated).thumb : undefined;
      if (replacement === undefined) thumbs.shift();
      else thumbs.splice(0, 1, { ...toRecordOrEmpty(thumbs[0]), "#text": merge.editorData?.fanart_url });
      existingMovie.fanart = { ...fanart, thumb: thumbs };
      continue;
    }
    if (field === "fileinfo") {
      const fileinfo = toRecordOrEmpty(existingMovie.fileinfo);
      const streams = toRecordOrEmpty(fileinfo.streamdetails);
      const video = { ...toRecordOrEmpty(streams.video) };
      if (merge.editorData?.durationSeconds === undefined) delete video.durationinseconds;
      else video.durationinseconds = Math.floor(merge.editorData.durationSeconds);
      existingMovie.fileinfo = { ...fileinfo, streamdetails: { ...streams, video } };
      continue;
    }
    if (field === "tag") {
      existingMovie.tag = [
        ...toArray(existingMovie.tag).filter((tag) => !String(tag).startsWith("mdcz:content_type:")),
        ...toArray(generated).filter((tag) => String(tag).startsWith("mdcz:content_type:")),
      ];
      continue;
    }
    if (generated !== undefined) existingMovie[field] = generated;
    else delete existingMovie[field];
  }

  const mdcz: Record<string, unknown> = { ...generatedMdcz, published };
  for (const field of merge.editorFields ?? []) {
    if (field.endsWith("_source_url")) mdcz[field] = merge.editorData?.[field];
  }
  for (const field of merge.mdczFields) {
    if (mdcz[field] !== undefined) existingMdcz[field] = mdcz[field];
    else delete existingMdcz[field];
  }
  existingMovie.mdcz = existingMdcz;

  existingRoot.movie = existingMovie;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${builder.build(existingRoot)}`;
};

const actorNodeName = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" ? name.trim() : "";
};

const mergeActorNodes = (
  existing: unknown,
  generated: unknown,
  updateProfiles: boolean,
  updateOrder: boolean,
  edit?: LibraryEdit,
): unknown => {
  const existingActors = toArray(existing);
  const generatedActors = toArray(generated);
  const existingByName = new Map(existingActors.map((actor) => [normalizeActorName(actorNodeName(actor)), actor]));
  return generatedActors.map((actor) => {
    const name = normalizeActorName(actorNodeName(actor));
    const previous =
      existingByName.get(name) ??
      (edit?.field === "actors" && edit.operation === "rename" && name === normalizeActorName(edit.to)
        ? existingByName.get(normalizeActorName(edit.from))
        : undefined);
    if (!(previous && typeof previous === "object" && actor && typeof actor === "object")) return actor;
    const next = actor as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...(previous as Record<string, unknown>), name: next.name };
    if (updateOrder) Object.assign(merged, { order: next.order, sortorder: next.sortorder });
    if (updateProfiles) {
      if ("thumb" in next) merged.thumb = next.thumb;
      else delete merged.thumb;
    }
    return merged;
  });
};

export interface NfoNamingPaths {
  primaryPath: string;
  moviePath: string;
  canonicalPath: string;
  requiredPaths: string[];
}

const siblingPath = (filePath: string, fileName: string): string => {
  const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return `${filePath.slice(0, separatorIndex + 1)}${fileName}`;
};

export const getNfoWritePaths = (nfoPath: string, nfoNaming: NfoNamingMode = "both"): NfoNamingPaths => {
  const primaryPath = nfoPath;
  const moviePath = siblingPath(nfoPath, JELLYFIN_MOVIE_NFO_NAME);
  if (nfoNaming === "movie") {
    return {
      primaryPath,
      moviePath,
      canonicalPath: moviePath,
      requiredPaths: [moviePath],
    };
  }
  if (nfoNaming === "filename") {
    return {
      primaryPath,
      moviePath,
      canonicalPath: primaryPath,
      requiredPaths: [primaryPath],
    };
  }
  return {
    primaryPath,
    moviePath,
    canonicalPath: primaryPath,
    requiredPaths: primaryPath === moviePath ? [primaryPath] : [primaryPath, moviePath],
  };
};

const replaceExtension = (filePath: string, extension: string): string => {
  const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const extensionIndex = filePath.lastIndexOf(".");
  return extensionIndex > separatorIndex
    ? `${filePath.slice(0, extensionIndex)}${extension}`
    : `${filePath}${extension}`;
};

function buildSourceComment(data: CrawlerData, sources: SourceMap): string {
  const lines: string[] = ["\n  Aggregation Sources:"];
  const fields: Array<{ key: keyof CrawlerData; label: string; detail?: () => string }> = [
    { key: "title", label: "title" },
    { key: "plot", label: "plot", detail: () => `${data.plot?.length ?? 0} chars` },
    { key: "actors", label: "actors", detail: () => `${data.actors.length} actors` },
    { key: "poster_url", label: "poster_url" },
    { key: "thumb_url", label: "thumb_url" },
    { key: "fanart_url", label: "fanart_url" },
    { key: "scene_images", label: "scene_images", detail: () => `${data.scene_images.length} images` },
    { key: "trailer_url", label: "trailer_url" },
    { key: "studio", label: "studio" },
    { key: "genres", label: "genres", detail: () => `${data.genres.length} genres` },
  ];
  for (const field of fields) {
    const source = sources[field.key];
    if (source) {
      const extra = field.detail ? ` (${field.detail()})` : "";
      lines.push(`    ${field.label}: ${source}${extra}`);
    }
  }
  lines.push(`    Crawled: ${new Date().toISOString()}`);
  lines.push("  ");
  return lines.join("\n");
}
