import type { DesktopPersistenceService } from "@main/services/persistence";
import { resolveDesktopInputRootPath } from "@mdcz/runtime/library";
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
    private readonly persistence: DesktopPersistenceService,
  ) {}

  async scan(rootDirectory: string): Promise<AmazonPosterScanItem[]> {
    const items = await scanAmazonPosters(rootDirectory, { validateImage });
    const state = await this.persistence.getState();
    await state.repositories.mediaRoots.ensurePath(rootDirectory);
    return items;
  }

  async lookup(nfoPath: string, title: string): Promise<AmazonPosterLookupResult> {
    return await lookupAmazonPoster(this.networkClient, nfoPath, title, {
      enhanceAmazonPoster: (data) => this.amazonJpImageService.enhance(data),
    });
  }

  async apply(items: Array<{ nfoPath: string; amazonPosterUrl: string }>): Promise<AmazonPosterApplyResultItem[]> {
    const state = await this.persistence.getState();
    if (items.length > 0) {
      const hostPath = resolveDesktopInputRootPath(items.map((item) => item.nfoPath));
      await state.repositories.mediaRoots.ensurePath(hostPath);
    }
    return await applyAmazonPosters(this.networkClient, items, {
      validateImage,
      journal: state.repositories.publicationJournal,
      repairIssues: state.repositories.libraryRepairIssues,
      roots: await state.repositories.mediaRoots.list(),
    });
  }
}
