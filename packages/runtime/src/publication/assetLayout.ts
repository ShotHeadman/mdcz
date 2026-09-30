import { basename, isAbsolute, join, parse, relative, resolve } from "node:path";
import { buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";
import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, DiscoveredAssets, MaintenanceAssetDecisions } from "@mdcz/shared/types";
import { DirectoryInventory } from "../scrape/DirectoryInventory";
import { buildSceneImageFileName, SCENE_IMAGE_FILE_PATTERN } from "../scrape/download/assets/helpers";
import type { ResolvedPublicationLayout } from "../scrape/FileOrganizer";
import { sanitizePathSegment } from "../scrape/utils/path";

export interface PublicationAssetLayout {
  staged: ReadonlyMap<string, string>;
  retained: ReadonlyMap<string, string>;
}

export const resolvePublicationAssetLayout = async (input: {
  layout: ResolvedPublicationLayout;
  config: Configuration;
  crawlerData?: CrawlerData;
  movieBaseName?: string;
  existingAssets?: DiscoveredAssets;
  assetDecisions?: MaintenanceAssetDecisions;
  inventory?: DirectoryInventory;
}): Promise<PublicationAssetLayout> => {
  const { layout, config } = input;
  const names = buildMovieAssetFileNames(
    input.movieBaseName ?? basename(layout.nfoPath, ".nfo"),
    config.naming.assetNamingMode,
  );
  const staged = new Map<string, string>();
  const retained = new Map<string, string>();
  const imageExtensions = [".jpg", ".jpeg", ".png", ".webp"] as const;

  for (const [kind, value] of Object.entries(input.existingAssets ?? {})) {
    for (const source of Array.isArray(value) ? value : value ? [value] : []) {
      const name = relative(layout.existingMetadataDir, source);
      const collection = kind === "sceneImages" || kind === "actorPhotos";
      const targetName = collection
        ? name && name !== ".." && !name.startsWith("../") && !isAbsolute(name)
          ? name
          : join(basename(parse(source).dir), basename(source))
        : `${parse(names[kind as keyof typeof names]).name}${parse(source).ext}`;
      retained.set(source, layout.mode === "move" ? join(layout.metadataDir, targetName) : source);
    }
  }

  const inventory = input.inventory ?? new DirectoryInventory();

  const scanDirectoryAssets = async (directory: string, isSourceDir: boolean) => {
    const sceneFolder = join(directory, config.paths.sceneImagesFolder);
    for (const entry of await inventory.entries(sceneFolder)) {
      if (!entry.isFile() || !SCENE_IMAGE_FILE_PATTERN.test(entry.name)) continue;
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
    for (const entry of await inventory.entries(actorsFolder)) {
      if (!entry.isFile()) continue;
      const source = join(actorsFolder, entry.name);
      if (!retained.has(source)) {
        const target = isSourceDir && layout.mode === "move" ? join(layout.metadataDir, ".actors", entry.name) : source;
        retained.set(source, target);
      }
    }

    for (const entry of await inventory.entries(directory)) {
      if (!entry.isFile()) continue;
      const ext = parse(entry.name).ext.toLowerCase();
      for (const kind of ["thumb", "poster", "fanart", "trailer"] as const) {
        const base = parse(names[kind]).name;
        const exts: readonly string[] = kind === "trailer" ? [".mp4"] : imageExtensions;
        if (entry.name === names[kind] || (parse(entry.name).name === base && exts.includes(ext))) {
          const source = join(directory, entry.name);
          if (!retained.has(source)) {
            const target =
              isSourceDir && layout.mode === "move" ? join(layout.metadataDir, `${base}${parse(source).ext}`) : source;
            retained.set(source, target);
          }
        }
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

  const sceneSources = input.crawlerData?.scene_images ?? [];
  if (
    config.download.downloadSceneImages &&
    input.assetDecisions?.sceneImages !== "preserve" &&
    sceneSources.length > 0
  ) {
    const targetCount = Math.min(config.aggregation.behavior.maxSceneImages, sceneSources.length);
    for (let index = 0; index < targetCount; index++) {
      for (const ext of imageExtensions) {
        const name = join(
          config.paths.sceneImagesFolder,
          buildSceneImageFileName(config.paths.sceneImagesFolder, index, `image${ext}`),
        );
        staged.set(name, join(layout.metadataDir, name));
      }
    }
  }

  const personImageSources = config.personSync?.personImageSources ?? [];
  const actors = input.crawlerData?.actors ?? [];
  if (personImageSources.length > 0 && actors.length > 0) {
    for (const actor of actors) {
      for (const ext of imageExtensions) {
        const name = join(".actors", `${sanitizePathSegment(actor) || "actor"}${ext}`);
        staged.set(name, join(layout.metadataDir, name));
      }
    }
  }

  return { staged, retained };
};
