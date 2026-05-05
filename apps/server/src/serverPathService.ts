import { constants, type Dirent, type Stats } from "node:fs";
import { access, lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { Configuration } from "@mdcz/shared/config";
import type {
  ServerPathSuggestInput,
  ServerPathSuggestionEntryDto,
  ServerPathSuggestResponse,
} from "@mdcz/shared/serverDtos";
import { serverPathSuggestInputSchema } from "@mdcz/shared/serverDtos";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";

const MAX_ENTRIES = 100;
const WINDOWS_DRIVE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const POSIX_DISCOVERY_ROOTS = ["/home", "/mnt", "/media", "/Users", "/Volumes"];

export interface ServerPathFs {
  access(path: string): Promise<void>;
  lstat(path: string): Promise<Stats>;
  readdir(path: string): Promise<Dirent[]>;
}

export interface ServerPathServiceOptions {
  fs?: ServerPathFs;
  platform?: NodeJS.Platform;
}

const nodeFs: ServerPathFs = {
  access: async (candidate) => {
    await access(candidate, constants.R_OK);
  },
  lstat,
  readdir: async (candidate) => await readdir(candidate, { withFileTypes: true }),
};

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const hasTrailingSeparator = (value: string): boolean => /[\\/]$/u.test(value);

const hasInvalidPathBytes = (value: string): boolean => value.includes("\0");

const isRemoteUrl = (value: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//iu.test(value.trim());

const uniqueStrings = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

export class ServerPathService {
  private readonly fs: ServerPathFs;
  private readonly platform: NodeJS.Platform;
  private readonly pathApi: typeof path.win32 | typeof path.posix;

  constructor(
    private readonly mediaRoots: MediaRootService,
    private readonly config: ServerConfigService,
    options: ServerPathServiceOptions = {},
  ) {
    this.fs = options.fs ?? nodeFs;
    this.platform = options.platform ?? process.platform;
    this.pathApi = this.platform === "win32" ? path.win32 : path.posix;
  }

  async suggest(input: ServerPathSuggestInput): Promise<ServerPathSuggestResponse> {
    const parsed = serverPathSuggestInputSchema.parse(input);
    const rawPath = parsed.path.trim();

    if (hasInvalidPathBytes(rawPath) || isRemoteUrl(rawPath)) {
      return this.emptyResponse(rawPath, "", "路径不可浏览");
    }

    if (!rawPath || !this.pathApi.isAbsolute(rawPath)) {
      return {
        path: this.formatPath(rawPath),
        parentPath: "",
        exists: false,
        accessible: true,
        entries: await this.discoverRootEntries(rawPath),
      };
    }

    const normalizedPath = this.pathApi.resolve(rawPath);
    const currentStats = await this.safeLstat(normalizedPath);
    const currentIsDirectory = Boolean(currentStats?.isDirectory() && !currentStats.isSymbolicLink());
    const listTarget =
      hasTrailingSeparator(rawPath) || currentIsDirectory ? normalizedPath : this.pathApi.dirname(normalizedPath);
    const prefix = hasTrailingSeparator(rawPath) || currentIsDirectory ? "" : this.pathApi.basename(normalizedPath);
    const targetStats = currentIsDirectory ? currentStats : await this.safeLstat(listTarget);

    if (!targetStats?.isDirectory() || targetStats.isSymbolicLink()) {
      return this.emptyResponse(normalizedPath, listTarget, "目录不存在或不可访问");
    }

    const listed = await this.listDirectoryEntries(listTarget, prefix);
    return {
      path: this.formatPath(normalizedPath),
      parentPath: this.formatPath(listTarget),
      exists: Boolean(currentStats),
      accessible: listed.accessible,
      entries: listed.entries,
      error: listed.error,
    };
  }

  private async discoverRootEntries(filterText: string): Promise<ServerPathSuggestionEntryDto[]> {
    const [systemRoots, configuredRoots] = await Promise.all([
      this.discoverSystemRoots(),
      this.discoverConfiguredRoots(),
    ]);
    const normalizedFilter = filterText.trim().toLocaleLowerCase();
    return uniqueStrings([...configuredRoots, ...systemRoots])
      .map((rootPath) => this.createEntry(rootPath, this.rootLabel(rootPath)))
      .filter((entry) =>
        normalizedFilter
          ? entry.label.toLocaleLowerCase().includes(normalizedFilter) || entry.path.includes(filterText)
          : true,
      )
      .sort((left, right) => left.path.localeCompare(right.path, "zh-CN"))
      .slice(0, MAX_ENTRIES);
  }

  private async discoverSystemRoots(): Promise<string[]> {
    if (this.platform === "win32") {
      const roots = await Promise.all(
        WINDOWS_DRIVE_LETTERS.map(async (letter) => {
          const rootPath = `${letter}:/`;
          return (await this.isAccessibleDirectory(rootPath)) ? rootPath : "";
        }),
      );
      return roots.filter(Boolean);
    }

    const roots = await Promise.all(
      POSIX_DISCOVERY_ROOTS.map(async (rootPath) => ((await this.isAccessibleDirectory(rootPath)) ? rootPath : "")),
    );
    return roots.filter(Boolean);
  }

  private async discoverConfiguredRoots(): Promise<string[]> {
    const [mediaRootList, configuration] = await Promise.all([
      this.mediaRoots.list().catch(() => ({ roots: [] })),
      this.config.get().catch(() => null),
    ]);
    const configuredPathValues = configuration ? this.collectConfigPathValues(configuration) : [];
    const candidates = [
      ...mediaRootList.roots.filter((root) => root.enabled).map((root) => root.hostPath),
      ...configuredPathValues,
    ];
    const checked = await Promise.all(
      candidates.map(async (candidate) => {
        if (!this.pathApi.isAbsolute(candidate)) {
          return "";
        }
        const normalized = this.pathApi.resolve(candidate);
        return (await this.isAccessibleDirectory(normalized)) ? normalized : "";
      }),
    );
    return checked.filter(Boolean);
  }

  private collectConfigPathValues(configuration: Configuration): string[] {
    return [
      configuration.paths.mediaPath,
      configuration.paths.actorPhotoFolder,
      configuration.paths.softlinkPath,
      configuration.paths.successOutputFolder,
      configuration.paths.failedOutputFolder,
      configuration.paths.outputSummaryPath,
      configuration.paths.configDirectory,
    ].map((value) => value.trim());
  }

  private async listDirectoryEntries(
    directoryPath: string,
    prefix: string,
  ): Promise<{ accessible: boolean; entries: ServerPathSuggestionEntryDto[]; error?: string }> {
    try {
      const normalizedPrefix = prefix.toLocaleLowerCase();
      const entries = await this.fs.readdir(directoryPath);
      const suggestions: ServerPathSuggestionEntryDto[] = [];

      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          (normalizedPrefix && !entry.name.toLocaleLowerCase().startsWith(normalizedPrefix))
        ) {
          continue;
        }

        const entryPath = this.pathApi.join(directoryPath, entry.name);
        const stats = await this.safeLstat(entryPath);
        if (!stats?.isDirectory() || stats.isSymbolicLink()) {
          continue;
        }

        suggestions.push(this.createEntry(entryPath, entry.name));
        if (suggestions.length >= MAX_ENTRIES) {
          break;
        }
      }

      suggestions.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
      return { accessible: true, entries: suggestions };
    } catch (error) {
      return { accessible: false, entries: [], error: toErrorMessage(error) };
    }
  }

  private async isAccessibleDirectory(candidatePath: string): Promise<boolean> {
    const stats = await this.safeLstat(candidatePath);
    if (!stats?.isDirectory() || stats.isSymbolicLink()) {
      return false;
    }
    try {
      await this.fs.access(candidatePath);
      return true;
    } catch {
      return false;
    }
  }

  private async safeLstat(candidatePath: string): Promise<Stats | null> {
    try {
      return await this.fs.lstat(candidatePath);
    } catch {
      return null;
    }
  }

  private createEntry(absolutePath: string, label: string): ServerPathSuggestionEntryDto {
    const formattedPath = this.formatPath(this.pathApi.resolve(absolutePath));
    return {
      type: "directory",
      name: label,
      label,
      path: formattedPath,
    };
  }

  private rootLabel(rootPath: string): string {
    if (this.platform === "win32") {
      return this.formatPath(rootPath);
    }
    return rootPath;
  }

  private emptyResponse(rawPath: string, parentPath: string, error: string): ServerPathSuggestResponse {
    return {
      path: this.formatPath(rawPath),
      parentPath: this.formatPath(parentPath),
      exists: false,
      accessible: false,
      entries: [],
      error,
    };
  }

  private formatPath(value: string): string {
    if (!value) {
      return "";
    }
    return this.platform === "win32" ? value.replaceAll("\\", "/") : value;
  }
}
