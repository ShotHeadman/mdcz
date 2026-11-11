import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";
import type { Configuration } from "@mdcz/shared/config";
import { type MovieNaming, type NamingPolicy, resolveMovieNaming } from "@mdcz/shared/mediaLibrary";
import type { CrawlerData, DiscoveredAssets, MaintenanceAssetDecisions } from "@mdcz/shared/types";
import { DirectoryInventory } from "../scrape/DirectoryInventory";
import { buildSceneImageFileName, SCENE_IMAGE_FILE_PATTERN } from "../scrape/download/assets/helpers";
import type { ResolvedPublicationLayout } from "../scrape/FileOrganizer";
import { sanitizePathSegment } from "../scrape/utils/path";

export interface PublicationAssetLayout {
  staged: ReadonlyMap<string, string>;
  retained: ReadonlyMap<string, string>;
}

/**
 * One naming per movie: when any of its metadata folders holds another movie, every folder gets the shared naming.
 * Per-video names are valid in a folder of its own too, so one name set serves the whole group.
 */
export const resolvePublicationNaming = async (input: {
  layouts: readonly Pick<ResolvedPublicationLayout, "metadataDir" | "sourceVideoPath">[];
  policy?: NamingPolicy;
  config: Configuration;
  inventory: DirectoryInventory;
}): Promise<MovieNaming> => {
  const holdsOtherMovies = await Promise.all(
    input.layouts.map((layout) =>
      input.inventory.holdsOtherMovies(layout.metadataDir, layout.sourceVideoPath, input.config.scrape),
    ),
  );
  return resolveMovieNaming({
    policy: input.policy,
    holdsOtherMovies: holdsOtherMovies.some(Boolean),
    downloadSceneImages: input.config.download.downloadSceneImages,
  });
};

export const resolvePublicationAssetLayout = async (input: {
  layout: ResolvedPublicationLayout;
  config: Configuration;
  naming: MovieNaming;
  crawlerData?: CrawlerData;
  movieBaseName?: string;
  existingAssets?: DiscoveredAssets;
  assetDecisions?: MaintenanceAssetDecisions;
  inventory?: DirectoryInventory;
}): Promise<PublicationAssetLayout> => {
  const { layout, config, naming } = input;
  const names = buildMovieAssetFileNames(input.movieBaseName ?? basename(layout.nfoPath, ".nfo"), naming.assetNaming);
  const staged = new Map<string, string>();
  const retained = new Map<string, string>();
  const imageExtensions = [".jpg", ".jpeg", ".png", ".webp"] as const;

  for (const [kind, value] of Object.entries(input.existingAssets ?? {})) {
    if (kind === "sceneImages" && !naming.sceneImages) continue;
    for (const source of Array.isArray(value) ? value : value ? [value] : []) {
      const name = relative(layout.existingMetadataDir, source);
      const collection = kind === "sceneImages" || kind === "actorPhotos";
      const targetName = collection
        ? name && name !== ".." && !name.startsWith("../") && !isAbsolute(name)
          ? name
          : join(basename(parse(source).dir), basename(source))
        : `${parse(names[kind as keyof typeof names]).name}${parse(source).ext}`;
      // A fixed name such as poster.jpg in a folder shared with other movies does not say whose it is.
      const target =
        layout.mode === "move"
          ? join(layout.metadataDir, targetName)
          : naming.sharedFolder && !collection
            ? join(dirname(source), targetName)
            : source;
      retained.set(source, target);
    }
  }

  const inventory = input.inventory ?? new DirectoryInventory();

  const scanDirectoryAssets = async (directory: string, isSourceDir: boolean) => {
    const sceneFolder = join(directory, config.paths.sceneImagesFolder);
    const sceneEntries = naming.sceneImages
      ? await inventory.files(sceneFolder, (name) => SCENE_IMAGE_FILE_PATTERN.test(name))
      : [];
    for (const entry of sceneEntries) {
      const source = join(sceneFolder, entry.name);
      if (!retained.has(source)) {
        const target =
          isSourceDir && layout.mode === "move"
            ? join(layout.metadataDir, config.paths.sceneImagesFolder, entry.name)
            : source;
        retained.set(source, target);
      }
    }

    const actorsFolder = join(directory, ".actors");
    for (const entry of await inventory.files(actorsFolder)) {
      const source = join(actorsFolder, entry.name);
      if (!retained.has(source)) {
        const target = isSourceDir && layout.mode === "move" ? join(layout.metadataDir, ".actors", entry.name) : source;
        retained.set(source, target);
      }
    }

    const assetKinds = (fileName: string) =>
      (["thumb", "poster", "fanart", "trailer"] as const).filter((kind) => {
        const exts: readonly string[] = kind === "trailer" ? [".mp4"] : imageExtensions;
        const { name, ext } = parse(fileName);
        return fileName === names[kind] || (name === parse(names[kind]).name && exts.includes(ext.toLowerCase()));
      });
    for (const entry of await inventory.files(directory, (name) => assetKinds(name).length > 0)) {
      const source = join(directory, entry.name);
      for (const kind of assetKinds(entry.name)) {
        if (retained.has(source)) continue;
        const target =
          isSourceDir && layout.mode === "move"
            ? join(layout.metadataDir, `${parse(names[kind]).name}${parse(source).ext}`)
            : source;
        retained.set(source, target);
      }
    }
  };

  await scanDirectoryAssets(layout.existingMetadataDir, true);
  if (resolve(layout.metadataDir) !== resolve(layout.existingMetadataDir)) {
    await scanDirectoryAssets(layout.metadataDir, false);
  }

  if (
    config.download.downloadTrailer &&
    input.assetDecisions?.trailer !== "preserve" &&
    (input.crawlerData?.trailer_source_url || input.crawlerData?.trailer_url)
  ) {
    const name = `${parse(names.trailer).name}.mp4`;
    staged.set(name, join(layout.metadataDir, name));
  }

  if (config.download.downloadThumb) {
    for (const ext of imageExtensions) {
      const name = `${parse(names.thumb).name}${ext}`;
      staged.set(name, join(layout.metadataDir, name));
    }
  }

  if (config.download.downloadPoster) {
    for (const ext of imageExtensions) {
      const name = `${parse(names.poster).name}${ext}`;
      staged.set(name, join(layout.metadataDir, name));
    }
  }

  if (config.download.downloadFanart && input.assetDecisions?.fanart !== "preserve") {
    for (const ext of imageExtensions) {
      const name = `${parse(names.fanart).name}${ext}`;
      staged.set(name, join(layout.metadataDir, name));
    }
  }

  if (naming.sceneImages && input.assetDecisions?.sceneImages !== "preserve") {
    // The downloader can fall back to an alternative set that is longer than the aggregated one, up to the same cap.
    for (let index = 0; index < config.aggregation.behavior.maxSceneImages; index++) {
      for (const ext of imageExtensions) {
        const name = join(
          config.paths.sceneImagesFolder,
          buildSceneImageFileName(config.paths.sceneImagesFolder, index, `image${ext}`),
        );
        staged.set(name, join(layout.metadataDir, name));
      }
    }
  }

  const actors = input.crawlerData?.actors ?? [];
  if (config.personSync.downloadActorPhotos && config.personSync.personImageSources.length > 0 && actors.length > 0) {
    for (const actor of actors) {
      for (const ext of imageExtensions) {
        const name = join(".actors", `${sanitizePathSegment(actor) || "actor"}${ext}`);
        staged.set(name, join(layout.metadataDir, name));
      }
    }
  }

  return { staged, retained };
};
