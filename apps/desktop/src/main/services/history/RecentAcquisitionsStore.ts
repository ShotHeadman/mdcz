import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { app } from "electron";
import PQueue from "p-queue";
import { createThumbnailBuffer } from "./thumbnail";

export interface RecentAcquisition {
  number: string;
  title: string | null;
  actors: string[];
  lastKnownPath: string | null;
  completedAt: number;
}

export interface RecentAcquisitionRecordInput {
  number: string;
  title: string | null;
  actors: string[];
  lastKnownPath: string | null;
  posterPath?: string | null;
}

interface RecentAcquisitionsStoreLogger {
  warn(message: string): void;
}

interface RecentAcquisitionsStoreOptions {
  filePath?: string;
  thumbnailDir?: string;
  logger?: RecentAcquisitionsStoreLogger;
  now?: () => number;
  createThumbnail?: (posterPath: string) => Promise<Buffer>;
}

const MAX_RECENT_ACQUISITIONS = 50;
const RECENT_ACQUISITIONS_FILE_NAME = "recent-acquisitions.json";
const THUMBNAILS_DIR_NAME = "thumbnails";

const getUserDataPath = (): string => {
  try {
    return app.getPath("userData");
  } catch {
    return join(process.cwd(), ".tmp");
  }
};

const getDefaultStorePath = (): string => join(getUserDataPath(), RECENT_ACQUISITIONS_FILE_NAME);

const getDefaultThumbnailDir = (): string => join(getUserDataPath(), THUMBNAILS_DIR_NAME);

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";

const normalizeStringArray = (value: unknown): string[] | null => {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter((item): item is string => typeof item === "string");
};

const toThumbnailFileName = (number: string): string => `${encodeURIComponent(number).replaceAll("*", "%2A")}.webp`;

const normalizeRecentAcquisition = (value: unknown): RecentAcquisition | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<RecentAcquisition>;
  const actors = normalizeStringArray(candidate.actors);
  if (
    typeof candidate.number !== "string" ||
    candidate.number.trim().length === 0 ||
    (candidate.title !== null && typeof candidate.title !== "string") ||
    actors === null ||
    (candidate.lastKnownPath !== null && typeof candidate.lastKnownPath !== "string") ||
    typeof candidate.completedAt !== "number" ||
    !Number.isFinite(candidate.completedAt) ||
    candidate.completedAt < 0
  ) {
    return null;
  }

  return {
    number: candidate.number,
    title: candidate.title,
    actors,
    lastKnownPath: candidate.lastKnownPath,
    completedAt: Math.trunc(candidate.completedAt),
  };
};

const normalizeRecordInput = (input: RecentAcquisitionRecordInput, completedAt: number): RecentAcquisition | null => {
  if (typeof input.number !== "string" || input.number.trim().length === 0 || !Array.isArray(input.actors)) {
    return null;
  }

  return {
    number: input.number,
    title: typeof input.title === "string" ? input.title : null,
    actors: input.actors.filter((actor): actor is string => typeof actor === "string"),
    lastKnownPath: typeof input.lastKnownPath === "string" ? input.lastKnownPath : null,
    completedAt,
  };
};

export class RecentAcquisitionsStore {
  private readonly filePath: string;

  private readonly thumbnailDir: string;

  private readonly logger: RecentAcquisitionsStoreLogger;

  private readonly now: () => number;

  private readonly createThumbnail: (posterPath: string) => Promise<Buffer>;

  private readonly writeQueue = new PQueue({ concurrency: 1 });

  constructor(options: RecentAcquisitionsStoreOptions = {}) {
    this.filePath = options.filePath ?? getDefaultStorePath();
    this.thumbnailDir = options.thumbnailDir ?? getDefaultThumbnailDir();
    this.logger = options.logger ?? loggerService.getLogger("RecentAcquisitionsStore");
    this.now = options.now ?? Date.now;
    this.createThumbnail = options.createThumbnail ?? createThumbnailBuffer;
  }

  async list(): Promise<RecentAcquisition[]> {
    return await this.readRecords();
  }

  getThumbnailPath(number: string): string {
    return join(this.thumbnailDir, toThumbnailFileName(number));
  }

  async recordBatch(items: RecentAcquisitionRecordInput[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    await this.writeQueue.add(async () => {
      try {
        const existing = await this.readRecords();
        const byNumber = new Map(existing.map((item) => [item.number, item]));
        const acceptedInputs: RecentAcquisitionRecordInput[] = [];

        for (const item of items) {
          const normalized = normalizeRecordInput(item, Math.max(0, Math.trunc(this.now())));
          if (!normalized) {
            continue;
          }

          byNumber.set(normalized.number, normalized);
          acceptedInputs.push(item);
        }

        const nextRecords = this.sortAndLimit([...byNumber.values()]);
        const activeNumbers = new Set(nextRecords.map((item) => item.number));

        await this.writeThumbnails(acceptedInputs, activeNumbers);
        await this.writeRecords(nextRecords);
        await this.cleanupOrphanThumbnails(activeNumbers);
      } catch (error) {
        const message = toErrorMessage(error);
        this.logger.warn(`Failed to persist recent acquisitions: ${message}`);
      }
    });
  }

  async clear(): Promise<void> {
    await this.writeQueue.add(async () => {
      try {
        await rm(this.filePath, { force: true });
        await rm(this.thumbnailDir, { recursive: true, force: true });
      } catch (error) {
        const message = toErrorMessage(error);
        this.logger.warn(`Failed to clear recent acquisitions: ${message}`);
      }
    });
  }

  private sortAndLimit(items: RecentAcquisition[]): RecentAcquisition[] {
    return items
      .sort((left, right) => {
        const completedAtDiff = right.completedAt - left.completedAt;
        return completedAtDiff !== 0 ? completedAtDiff : left.number.localeCompare(right.number);
      })
      .slice(0, MAX_RECENT_ACQUISITIONS);
  }

  private async readRecords(): Promise<RecentAcquisition[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      const message = toErrorMessage(error);
      this.logger.warn(`Failed to read recent acquisitions store ${this.filePath}: ${message}`);
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Corrupt JSON at ${this.filePath}, returning empty recent acquisitions: ${message}`);
      return [];
    }

    if (!Array.isArray(parsed)) {
      this.logger.warn(`Invalid recent acquisitions store shape at ${this.filePath}, returning empty list`);
      return [];
    }

    return this.sortAndLimit(
      parsed.map((item) => normalizeRecentAcquisition(item)).filter((item): item is RecentAcquisition => item !== null),
    );
  }

  private async writeRecords(items: RecentAcquisition[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  }

  private async writeThumbnails(
    items: RecentAcquisitionRecordInput[],
    activeNumbers: ReadonlySet<string>,
  ): Promise<void> {
    await mkdir(this.thumbnailDir, { recursive: true });

    for (const item of items) {
      if (!activeNumbers.has(item.number)) {
        continue;
      }

      const thumbnailPath = this.getThumbnailPath(item.number);
      if (!item.posterPath) {
        await rm(thumbnailPath, { force: true }).catch(() => undefined);
        continue;
      }

      try {
        const thumbnail = await this.createThumbnail(item.posterPath);
        await writeFile(thumbnailPath, thumbnail);
      } catch (error) {
        await rm(thumbnailPath, { force: true }).catch(() => undefined);
        const message = toErrorMessage(error);
        this.logger.warn(`Failed to generate thumbnail for ${item.number}: ${message}`);
      }
    }
  }

  private async cleanupOrphanThumbnails(activeNumbers: ReadonlySet<string>): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.thumbnailDir);
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }

      const message = toErrorMessage(error);
      this.logger.warn(`Failed to list recent acquisition thumbnails: ${message}`);
      return;
    }

    const activeFileNames = new Set([...activeNumbers].map((number) => toThumbnailFileName(number)));
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".webp") && !activeFileNames.has(entry))
        .map((entry) => rm(join(this.thumbnailDir, entry), { force: true }).catch(() => undefined)),
    );
  }
}
