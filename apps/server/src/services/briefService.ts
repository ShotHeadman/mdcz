import { checkBriefPlanner, planBriefRequest } from "@mdcz/runtime/brief";
import type { MediaLibraryService } from "@mdcz/runtime/library";
import { createLlmApiClient, type LlmApiClient } from "@mdcz/runtime/llm";
import type { NetworkClient } from "@mdcz/runtime/network";
import { type BriefCheckResponse, type BriefPlan, type BriefPlanInput, MEDIA_SERVERS } from "@mdcz/shared/briefCatalog";
import type { LlmSettings } from "@mdcz/shared/config";
import type { ServerConfigService } from "./configService";
import type { LibraryService } from "./libraryService";

/** Plans only: a job starts when the user confirms the card, through the procedure its own page calls. */
export class BriefService {
  private readonly client: LlmApiClient;

  constructor(
    private readonly config: ServerConfigService,
    private readonly libraries: MediaLibraryService,
    private readonly library: LibraryService,
    networkClient: NetworkClient,
  ) {
    this.client = createLlmApiClient(networkClient);
  }

  async plan(input: BriefPlanInput): Promise<BriefPlan> {
    const configuration = await this.config.get();
    if (!configuration.llm.brief) throw new Error("Brief is turned off");
    return await planBriefRequest(
      input,
      configuration.llm,
      {
        libraries: await this.libraries.list(),
        mediaServers: MEDIA_SERVERS.filter(
          (server) => configuration[server].url.trim() && configuration[server].apiKey.trim(),
        ),
        configuration,
        profiles: async () => await this.config.listProfiles(),
        facets: async (libraryId) => (await this.library.summary({ libraryId })).facets,
        movieValues: async (filter, field) => {
          const values = new Set<string>();
          let cursor: string | undefined;
          do {
            const page = await this.library.list({ ...filter, cursor, limit: 500 });
            for (const entry of page.entries) {
              const value = entry.crawlerData?.[field];
              for (const item of Array.isArray(value) ? value : value ? [value] : []) values.add(item);
            }
            cursor = page.nextCursor ?? undefined;
          } while (cursor);
          return [...values];
        },
      },
      this.client,
    );
  }

  async check(settings: LlmSettings): Promise<BriefCheckResponse> {
    return await checkBriefPlanner(settings, this.client);
  }
}
