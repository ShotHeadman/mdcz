import type { ConfigIssueCode, NfoField } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { R18MetadataLanguage } from "@mdcz/shared/r18";
import type { NamingPreviewSampleId } from "@mdcz/shared/types";

export const settings = {
  translationTest: {
    ok: (sample: string) => `Metadata translation sample verified: ${sample}`,
    missing_model: "Please configure the LLM model name first",
    missing_credentials: "Please enter the credentials required by this translation engine",
    failed: "Connection failed",
  },
  siteConnectivity: {
    httpResult: (ok: boolean, status: number, latencyMs: number) =>
      `${ok ? "" : "Connection error · "}HTTP ${status} · ${latencyMs}ms`,
    requestFailed: "Request failed",
    redirected: (host: string) => `Redirected to ${host}; not a working mirror`,
  },
  namingPreviewSamples: {
    standard: "Standard",
    subtitled: "Chinese subtitles",
    multiActor: "Multiple actors",
    noActor: "No actors",
  } as Record<NamingPreviewSampleId, string>,
  options: {
    translateEngine: {
      openai: "LLM translation",
      google: "Google Translate (free)",
      deepl: "DeepL",
      baidu: "Baidu Translate",
    },
    baiduService: { general: "General text translation", llm: "LLM text translation" },
    llmReasoning: { default: "Server default", disabled: "Off", low: "Low", medium: "Medium", high: "High" },
    llmReasoningDeepseek: {
      default: "Server default",
      disabled: "Off",
      enabled: "On (server default effort)",
      low: "low",
      high: "high",
      max: "max",
    },
    llmApiFormat: { responses: "Responses", "chat-completions": "Chat Completions" },
    llmServiceType: { "openai-compatible": "OpenAI compatible", google: "Google", deepseek: "DeepSeek" },
    llmOutputFormat: { none: "Prompt JSON", json_object: "JSON Object", json_schema: "JSON Schema" },
    partStyle: {
      RAW: "Keep original suffix",
      CD: "Normalize to CD1 / CD2",
      PART: "Normalize to PART1 / PART2",
      DISC: "Normalize to DISC1 / DISC2",
    },
    assetNaming: { fixed: "Fixed names", followVideo: "Follow the video file name" },
    nfoNaming: { both: "Generate both", movie: "movie.nfo only", filename: "<file name>.nfo only" },
  },
  nfoFields: {
    num: "code compatibility fields",
    plot: "plot and outline",
    release: "release info",
    runtime: "runtime",
    fileinfo: "video technical info",
    rating: "rating",
    studio: "studio",
    director: "director",
    publisher: "publisher",
    series: "series",
    genres: "genres",
    tags: "tags",
    poster: "poster",
    thumb: "landscape thumbnail",
    fanart: "fanart",
    sceneImages: "scene image sources",
    trailer: "trailer",
    sourceComment: "aggregation source comment",
  } as Record<NfoField, string>,
  nfoFieldOption: (field: string, label: string) => `${field} (${label})`,
  badgeOverrides: {
    openFolder: "Open folder",
    createDirFailed: (error: string) => `Failed to create the badge image directory: ${error}`,
    openDirFailed: (error: string) => `Failed to open the badge image directory: ${error}`,
    title: "Override badge images",
    description:
      "Put custom images in the directory below. Images with a matching file name take priority; otherwise the built-in badge is used.",
    directory: "Directory",
    badge: "Badge",
    fileNames: "Accepted file names",
    formats: (formats: string) => `Supported formats: ${formats}.`,
    ratio: (ratio: string) =>
      `Recommended ratio: ${ratio}. Badge height is about 8% of the poster's short side, clamped to 28–64px.`,
    scaling:
      "Images are scaled proportionally to fit the badge slot and never stretched; square images are placed left-aligned at slot height × slot height.",
    advice:
      "Transparent PNG or WebP is recommended. Oversized images are scaled down; broken or unreadable images fall back to the built-in badge.",
  },
  gotIt: "Got it",
  namingPreview: {
    title: "Naming preview",
    generating: "Generating preview…",
    waiting: "Waiting for sample data",
    source: (path: string) => `Source: ${path}`,
    organized: (path: string) => `Organized: ${path}`,
    metadataDir: (path: string) => `Metadata directory: ${path}`,
  },
  namingTemplateHelp: {
    folder: "Folder template",
    file: "File name template",
    viewPlaceholders: (template: string) => `View ${template.toLowerCase()} placeholders`,
    placeholdersTitle: (template: string) => `${template} placeholders`,
    notesTitle: (template: string) => `${template} notes`,
    placeholder: "Placeholder",
    description: "Description",
    placeholders: {
      "{actor}":
        "Actor display name for file naming; truncated to “Maximum actor names”, appending the configured suffix when exceeded (default “等演员”)",
      "{actorFallbackPrefix}": "Only output when {actor} falls back to the studio or seller, e.g. “片商：” or “卖家：”",
      "{firstActor}": "First actor; uses the current {actor} value when there are no actors",
      "{allActors}":
        "Full actor list, unaffected by “Maximum actor names” and “Suffix for extra actors”; uses the current {actor} value when there are no actors",
      "{number}": "Movie code, including subtitle, uncensored, leak and other tags added by the naming rules",
      "{rawNumber}": "Original movie code without naming tags",
      "{letters}": "Code prefix, e.g. ABC-123 outputs ABC, FC2-123456 outputs FC2",
      "{firstLetter}": "First character of the code; outputs # when it isn't a letter or digit",
      "{title}": "Chinese title first; falls back to the original title",
      "{originaltitle}": "Original title as scraped",
      "{outline} / {plot}": "Chinese plot first; falls back to the original plot",
      "{date} / {release}": "Release date formatted by “Release date format”",
      "{year}": "Release year",
      "{runtime}": "Runtime in minutes",
      "{director}": "Director",
      "{series}": "Series",
      "{studio}": "Studio",
      "{publisher}": "Publisher",
      "{filename}": "Original video file name without extension",
      "{definition} / {resolution}": "Video resolution, e.g. 1080P, 2160P",
      "{4K}": "Outputs the matching tag when the resolution is 4K or 8K",
      "{cnword}": "Outputs the configured subtitle tag when Chinese subtitles are detected",
      "{subtitle}": "Subtitle tag, e.g. 中文字幕",
      "{censorshipType}":
        "Censorship type, derived from the code, local choice, title and tag hints, e.g. 有码, 无码, 无码破解, 无码流出",
      "{score} / {rating}": "Rating",
      "{website}": "Identifier of the site finally used for scraping",
    } as Record<string, string>,
    notes: {
      folder: [
        "A / or \\ in this template creates nested folders.",
        "Folders are created from this template when moving videos and subtitles, or when outputting metadata only.",
        "If the template has no per-movie unique field, attached files and NFO names are validated in shared directory mode on save.",
      ],
      file: [
        "The file name template only sets the video's base name and never creates subfolders; path separators and invalid characters are removed.",
        "The file extension is taken from the source file; don't add .mp4, .mkv, etc. to the template.",
        "Multi-part videos get a suffix per “Part style” after the template result; use {rawNumber} for the code without naming tags.",
      ],
    },
  },
  sharedDirectoryNotice: {
    lead: "This folder template doesn't create a separate folder per movie, so shared directory mode applies. The recommended default is ",
    tail: "; if you do want a shared directory, the related naming rules are validated on save.",
  },
  testFailed: (error: string) => `Test failed: ${error}`,
  verifying: "Verifying…",
  verifyTranslation: "Verify metadata translation",
  waitForAutosave: "Wait for autosave to finish before restarting the app",
  relaunchFailed: (error: string) => `Restart failed: ${error}`,
  relaunchApp: "Restart app",
  metadataOnlyNotice: "Metadata only mode is on; moving and renaming videos is disabled.",
  metadataPathRequired: "A metadata output directory is required when metadata only mode is on",
  sitePriority: {
    options: {
      dmm_family: {
        label: "DMM/FANZA family",
        description:
          "Official DMM/FANZA store and streaming sources, the authoritative source for mainstream Japanese AV; titles, labels and covers are highly reliable, but affected by region, login/age checks and delistings.",
      },
      official: {
        label: "Official studio sites",
        description:
          "Studio and label sites such as MGStage, Prestige, Faleno, Dahlia and KM Produce. Good for their own titles, with narrow coverage; success varies widely by site and code.",
      },
      [Website.AVBASE]: {
        label: "avbase",
        description:
          "Aggregator with broad field coverage; titles, plots, actors and images are usually complete. A good general primary source.",
      },
      [Website.R18_DEV]: { label: "R18.dev", description: "R18.dev JSON metadata source, with fewer images." },
      [Website.AVWIKIDB]: {
        label: "avwikidb",
        description:
          "Community-curated database, good for filling in plots, tags and release info; may be region-restricted or return 403 on some networks.",
      },
      [Website.JAVDB]: {
        label: "javdb",
        description:
          "Aggregator that is strong at covers, scene images and trailers; may be region-restricted, configure a cookie if needed.",
      },
      [Website.JAVBUS]: {
        label: "javbus",
        description:
          "Aggregator with usually stable covers and sample images; some networks hit an age check, configure a cookie if needed.",
      },
      [Website.JAV321]: {
        label: "jav321",
        description:
          "Search-based aggregator, useful as an extra fallback; field completeness and stability are usually lower than the main aggregators.",
      },
      h0930_family: {
        label: "H0930 / H4610",
        description: "Self-run independent production sites that use their own codes (e.g. H0930/H4610).",
      },
      [Website.FC2]: {
        label: "fc2",
        description:
          "Official FC2 product pages; seller names and release info are highly reliable. Good for FC2 codes, but can't handle delisted titles.",
      },
      [Website.FC2HUB]: {
        label: "fc2hub",
        description:
          "FC2 aggregator that actively fills in titles, runtime and ratings; one of the main sources for FC2 codes.",
      },
      [Website.PPVDATABANK]: {
        label: "ppvdatabank",
        description:
          "FC2 supplementary database, often used to backfill seller, date, cover and sample images; a good FC2 fallback.",
      },
      [Website.SOKMIL]: {
        label: "sokmil",
        description: "Supplements gravure and specific streaming content; not recommended as a general primary source.",
      },
      [Website.KINGDOM]: {
        label: "kingdom",
        description:
          "Official Kingdom group site, good for specific titles from Empress, Princess, Queen, Kingdom, bambini, etc.; low general coverage.",
      },
      [Website.FANTIA]: {
        label: "fantia",
        description: "Official Fantia site, good for Fantia codes; low general coverage.",
      },
    },
    partiallyEnabled: (enabled: number, total: number) => `${enabled}/${total} enabled`,
    enabledSummary: (enabled: number, total: number) => `Enabled ${enabled}/${total}`,
    r18Language: "R18.dev metadata language",
    r18Languages: { ja: "Japanese", en: "English" } as Record<R18MetadataLanguage, string>,
    eyebrow: "Scrape sites",
    hint: "Check sites to enable them; move them up or down to set priority.",
    connectivityTitle: "Site connectivity",
    connectivityHint: "Checks enabled sites using the current network, proxy and cookie settings.",
  },
  aggregationPriority: {
    candidatesSummary: (enabled: number, total: number) => `Candidates ${enabled}/${total}`,
    eyebrow: "Field aggregation",
    hint: "Check the sites that take part in aggregation and set their order; unlisted sites fill in after these candidates.",
  },
  editorDialog: {
    edit: "Edit",
    close: "Close",
    applyOrder: "Apply order changes",
    done: "Done",
  },
  connectivity: {
    status: { idle: "", loading: "Checking", success: "OK", error: "Error" },
    notChecked: "Site connectivity not checked yet",
    configChanged: "Settings changed; check again",
    checking: "Checking site connectivity",
    waitForAutosave: "Wait for autosave to finish before testing",
    test: "Test",
  },
  autoSave: {
    validationFailed: "Validation failed",
    saveFailed: "Save failed",
    fieldSaveFailed: (field: string, error: string) => `Failed to save ${field}: ${error}`,
    fieldReset: (field: string) => `${field} was reset to default`,
    undo: "Undo",
    resetFailed: "Failed to reset to default",
    fieldResetFailed: (field: string, error: string) => `Failed to reset ${field}: ${error}`,
  },
  configValidation: {
    failed: (details: string[]) =>
      details.length > 0 ? `Configuration validation failed: ${details.join("; ")}` : "Configuration validation failed",
    detail: (field: string, message: string) => `${field}: ${message}`,
    issues: {
      actorAliasListEmpty: "Actor alias list cannot be empty",
      actorCanonicalNameEmpty: "Canonical actor name cannot be empty",
      actorAliasListNoValidAlias: "Actor alias list requires at least one valid alias",
      actorAliasEmpty: "Actor alias cannot be empty",
      actorAliasConflict: "Actor name conflicts with another alias group",
      globalTimeoutNotGreater: "Global timeout must be greater than per-crawler timeout",
      metadataPathNotAbsolute: "Metadata output directory must be an absolute path",
      sharedDirectoryAssetNaming: "In shared directory mode, asset naming must follow movie filename",
      sharedDirectoryNfoNaming: 'In shared directory mode, NFO naming must be "<filename>.nfo only"',
      sharedDirectorySceneImages:
        "Downloading scene images is not supported in shared directory mode; please disable scene image downloads",
      optionalSegmentPathSeparator:
        "Optional segments [] cannot contain path separators; use optional segments only within a single path component",
      jellyfinUserIdNotUuid: "Jellyfin user ID must be a UUID, or leave empty for server default",
    } satisfies Record<ConfigIssueCode, string> as Record<string, string | undefined>,
  },
  subsections: {
    scrapeSites: "Scrape sites",
    scrapeSitesDescription: "Enabled sites and priority",
    scrapePacing: "Scrape pacing",
    filenameFiltering: "File filtering",
    proxyAndRequests: "Proxy and requests",
    siteAccess: "Site access",
    assetDownloads: "Asset downloads",
    interface: "Interface",
    shortcuts: "Shortcuts",
    advanced: "Advanced settings",
    sharedPersonSources: "Shared person sources",
    sharedPersonSourcesHint:
      "Used by both Jellyfin and Emby. The person biography comes from the first source in order that meets the quality bar.",
  },
  profiles: {
    menuTitle: "Profiles",
    currentProfile: "Current profile",
    create: "New profile",
    importMenu: "Import profile…",
    exportMenu: "Export current profile…",
    deleteMenu: "Delete profile…",
    resetDefaults: "Restore defaults",
    resetDescriptionLead: "This resets ",
    resetDescriptionTail: " to the default settings. This can't be undone.",
    confirmReset: "Restore",
    createDescription: "Enter a name to create a new profile from the default settings.",
    namePlaceholder: "Profile name",
    createAction: "Create",
    deleteTitle: "Delete profile",
    deleteDescription: "Only inactive profiles can be deleted. Deleting a profile removes its settings file.",
    selectProfile: "Select a profile",
    importTitle: "Import profile",
    importDescription:
      "Choose an exported settings file (TOML or JSON), then import it as a new profile or overwrite an existing one.",
    importFilePlaceholder: "Choose a TOML/JSON file",
    sourceFile: "Source file",
    chooseFile: "Choose file",
    importMode: "Import mode",
    importAsNew: "New profile",
    importOverwrite: "Overwrite existing",
    profileName: "Profile name",
    importNamePlaceholder: "Name the imported profile",
    overwriteTarget: "Overwrite target",
    selectOverwriteTarget: "Select the profile to overwrite",
    activeProfileRefreshHint: "The active profile is refreshed with the new content as soon as the import finishes.",
    importAction: "Import",
  },
  layout: {
    title: "Settings",
    matchCount: (count: number) => `${count} match${count === 1 ? "" : "es"}`,
    showingAdvanced: "Showing advanced settings",
    showAdvanced: "Show advanced settings",
    hideAdvanced: "Hide advanced settings",
    searchPlaceholder: "Search settings",
    clearSearch: "Clear search",
    noMatches: "No matching settings",
  },
  crossField: {
    incomplete: (count: number) => `${count} setting${count === 1 ? "" : "s"} incomplete`,
    focus: "Focus",
  },
  resetToDefault: {
    title: "Reset to default",
    ariaLabel: (field: string) => `Reset ${field} to default`,
  },
};
