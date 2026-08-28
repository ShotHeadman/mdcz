import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { DesktopPersistenceService } from "@main/services/persistence";
import { createDesktopInputRoot, findEnclosingMediaRoot, resolveDesktopInputRootPath } from "@mdcz/runtime/library";
import { LocalScanService, writePreparedNfo } from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import { commitRegisteredPublication } from "@mdcz/runtime/publication";
import { getNfoWritePaths, LlmApiClient, NfoGenerator } from "@mdcz/runtime/scrape";
import {
  applyBatchNfoTranslations,
  type BatchNfoTranslatorApplyOptions,
  type BatchNfoTranslatorDependencies,
  scanBatchNfoTranslations,
} from "@mdcz/runtime/tools";
import type { BatchTranslateApplyResultItem, BatchTranslateScanItem } from "@mdcz/shared/ipcTypes";

export class BatchTranslateToolService {
  private readonly logger = loggerService.getLogger("BatchTranslateToolService");
  private readonly localScanService: NonNullable<BatchNfoTranslatorDependencies["localScanService"]>;
  private readonly llmApiClient: NonNullable<BatchNfoTranslatorDependencies["llmApiClient"]>;
  private readonly nfoGenerator: NfoGenerator;
  private readonly writeNfo: typeof writePreparedNfo;

  constructor(
    private readonly networkClient: NetworkClient,
    private readonly persistence: DesktopPersistenceService,
    dependencies: {
      localScanService?: NonNullable<BatchNfoTranslatorDependencies["localScanService"]>;
      llmApiClient?: NonNullable<BatchNfoTranslatorDependencies["llmApiClient"]>;
      nfoGenerator?: NfoGenerator;
      writeNfo?: typeof writePreparedNfo;
    } = {},
  ) {
    this.localScanService = dependencies.localScanService ?? new LocalScanService();
    this.llmApiClient = dependencies.llmApiClient ?? new LlmApiClient(networkClient);
    this.nfoGenerator = dependencies.nfoGenerator ?? new NfoGenerator();
    this.writeNfo = dependencies.writeNfo ?? writePreparedNfo;
  }

  async scan(directory: string, config: Configuration): Promise<BatchTranslateScanItem[]> {
    const items = await scanBatchNfoTranslations(directory, config, {
      localScanService: this.localScanService,
    });
    const state = await this.persistence.getState();
    const roots = await state.repositories.mediaRoots.list({ includeDeleted: true });
    if (!findEnclosingMediaRoot(directory, roots)) {
      await state.repositories.mediaRoots.upsert(createDesktopInputRoot(directory));
    }
    return items;
  }

  async apply(
    items: BatchTranslateScanItem[],
    config: Configuration,
    options: BatchNfoTranslatorApplyOptions = {},
  ): Promise<BatchTranslateApplyResultItem[]> {
    void this.networkClient;
    const state = await this.persistence.getState();
    const roots = await state.repositories.mediaRoots.list({ includeDeleted: true });
    if (items.length > 0) {
      const hostPath = resolveDesktopInputRootPath(items.map((item) => item.nfoPath));
      if (!findEnclosingMediaRoot(hostPath, roots)) {
        await state.repositories.mediaRoots.upsert(createDesktopInputRoot(hostPath));
      }
    }
    return await applyBatchNfoTranslations(
      items,
      config,
      {
        llmApiClient: this.llmApiClient,
        localScanService: this.localScanService,
        logger: this.logger,
        nfoGenerator: this.nfoGenerator,
        writeNfo: async (writeInput) => {
          const artifacts: Array<{ targetPath: string; content: { kind: "text"; data: string } }> = [];
          const savedNfoPath = await this.writeNfo({
            ...writeInput,
            writeFile: async (targetPath, content) => {
              artifacts.push({ targetPath, content: { kind: "text", data: content } });
            },
          });
          const state = await this.persistence.getState();
          await commitRegisteredPublication(
            {
              operationId: `batch-nfo-translation:${writeInput.fileInfo.filePath}`,
              operationType: "maintenance",
              artifacts,
              obsoletePaths: getNfoWritePaths(writeInput.nfoPath, writeInput.config.download.nfoNaming).stalePaths,
              replaceExistingArtifacts: true,
            },
            {
              journal: state.repositories.publicationJournal,
              repairIssues: state.repositories.libraryRepairIssues,
              roots: await state.repositories.mediaRoots.list({ includeDeleted: true }),
            },
          );
          return savedNfoPath;
        },
      },
      options,
    );
  }
}
