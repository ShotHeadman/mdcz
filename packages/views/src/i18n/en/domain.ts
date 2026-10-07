import type { ManualScrapeUrlInvalidReason } from "@mdcz/shared/manualScrapeUrl";
import type { PosterTagBadgePosition, PosterTagBadgeType } from "@mdcz/shared/posterBadges";
import type { FailureReason } from "@mdcz/shared/siteResults";
import type { MaintenanceDiffField, MaintenancePresetId } from "@mdcz/shared/types";

export const domain = {
  failureReasons: {
    region_blocked: "region-blocked on this network",
    login_wall: "requires login or verification",
    cloudflare: "blocked by a Cloudflare challenge",
    rate_limited: "rate limited",
    ip_banned: "this network's IP is banned",
    timeout: "timed out",
    empty_shell: "returned an empty page",
    not_found: "not found",
    parse_error: "page could not be parsed",
    http_error: "HTTP error",
    network_error: "connection failed",
    unknown: "unknown error",
  } as Record<FailureReason, string>,
  siteHealth: {
    title: "Sites unavailable on this network",
    unavailable: (site: string, reason: string) => `${site}: ${reason}.`,
    paused: (site: string, reason: string, until: string) => `${site}: ${reason}; paused until ${until}.`,
    remedies: {
      region_blocked:
        "Turn on a Japanese proxy for this site, or disable it; the other enabled sites keep working without it.",
      login_wall: "Add or refresh this site's cookie in the network settings.",
      cloudflare: "Reach this site through a proxy or a mirror.",
      ip_banned: "Wait for the ban to lift, switch to another proxy exit, or disable this site.",
    } as Partial<Record<FailureReason, string>>,
    recheck: "A passing connectivity check, a proxy or cookie change, or a restart makes the site available again.",
    openSettings: "Site settings",
    useProxy: "Proxy",
    proxyOff: "Turn on the proxy in the network settings first",
  },
  maintenancePresets: {
    import_local: {
      label: "Import locally",
      description: "Read existing NFO files and images into the library without changing any files",
    },
    refresh_metadata: { label: "Refresh in place", description: "Refresh metadata online and compare NFO differences" },
    remerge: {
      label: "Re-merge",
      description: "Rebuild metadata from stored site results with the current priorities, without scraping",
    },
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
