import { randomUUID } from "node:crypto";
import { resolveRootRelativePath } from "@mdcz/media-store";
import { notifyMediaServersOfPublish } from "@mdcz/runtime/mediaserver";
import type { NetworkClient } from "@mdcz/runtime/network";
import { NfoGenerator, writeNfoPublication } from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import { LibraryTaskConflictError, type LibraryTaskGate } from "@mdcz/runtime/tasks";
import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { LibraryEditJobDto, LibraryEditStartInput } from "@mdcz/shared/libraryEdit";
import type { TaskEventBus } from "../taskEvents";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";

export class LibraryEditService {
  #job: LibraryEditJobDto | null = null;

  constructor(
    private readonly config: ServerConfigService,
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    private readonly taskEvents: TaskEventBus,
    private readonly taskGate: LibraryTaskGate,
    private readonly networkClient: NetworkClient,
  ) {
    taskGate.track("edit", () => this.#job?.status === "running");
  }

  status(): LibraryEditJobDto | null {
    return this.#job;
  }

  async start(input: LibraryEditStartInput): Promise<LibraryEditJobDto> {
    const configuration = await this.config.get();
    if (input.edit.field !== "actors" && configuration.download.nfoIgnoreFields.includes(input.edit.field)) {
      throw new Error(`Field ${input.edit.field} is excluded by download.nfoIgnoreFields`);
    }
    this.taskGate.assertAvailable("edit");
    if (this.#job?.status === "running") throw new LibraryTaskConflictError("edit");
    const ids = [...new Set(input.ids)];
    const job: LibraryEditJobDto = {
      id: randomUUID(),
      edit: input.edit,
      status: "running",
      current: 0,
      total: ids.length,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      changed: 0,
      unchanged: 0,
      skipped: 0,
      failures: [],
      error: null,
    };
    this.#job = job;
    this.taskEvents.libraryEdit(job);
    void this.#run(job, ids, configuration);
    return job;
  }

  async #run(initial: LibraryEditJobDto, ids: string[], configuration: Configuration): Promise<void> {
    let job = initial;
    const directories = new Set<string>();
    const logger = runtimeLoggerService.getLogger("LibraryEdit");
    let lastPublished = Date.now();
    try {
      const { repositories } = await this.persistence.getState();
      const roots = await this.mediaRoots.listRoots();
      const generator = new NfoGenerator();
      for (const id of ids) {
        try {
          const entry = await repositories.library.getEntryById(id);
          const nfo = entry.assets.find((asset) => asset.kind === "nfo" && asset.rootId && asset.relativePath);
          if (!nfo?.rootId || !nfo.relativePath) {
            job = { ...job, skipped: job.skipped + 1 };
          } else {
            const root = roots.find((root) => root.id === nfo.rootId);
            if (!root) throw new Error(`Media root not found: ${nfo.rootId}`);
            const result = await writeNfoPublication({
              nfoPath: resolveRootRelativePath(root, nfo.relativePath),
              edit: job.edit,
              configuration,
              nfoNaming: "both",
              nfoGenerator: generator,
              publication: { roots, outputs: repositories.library, library: repositories.library },
            });
            job = result.changed ? { ...job, changed: job.changed + 1 } : { ...job, unchanged: job.unchanged + 1 };
            for (const directory of result.directories) directories.add(directory);
          }
        } catch (error) {
          job = { ...job, failures: [...job.failures, { id, reason: toErrorMessage(error) }] };
        }
        job = { ...job, current: job.current + 1 };
        this.#job = job;
        if (Date.now() - lastPublished >= 250) {
          this.taskEvents.libraryEdit(job);
          lastPublished = Date.now();
        }
      }
      await notifyMediaServersOfPublish(this.networkClient, configuration, [...directories], logger);
      job = { ...job, status: "completed" };
    } catch (error) {
      job = { ...job, status: "failed", error: toErrorMessage(error) };
      logger.error(`Library edit failed: ${job.error}`);
    }
    this.#job = { ...job, finishedAt: new Date().toISOString() };
    this.taskEvents.libraryEdit(this.#job);
    this.taskEvents.invalidate("library");
  }
}
