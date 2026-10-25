import type { AutomationLevel, DiscoveryMode, MediaLibraryIssueCode, PlacementMode } from "@mdcz/shared/mediaLibrary";

export const libraries = {
  title: "Libraries",
  description:
    "A library defines where incoming videos arrive, where organized movies go with naming templates, and placement rules. Scrapes publish into a library.",
  add: "Add library",
  createFirst: "Create your first library",
  createFirstDescription: "Set up source and output directories where finished movies are organized.",
  importExisting: "I already have a library",
  importExistingDescription:
    "Point MDCz at a directory that already holds videos and NFOs. It reads what is there; nothing is moved or rewritten.",
  importTitle: "Import an existing library",
  importSave: "Save and import",
  health: {
    title: "Health",
    movies: (count: number) => `${count} movies indexed`,
    notImported: "This library has not been indexed yet. Import it to check for missing metadata and assets.",
    import: "Import now",
    view: "View",
    pending: (count: number) => `${count} waiting in the pending list`,
    allGood: "All metadata and assets are complete.",
  },
  edit: "Edit",
  delete: "Delete",
  deleteTitle: (name: string) => `Delete library "${name}"?`,
  deleteDescription: "Only removes library settings and watch state; files and NFOs stay untouched.",
  loadFailed: (error: string) => `Could not load libraries: ${error}`,
  editorCreateTitle: "New library",
  editorEditTitle: "Edit library",
  save: "Save",
  fields: {
    name: "Name",
    sourcePath: "Source directory",
    sourcePathHint: "Where new videos arrive, for example the download directory or a cloud drive mount.",
    importSourcePathHint: "The directory that already holds your videos and NFOs.",
    outputPath: "Output directory",
    outputPathHint: "Where finished movies and their metadata go. Point your media server at this directory.",
    placement: "Placement",
    folderTemplate: "Folder template",
    fileTemplate: "File name template",
    automation: "Automation",
    discovery: "Discovery",
    cloudPath: "CloudDrive2 path",
    cloudPathHint: "This library's root as CloudDrive2 names it, for example /115/Downloads.",
    scanIntervalMinutes: "Full rescan interval (minutes)",
    scanIntervalHint: "Catches what change events miss, such as network mounts that send none.",
  },
  placements: {
    move: {
      label: "Move",
      description:
        "Move videos into the output directory, renamed by the templates. Videos in the polled qBittorrent category are hardlinked instead, so they keep seeding.",
    },
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
      label: "STRM stub (.strm)",
      description:
        "Keep videos where they are (local or cloud); write a .strm stub file pointing to each video beside the metadata in the output directory. The media server must access videos at the same path as MDCz.",
    },
    metadataOnly: {
      label: "Metadata only",
      description:
        "Keep videos in place and export only NFOs and images to the output directory for archiving (the output directory contains no video files, so media servers cannot play them).",
    },
    inPlace: {
      label: "In-place",
      description:
        "Keep videos in place with original names and write metadata alongside them. No output directory needed.",
    },
  } satisfies Record<PlacementMode, { label: string; description: string }>,
  automationLevels: {
    off: { label: "Off", description: "Only scrapes you start." },
    register: {
      label: "Register only",
      description: "New files are added to the pending queue for manual review and scraping.",
    },
    scrape: {
      label: "Register and scrape",
      description: "Automatically scrape new files as soon as downloading or transfer finishes.",
    },
  } satisfies Record<AutomationLevel, { label: string; description: string }>,
  discoveryModes: {
    events: { label: "Local change events", description: "Watch the source directory for file system events." },
    clouddrive: {
      label: "CloudDrive2 webhook",
      description: "CloudDrive2 reports changes to MDCz; set its file system watcher to POST to the webhook below.",
    },
  } satisfies Record<DiscoveryMode, { label: string; description: string }>,
  baselineNotice:
    "When automation is first enabled, existing files in the source directory are recorded as a baseline and will not be scraped automatically. Scrape them manually from the workbench.",
  issues: {
    libraryPathNotAbsolute: "Enter an absolute path",
    libraryOutputRequired: "This placement needs an output directory",
    libraryOutputOverlapsSource: "The output directory cannot overlap with or be inside the source directory",
    libraryCloudPathInvalid: "Enter the library root as a CloudDrive2 path starting with /",
    optionalSegmentPathSeparator: "Optional segments [] cannot contain path separators",
  } satisfies Record<MediaLibraryIssueCode, string> as Record<string, string | undefined>,
  card: {
    source: "Source",
    output: "Output",
    noOutput: "Alongside videos",
    automationOff: "Manual",
    cloudDriveLastEvent: (time: string | null) =>
      time
        ? `Last CloudDrive2 event for this library: ${time}`
        : "No CloudDrive2 event for this library since MDCz started. Check the webhook and the cloud path.",
  },
  stubSourceHint:
    "This source holds .strm stubs. Choose In-place: metadata is written beside each stub and stubs stay where a STRM helper expects them.",
};
