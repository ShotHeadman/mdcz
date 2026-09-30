import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { createDesktopMediaRootService } from "@main/services/mediaRoots";
import type { DesktopPersistenceService } from "@main/services/persistence";
import { registeredMediaLocations } from "@mdcz/runtime";
import { type ConfiguredMediaRootService, resolveDesktopInputRootPath } from "@mdcz/runtime/library";
import { LocalScanService, writePreparedNfo } from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import { LlmApiClient, NfoGenerator } from "@mdcz/runtime/scrape";
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
  private readonly writeNfo: NonNullable<BatchNfoTranslatorDependencies["writeNfo"]>;
  private readonly mediaRoots: ConfiguredMediaRootService;

  constructor(
    private readonly networkClient: NetworkClient,
    private readonly persistence: DesktopPersistenceService,
    dependencies: {
      localScanService?: NonNullable<BatchNfoTranslatorDependencies["localScanService"]>;
      llmApiClient?: NonNullable<BatchNfoTranslatorDependencies["llmApiClient"]>;
      nfoGenerator?: NfoGenerator;
      writeNfo?: BatchNfoTranslatorDependencies["writeNfo"];
    } = {},
    mediaRoots?: ConfiguredMediaRootService,
  ) {
    this.localScanService =
      dependencies.localScanService ??
      new LocalScanService(async (paths) => {
        const state = await this.persistence.getState();
        return registeredMediaLocations(
          state.repositories.library,
          (id) => state.repositories.mediaRoots.get(id),
          paths,
        );
      });
    this.llmApiClient = dependencies.llmApiClient ?? new LlmApiClient(networkClient);
    this.nfoGenerator = dependencies.nfoGenerator ?? new NfoGenerator();
    this.writeNfo = dependencies.writeNfo ?? writePreparedNfo;
    this.mediaRoots = mediaRoots ?? createDesktopMediaRootService(persistence);
  }

  async scan(directory: string, config: Configuration): Promise<BatchTranslateScanItem[]> {
    return await scanBatchNfoTranslations(directory, config, {
      localScanService: this.localScanService,
    });
  }

  async apply(
    items: BatchTranslateScanItem[],
    config: Configuration,
    options: BatchNfoTranslatorApplyOptions = {},
  ): Promise<BatchTranslateApplyResultItem[]> {
    void this.networkClient;
    if (items.length > 0) {
      const hostPath = resolveDesktopInputRootPath(items.map((item) => item.nfoPath));
      await this.mediaRoots.ensurePathRecord({ hostPath });
    }
    const state = await this.persistence.getState();
    return await applyBatchNfoTranslations(
      items,
      config,
      {
        llmApiClient: this.llmApiClient,
        localScanService: this.localScanService,
        logger: this.logger,
        nfoGenerator: this.nfoGenerator,
        writeNfo: this.writeNfo,
        publication: {
          outputs: state.repositories.library,
          library: state.repositories.library,
          roots: await this.mediaRoots.listRoots(),
        },
      },
      options,
    );
  }
}
