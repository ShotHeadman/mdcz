import { DEFAULT_LLM_BASE_URL } from "@mdcz/shared/llm";
import type { FieldAnchor, FieldKey } from "@mdcz/shared/settingsRegistry";

export interface FieldText {
  label: string;
  description?: string;
  /** Extra search terms; settings search matches the text of every locale. */
  aliases?: string[];
}

export interface SectionText {
  label: string;
  aliases?: string[];
}

const PRIORITY_ALIASES = ["aggregation", "priority"];

const sections: Record<FieldAnchor, SectionText> = {
  paths: {
    label: "Library & output",
    aliases: [
      "path",
      "paths",
      "folder",
      "directory",
      "directories",
      "media",
      "output",
      "move",
      "rename",
      "behavior",
      "file",
    ],
  },
  scrape: { label: "Scraping", aliases: ["scrape", "crawler", "site", "sites", "source", "sources", "rate", "limit"] },
  network: { label: "Network", aliases: ["network", "proxy", "cookie", "retry", "timeout"] },
  translate: { label: "Translation", aliases: ["translate", "translation", "translator", "llm", "language"] },
  naming: { label: "Naming", aliases: ["naming", "name", "template", "rule", "rules"] },
  download: { label: "Downloads", aliases: ["download", "asset", "poster", "fanart", "nfo"] },
  mediaServer: { label: "Media servers", aliases: ["media server", "jellyfin", "emby", "person", "actor"] },
  system: { label: "Interface & shortcuts", aliases: ["system", "ui", "interface", "shortcut", "hotkey"] },
};

const fields: Record<FieldKey, FieldText> = {
  "watch.enabled": {
    label: "Automatically scrape new media",
    description:
      "Server only. Watch the media directory. Files already present when a directory is first watched become the baseline and require manual scraping; files added while the server is stopped are picked up after it restarts.",
  },
  "watch.intervalMinutes": {
    label: "Scan interval (minutes)",
    description: "New files are submitted after their size and modification time remain unchanged across two scans.",
  },
  "translate.deeplApiKey": {
    label: "DeepL API key",
    description: "Free keys ending in :fx use the Free API; other keys use the Pro API.",
  },
  "translate.baiduService": {
    label: "Baidu translation service",
    description:
      "Enable the service on the Baidu Translate Open Platform first. General text translation uses the secret key; LLM text translation uses an API key.",
  },
  "translate.baiduAppId": {
    label: "Baidu translation APPID",
    description: "Shown on the Developer Information page of the Baidu Translate Open Platform.",
  },
  "translate.baiduSecretKey": {
    label: "Baidu translation secret key",
    description: "Shown on the Developer Information page.",
  },
  "translate.baiduApiKey": {
    label: "Baidu translation API key",
    description: "Create it under API Key Management in the console.",
  },
  "paths.mediaPath": { label: "Media directory", aliases: ["media", "library"] },
  "paths.defaultScanExcludeDirs": {
    label: "Excluded directories",
    description: "These folders are skipped automatically when scanning the library.",
    aliases: ["scan exclude", "exclude dirs"],
  },
  "behavior.successFileMove": {
    label: "Move videos and subtitles",
    description:
      "After a successful scrape, move videos and subtitles into the output directory; when off, they stay where they are.",
  },
  "paths.successOutputFolder": {
    label: "Output directory",
    description:
      "Where moved files are stored. Absolute or relative paths are supported (empty keeps them under the media directory).",
    aliases: ["output", "success"],
  },
  "behavior.successFileRename": {
    label: "Rename videos and subtitles",
    description: "Rename videos and subtitles using the naming rules; when off, original file names are kept.",
  },
  "behavior.metadataOnly": {
    label: "Metadata only",
    description:
      "Leave the original videos in place and export posters and NFO files to a separate directory as an archive. The directory contains no videos, so media servers cannot use it as a library.",
    aliases: ["metadata", "only", "read-only", "archive"],
  },
  "paths.metadataPath": {
    label: "Metadata output directory",
    description: "Directory that stores NFO files and posters.",
    aliases: ["metadata", "sidecar"],
  },
  "paths.actorPhotoFolder": {
    label: "Local actor photo directory",
    description:
      "Only read when “Local” is enabled in the person photo source order; used for local photo overrides and media server photo sync.",
    aliases: ["actor", "photo"],
  },
  "paths.sceneImagesFolder": { label: "Scene image folder name" },
  "paths.outputSummaryPath": {
    label: "Overview statistics directory",
    description: "Leave empty to use the output directory.",
    aliases: ["summary", "overview"],
  },
  "paths.configDirectory": { label: "Configuration directory", aliases: ["config", "profile"] },
  "scrape.sites": {
    label: "Enabled sites & priority",
    description:
      "Sites are grouped into the DMM/FANZA family, official studio sites and common aggregators; the saved value stays a concrete site order.",
    aliases: [
      "site priority",
      "order",
      "DMM",
      "FANZA",
      "DMM TV",
      "MGStage",
      "Prestige",
      "Faleno",
      "Dahlia",
      "KM Produce",
      "Sokmil",
      "Kingdom",
      "JavDB",
      "JavBus",
      "Jav321",
      "AVBase",
      "FC2",
      "FC2Hub",
      "H0930",
      "H4610",
      "PPVDataBank",
      "R18.dev",
      "AVWikiDB",
    ],
  },
  "scrape.r18MetadataLanguage": { label: "R18.dev metadata language" },
  "scrape.filenameIgnoreTokens": {
    label: "Code detection ignore words",
    description:
      "Ignored before detecting the movie code; only affects detection and never renames files. Add with Enter, comma or space.",
  },
  "scrape.filenameBlacklistTokens": {
    label: "Auto-scan blacklist words",
    description:
      "Files and folders (with everything inside) whose names contain these words are excluded from automatic scans; matching is case-insensitive. Add with Enter, comma or space.",
  },
  "scrape.minVideoSizeMb": {
    label: "Minimum video size (MB)",
    description:
      "Videos smaller than this size are excluded from scraping candidates. 0 means no limit; STRM files are unaffected.",
  },
  "scrape.threadNumber": { label: "Concurrent threads" },
  "scrape.javdbDelaySeconds": { label: "JavDB request delay (s)" },
  "scrape.restAfterCount": { label: "Pause after consecutive scrapes (items)" },
  "scrape.restDuration": { label: "Pause duration" },
  "network.proxyType": { label: "Proxy type" },
  "network.proxy": { label: "Proxy address" },
  "network.useProxy": { label: "Use proxy" },
  "network.timeout": { label: "Timeout (s)" },
  "network.retryCount": { label: "Retry count" },
  "network.javdbUrl": {
    label: "JavDB URL",
    description: "Leave empty to use https://javdb.com. Enter a mirror address if the official site is blocked.",
    aliases: ["mirror", "domain", "javdb", "url"],
  },
  "network.javbusUrl": {
    label: "JavBus URL",
    description: "Leave empty to use https://www.javbus.com. Enter a mirror address if the official site is blocked.",
    aliases: ["mirror", "domain", "javbus", "url"],
  },
  "network.javdbCookie": { label: "JavDB Cookie", aliases: ["cookie", "javdb", "credentials"] },
  "network.javbusCookie": { label: "JavBus Cookie", aliases: ["cookie", "javbus", "credentials"] },
  "network.fantiaCookie": { label: "Fantia Cookie", aliases: ["cookie", "fantia", "credentials"] },
  "aggregation.fieldPriorities.title": {
    label: "Title source order",
    description: "Pick the movie title by site order.",
    aliases: [...PRIORITY_ALIASES, "title", "field source"],
  },
  "aggregation.fieldPriorities.plot": {
    label: "Plot source order",
    description: "Pick the movie plot by site order.",
    aliases: [...PRIORITY_ALIASES, "plot", "summary"],
  },
  "aggregation.fieldPriorities.actors": {
    label: "Actor source order",
    description: "Pick the actor list by site order.",
    aliases: [...PRIORITY_ALIASES, "actors", "cast"],
  },
  "aggregation.fieldPriorities.genres": {
    label: "Genre source order",
    description: "Pick genres and tags by site order.",
    aliases: [...PRIORITY_ALIASES, "genres", "tags"],
  },
  "aggregation.fieldPriorities.thumb_url": {
    label: "Thumbnail source order",
    description: "Pick the landscape thumbnail by site order.",
    aliases: [...PRIORITY_ALIASES, "thumb", "thumbnail"],
  },
  "aggregation.fieldPriorities.poster_url": {
    label: "Poster source order",
    description: "Pick the poster by site order.",
    aliases: [...PRIORITY_ALIASES, "poster", "cover"],
  },
  "aggregation.fieldPriorities.scene_images": {
    label: "Scene image source order",
    description: "Pick the scene image set by site order.",
    aliases: [...PRIORITY_ALIASES, "scene images", "extrafanart"],
  },
  "aggregation.fieldPriorities.studio": {
    label: "Studio source order",
    description: "Pick studio information by site order.",
    aliases: [...PRIORITY_ALIASES, "studio", "maker"],
  },
  "aggregation.fieldPriorities.director": {
    label: "Director source order",
    description: "Pick director information by site order.",
    aliases: [...PRIORITY_ALIASES, "director"],
  },
  "aggregation.fieldPriorities.publisher": {
    label: "Publisher source order",
    description: "Pick publisher information by site order.",
    aliases: [...PRIORITY_ALIASES, "publisher", "label"],
  },
  "aggregation.fieldPriorities.series": {
    label: "Series source order",
    description: "Pick series information by site order.",
    aliases: [...PRIORITY_ALIASES, "series"],
  },
  "aggregation.fieldPriorities.release_date": {
    label: "Release date source order",
    description: "Pick the release date by site order.",
    aliases: [...PRIORITY_ALIASES, "release date", "date"],
  },
  "aggregation.fieldPriorities.durationSeconds": {
    label: "Duration source order",
    description: "Pick the movie duration by site order.",
    aliases: [...PRIORITY_ALIASES, "duration", "runtime"],
  },
  "aggregation.fieldPriorities.rating": {
    label: "Rating source order",
    description: "Pick the rating by site order.",
    aliases: [...PRIORITY_ALIASES, "rating", "score"],
  },
  "aggregation.fieldPriorities.trailer_url": {
    label: "Trailer source order",
    description: "Pick the trailer URL by site order.",
    aliases: [...PRIORITY_ALIASES, "trailer", "preview"],
  },
  "aggregation.maxParallelCrawlers": {
    label: "Parallel sites per aggregation",
    description: "Maximum number of sites queried at the same time when aggregating one movie.",
    aliases: ["aggregation", "parallel crawler"],
  },
  "aggregation.perCrawlerTimeoutMs": {
    label: "Per-site timeout (ms)",
    description: "Longest wait allowed for a single site during aggregation.",
    aliases: ["aggregation", "timeout", "single crawler timeout"],
  },
  "aggregation.globalTimeoutMs": {
    label: "Global timeout (ms)",
    description: "Total time allowed to aggregate one movie; must be greater than the per-site timeout.",
    aliases: ["aggregation", "timeout", "global timeout"],
  },
  "download.downloadThumb": { label: "Download landscape thumbnail" },
  "download.downloadPoster": { label: "Download poster" },
  "download.tagBadges": {
    label: "Add tag badges to posters",
    description:
      "Add badges based on the movie's existing tags; badge types and corner are configurable. Only newly downloaded posters are processed.",
    aliases: ["badge", "badges", "mark", "corner"],
  },
  "download.tagBadgeTypes": {
    label: "Badge types",
    description:
      "Built-in badge types allowed to render. Unselected types are never drawn on posters, even when detected.",
    aliases: [
      "badge types",
      "badge filters",
      "subtitle",
      "censored",
      "umr",
      "leak",
      "uncensored",
      "fullhd",
      "1080p",
      "2160p",
      "4k",
      "8k",
    ],
  },
  "download.tagBadgePosition": {
    label: "Badge position",
    description: "Multiple badges are stacked in order in the same corner.",
    aliases: ["badge position", "corner", "top left", "top right", "bottom left", "bottom right"],
  },
  "download.tagBadgeImageOverrides": {
    label: "Custom badge images",
    description:
      "When on, matching images from the watermark folder in the user data directory replace built-in badges.",
    aliases: ["watermark", "badge image", "custom badge", "poster badge image"],
  },
  "download.downloadFanart": { label: "Download fanart" },
  "download.downloadSceneImages": { label: "Download scene images" },
  "download.downloadTrailer": { label: "Download trailer" },
  "download.sceneImageConcurrency": {
    label: "Scene image download concurrency",
    description: "Only affects concurrent scene image downloads; has no effect when “Download scene images” is off.",
    aliases: ["scene images", "download concurrency", "parallel"],
  },
  "download.generateNfo": { label: "Generate NFO", aliases: ["nfo", "metadata file"] },
  "download.nfoNaming": { label: "NFO file naming", aliases: ["nfo", "naming", "metadata file"] },
  "download.nfoIgnoreFields": {
    label: "Excluded NFO fields",
    description:
      "Optional fields that are not written to NFO files; core fields such as title, code and actors are always kept. Leave empty to write all optional fields.",
    aliases: [
      "nfo",
      "metadata file",
      "num",
      "number",
      "plot",
      "release",
      "runtime",
      "technical",
      "rating",
      "studio",
      "director",
      "publisher",
      "series",
      "genres",
      "tags",
      "poster",
      "thumb",
      "fanart",
      "sceneImages",
      "trailer",
      "source",
    ],
  },
  "download.keepThumb": { label: "Keep existing thumbnail" },
  "download.keepPoster": { label: "Keep existing poster" },
  "download.keepFanart": { label: "Keep existing fanart" },
  "download.keepSceneImages": { label: "Keep existing scene images" },
  "download.keepTrailer": { label: "Keep existing trailer" },
  "download.keepNfo": { label: "Keep existing NFO" },
  "naming.folderTemplate": { label: "Folder template", aliases: ["template", "folder naming"] },
  "naming.fileTemplate": { label: "File name template", aliases: ["template", "file naming"] },
  "titleRepair.enabled": {
    label: "Restore masked words in titles and plots",
    description:
      "Restore censorship symbols (●, 〇, etc.) in official titles and plots to the original words (e.g. 「催●」 → 「催眠」, 「●っ払う」 → 「酔っ払う」) before translation; the original title is still kept in the NFO.",
    aliases: ["title repair", "masked title", "masked plot"],
  },
  "titleRepair.stripTrailingActors": {
    label: "Remove actor names from title end",
    description:
      'Some sites append actor names to the title (e.g. "… Yua Mikami"); when enabled they are removed based on the movie\'s actor list.',
    aliases: ["title actors", "actress name"],
  },
  "naming.assetNamingMode": {
    label: "Asset file naming",
    description: "File name rule for posters, thumbnails, fanart and trailers.",
  },
  "naming.nfoTitleTemplate": {
    label: "NFO title template",
    description: "Format of the NFO title field. Available placeholders: {number} {title} {originaltitle}",
  },
  "naming.actorNameMax": { label: "Maximum actor names" },
  "naming.actorNameMore": { label: "Suffix for extra actors" },
  "naming.actorFallbackToStudio": {
    label: "Use studio or seller when no actors",
    description:
      "When on, {actor} falls back to the studio or seller name if there are no actors; use {actorFallbackPrefix}{actor} in templates to show the source.",
  },
  "naming.releaseRule": { label: "Release date format" },
  "naming.folderNameMax": { label: "Maximum folder name length" },
  "naming.fileNameMax": { label: "Maximum file name length" },
  "naming.cnwordStyle": { label: "Chinese subtitle marker" },
  "naming.umrStyle": { label: "UMR marker" },
  "naming.leakStyle": { label: "Leak marker" },
  "naming.uncensoredStyle": { label: "Uncensored marker" },
  "naming.censoredStyle": { label: "Censored marker" },
  "naming.partStyle": {
    label: "Part style",
    description: "Keep the original suffix of multi-part videos, or rewrite it as CD / PART / DISC.",
  },
  "aggregation.behavior.preferLongerPlot": {
    label: "Prefer longer plot",
    description: "When several sites provide a plot, prefer the most informative one.",
    aliases: ["aggregation", "plot", "prefer longer"],
  },
  "aggregation.behavior.maxSceneImages": {
    label: "Maximum scene images",
    description: "Upper limit of scene images kept after aggregation.",
    aliases: ["aggregation", "scene images", "max"],
  },
  "aggregation.behavior.maxActors": {
    label: "Maximum actors",
    description: "Upper limit of actors kept after aggregation.",
    aliases: ["aggregation", "actors", "max"],
  },
  "aggregation.behavior.maxGenres": {
    label: "Maximum tags",
    description: "Upper limit of genres or tags kept after aggregation.",
    aliases: ["aggregation", "genres", "tags"],
  },
  "translate.enableTranslation": {
    label: "Translate content",
    description:
      "Classic machine translation (DeepL, Baidu) is limited in quality, so an LLM is recommended; you can also leave this off and translate NFOs with another tool later.",
  },
  "translate.fields": {
    label: "Fields to translate",
    description: "Only the selected fields are translated; the rest keep the original text.",
    aliases: ["translation scope"],
  },
  "translate.engine": { label: "Translation engine", aliases: ["translator", "translation"] },
  "translate.llmModelName": { label: "LLM model name", aliases: ["model", "openai", "llm"] },
  "translate.llmApiKey": {
    label: "LLM API key (optional)",
    description:
      "Usually required for the default OpenAI endpoint; whether local or compatible services need a key depends on the server.",
    aliases: ["api key", "token", "openai key"],
  },
  "translate.llmBaseUrl": {
    label: "LLM API URL",
    description: `Default: ${DEFAULT_LLM_BASE_URL}. Google Gemini example: https://generativelanguage.googleapis.com/v1beta/openai. Local example: Ollama uses http://127.0.0.1:11434/v1`,
    aliases: ["base url", "endpoint"],
  },
  "translate.llmApiFormat": { label: "Request format" },
  "translate.llmServiceType": {
    label: "Service type",
    description: "Custom proxies must select Google or DeepSeek explicitly; the URL domain is not used for detection.",
  },
  "translate.llmPrompt": { label: "LLM translation prompt", aliases: ["prompt"] },
  "translate.llmTemperature": {
    label: "LLM temperature (advanced, optional)",
    description: "Leave empty to use the server default.",
  },
  "translate.llmReasoning": { label: "LLM reasoning effort", aliases: ["reasoning", "thinking"] },
  "translate.llmOutputFormat": {
    label: "Output format",
    description:
      "Prompt JSON omits structured output parameters; metadata translation always requests JSON and validates it locally.",
  },
  "translate.llmTimeout": { label: "LLM request timeout (s)" },
  "translate.llmMaxRetries": { label: "LLM max retries" },
  "translate.llmMaxRequestsPerSecond": { label: "LLM max requests per second" },
  "translate.targetLanguage": { label: "Target language", aliases: ["language", "locale"] },
  "personSync.personOverviewSources": { label: "Person overview source order" },
  "personSync.personImageSources": { label: "Person photo source order" },
  "jellyfin.url": { label: "Jellyfin server URL", aliases: ["media server", "jellyfin", "server"] },
  "jellyfin.apiKey": { label: "Jellyfin API Key" },
  "jellyfin.userId": {
    label: "Jellyfin user ID",
    description: "Must be a UUID. Used to read the person list; leave empty to use the server default.",
  },
  "jellyfin.refreshPersonAfterSync": {
    label: "Refresh people after sync",
    description: "After syncing overviews or photos, also ask Jellyfin to refresh person metadata and images.",
  },
  "jellyfin.lockOverviewAfterSync": {
    label: "Lock person overview after sync",
    description:
      "After writing the overview, add Overview to LockedFields so Jellyfin metadata refreshes are less likely to overwrite it.",
  },
  "emby.url": { label: "Emby server URL", aliases: ["media server", "emby", "server"] },
  "emby.apiKey": { label: "Emby API Key" },
  "emby.userId": {
    label: "Emby user ID",
    description: "Used to read the person list; leave empty to use the server default.",
  },
  "emby.refreshPersonAfterSync": {
    label: "Refresh people after sync",
    description: "After syncing overviews or photos, also ask Emby to refresh person metadata and images.",
  },
  "shortcuts.startOrStopScrape": {
    label: "Start/stop scraping",
    description: "Example: S",
    aliases: ["hotkey", "shortcut"],
  },
  "shortcuts.retryScrape": { label: "Scrape again", description: "Example: R" },
  "shortcuts.openFolder": { label: "Open containing folder", description: "Example: F" },
  "shortcuts.editNfo": { label: "Edit NFO", description: "Example: E" },
  "shortcuts.playVideo": { label: "Play video", description: "Example: P" },
  "ui.showLogsPanel": { label: "Show log panel", aliases: ["logs", "log panel"] },
  "ui.useCustomTitleBar": {
    label: "Use custom title bar",
    description: "Requires restarting the app after switching.",
    aliases: ["title bar", "window chrome"],
  },
  "ui.hideDock": { label: "Hide Dock icon" },
  "ui.hideMenu": { label: "Hide menu bar" },
  "ui.hideWindowButtons": { label: "Hide window buttons" },
};

export const settingsFields = {
  sections,
  fields,
  llmReasoningDescription: {
    google:
      "Reasoning fields are omitted by default. Gemini 2.5 Pro and the Gemini 3 series cannot disable reasoning; other models are validated by the server.",
    deepseek:
      "The toggle and effort are omitted by default; enable to use the server's default effort, or pick low / high / max. Temperature has no effect in thinking mode.",
    default:
      "Reasoning fields are omitted by default; whether disabling or a specific effort is available is validated by the model and server.",
  },
  search: {
    filterByGroup: (group: string) => `Filter by group: ${group}`,
    modifiedTokenHint: "Only show settings that differ from their defaults",
    groupTokenHint: "Filter by group, e.g. @group:network",
  },
  quote: (label: string) => `“${label}”`,
};
