import type { NetworkClient } from "@mdcz/runtime/network";
import { validateImage } from "@mdcz/runtime/scrape/utils/image";
import {
  type AmazonJpImageService,
  applyAmazonPosters,
  lookupAmazonPoster,
  scanAmazonPosters,
} from "@mdcz/runtime/tools";
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
