import type { NetworkClient } from "@main/services/network";
import type { AmazonJpImageService } from "@main/services/scraper/AmazonJpImageService";
import { validateImage } from "@main/utils/image";
import { applyAmazonPosters, lookupAmazonPoster, scanAmazonPosters } from "@mdcz/runtime/tools";
import type {
  AmazonPosterApplyResultItem,
  AmazonPosterLookupResult,
  AmazonPosterScanItem,
} from "@mdcz/shared/ipcTypes";

export class AmazonPosterToolService {
  constructor(
    private readonly networkClient: NetworkClient,
    private readonly amazonJpImageService: AmazonJpImageService,
  ) {}

  async scan(rootDirectory: string): Promise<AmazonPosterScanItem[]> {
    return await scanAmazonPosters(rootDirectory, { validateImage });
  }

  async lookup(nfoPath: string, title: string): Promise<AmazonPosterLookupResult> {
    return await lookupAmazonPoster(this.networkClient, nfoPath, title, {
      enhanceAmazonPoster: (data) => this.amazonJpImageService.enhance(data),
    });
  }

  async apply(items: Array<{ nfoPath: string; amazonPosterUrl: string }>): Promise<AmazonPosterApplyResultItem[]> {
    return await applyAmazonPosters(this.networkClient, items, { validateImage });
  }
}
