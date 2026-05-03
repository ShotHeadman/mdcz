import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import { LocalScanService, writePreparedNfo } from "@mdcz/runtime/maintenance";
import { LlmApiClient, NfoGenerator } from "@mdcz/runtime/scrape";
import {
  applyBatchNfoTranslations,
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
    return await scanBatchNfoTranslations(directory, config, {
      localScanService: this.localScanService,
    });
  }

  async apply(items: BatchTranslateScanItem[], config: Configuration): Promise<BatchTranslateApplyResultItem[]> {
    void this.networkClient;
    return await applyBatchNfoTranslations(items, config, {
      llmApiClient: this.llmApiClient,
      localScanService: this.localScanService,
      logger: this.logger,
      nfoGenerator: this.nfoGenerator,
      writeNfo: this.writeNfo,
    });
  }
}
