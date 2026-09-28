import type { ManualScrapeUrlInvalidReason } from "@mdcz/shared/manualScrapeUrl";
import type { PosterTagBadgePosition, PosterTagBadgeType } from "@mdcz/shared/posterBadges";
import type { MaintenanceDiffField, MaintenancePresetId } from "@mdcz/shared/types";

export const domain = {
  maintenancePresets: {
    import_local: {
      label: "Import locally",
      description: "Read existing NFO files and images into the library without changing any files",
    },
    refresh_metadata: { label: "Refresh in place", description: "Refresh metadata online and compare NFO differences" },
    local_organize: { label: "Organize locally", description: "Reorganize the file and folder structure by the rules" },
    rebuild_all: {
      label: "Full rebuild",
      description: "Fetch data again and restructure folders with current settings",
    },
  } satisfies Record<MaintenancePresetId, { label: string; description: string }> as Record<
    MaintenancePresetId,
    { label: string; description: string }
  >,
  posterBadgeTypes: {
    subtitle: "Chinese subtitles",
    censored: "Censored",
    umr: "UMR",
    leak: "Leak",
    uncensored: "Uncensored",
    fullHd: "1080P",
    fourK: "4K",
    eightK: "8K",
  } as Record<PosterTagBadgeType, string>,
  posterBadgePositions: {
    topLeft: "Top left",
    topRight: "Top right",
    bottomLeft: "Bottom left",
    bottomRight: "Bottom right",
  } as Record<PosterTagBadgePosition, string>,
  manualScrapeUrlInvalid: {
    invalid_url: "Enter a valid URL",
    unsupported_site: "Unsupported site URL",
    unsupported_path: "Enter a site home page or detail page URL",
  } as Record<ManualScrapeUrlInvalidReason, string>,
  maintenanceDiffFields: {
    title: "Title",
    title_zh: "Chinese title",
    plot: "Plot",
    plot_zh: "Chinese plot",
    studio: "Studio",
    director: "Director",
    publisher: "Publisher",
    series: "Series",
    release_date: "Release date",
    rating: "Rating",
    durationSeconds: "Duration",
    content_type: "Content type",
    trailer_url: "Trailer",
    thumb_url: "Cover image",
    poster_url: "Poster",
    actors: "Actors",
    genres: "Tags",
    scene_images: "Scene images",
  } as Record<MaintenanceDiffField, string>,
};
