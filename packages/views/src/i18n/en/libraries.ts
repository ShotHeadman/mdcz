import type { AutomationLevel, DiscoveryMode, MediaLibraryIssueCode, PlacementMode } from "@mdcz/shared/mediaLibrary";

export const libraries = {
  title: "Libraries",
  description:
    "A library is a source directory, an output directory with naming templates, and how videos get there. Scrapes publish into a library.",
  add: "Add library",
  createFirst: "Create your first library",
  createFirstDescription:
    "Before scraping, tell MDCz where videos come from and where finished movies go. You can add more libraries later.",
  edit: "Edit",
  delete: "Delete",
  deleteTitle: (name: string) => `Delete library "${name}"?`,
  deleteDescription: "Files and NFOs stay where they are; only this library's settings and watch state are removed.",
  saved: "Library saved",
  deleted: "Library deleted",
  loadFailed: (error: string) => `Could not load libraries: ${error}`,
  editorCreateTitle: "New library",
  editorEditTitle: "Edit library",
  save: "Save",
  fields: {
    name: "Name",
    sourcePath: "Source directory",
    sourcePathHint: "Where new videos arrive, for example the download directory or a cloud drive mount.",
    outputPath: "Output directory",
    outputPathHint: "Where finished movies and their metadata go. Point your media server at this directory.",
    placement: "Placement",
    folderTemplate: "Folder template",
    fileTemplate: "File name template",
    automation: "Automation",
    discovery: "Discovery",
    cloudPath: "CloudDrive2 path",
    cloudPathHint: "This library's root as CloudDrive2 names it, for example /115/Downloads.",
    scanIntervalMinutes: "Full rescan every (minutes)",
    scanIntervalHint: "Catches what change events miss, such as network mounts that send none.",
  },
  placements: {
    move: { label: "Move", description: "Move videos into the output directory, renamed by the templates." },
    hardlink: {
      label: "Hardlink",
      description:
        "Add a hardlink in the output directory and keep the source, so torrents keep seeding. Both directories must be on the same volume.",
    },
    copy: { label: "Copy", description: "Copy videos into the output directory and keep the source." },
    symlink: {
      label: "Symlink",
      description: "Keep videos where they are; put a symbolic link next to the metadata in the output directory.",
    },
    strm: {
      label: ".strm link",
      description:
        "Keep videos on the cloud drive; write a .strm file pointing at each one, next to the metadata in the output directory.",
    },
    metadataOnly: {
      label: "Metadata only",
      description:
        "Keep videos where they are and write only NFOs and images to the output directory, as an archive media servers cannot play.",
    },
    inPlace: {
      label: "In place",
      description: "Keep videos where they are with their names; write metadata next to them. No output directory.",
    },
  } satisfies Record<PlacementMode, { label: string; description: string }>,
  automationLevels: {
    off: { label: "Off", description: "Only scrapes you start." },
    register: {
      label: "Register only",
      description: "New files appear in the pending list, waiting for you to scrape them.",
    },
    scrape: { label: "Register and scrape", description: "New files are scraped as soon as they finish arriving." },
  } satisfies Record<AutomationLevel, { label: string; description: string }>,
  discoveryModes: {
    events: { label: "Local change events", description: "Watch the source directory for file system events." },
    clouddrive: {
      label: "CloudDrive2 webhook",
      description: "CloudDrive2 reports changes to MDCz; set its file system watcher to POST to the webhook below.",
    },
  } satisfies Record<DiscoveryMode, { label: string; description: string }>,
  baselineNotice:
    "When automation is first turned on, files already in the source directory are recorded and not scraped; scrape them from the workbench.",
  issues: {
    libraryPathNotAbsolute: "Enter an absolute path",
    libraryOutputRequired: "This placement needs an output directory",
    libraryOutputOverlapsSource: "The output directory cannot be inside the source directory, or contain it",
    libraryCloudPathInvalid: "Enter the library root as a CloudDrive2 path starting with /",
    optionalSegmentPathSeparator: "Optional segments [] cannot contain path separators",
  } satisfies Record<MediaLibraryIssueCode, string> as Record<string, string | undefined>,
  card: {
    source: "Source",
    output: "Output",
    noOutput: "Next to the videos",
    automationOff: "Manual",
  },
  access: {
    title: "Downloader access",
    description:
      "Downloaders call MDCz with an API key. Keys work only for the automation endpoints, never for the web UI.",
    keyName: "Key name",
    keyNamePlaceholder: "qBittorrent",
    create: "Create key",
    created: "Copy this key now; it will not be shown again.",
    copy: "Copy",
    copied: "Copied",
    revoke: "Revoke",
    lastUsed: (value: string | null) => (value ? `Last used ${value}` : "Never used"),
    noKeys: "No API keys yet.",
    qbittorrentTitle: "qBittorrent",
    qbittorrentHint:
      'Paste into Options → Downloads → "Run external program on torrent finished". %F is the finished file or folder.',
    clouddriveTitle: "CloudDrive2",
    clouddriveHint:
      "In CloudDrive2's file system watcher, POST to this URL with the header Authorization: Bearer <API key>.",
  },
};
