import { pathExists } from "@main/utils/file";
import { buildMovieTags } from "@main/utils/movieTags";
import {
  type NfoOptions,
  NfoGenerator as RuntimeNfoGenerator,
  resolveCanonicalNfoPath,
  findExistingNfoPath as runtimeFindExistingNfoPath,
  reconcileExistingNfoFiles as runtimeReconcileExistingNfoFiles,
} from "@mdcz/runtime/scrape";
import type { CrawlerData } from "@mdcz/shared/types";

export type { NfoOptions };

export class NfoGenerator extends RuntimeNfoGenerator {
  override buildXml(data: CrawlerData, options?: NfoOptions): string {
    return super.buildXml(data, { ...options, buildTags: options?.buildTags ?? buildMovieTags });
  }
}

export const nfoGenerator = new NfoGenerator();
export { resolveCanonicalNfoPath };

export const findExistingNfoPath = async (
  nfoPath: string,
  nfoNaming: NfoOptions["nfoNaming"] = "both",
): Promise<string | undefined> => runtimeFindExistingNfoPath(nfoPath, nfoNaming, pathExists);

export const reconcileExistingNfoFiles = async (
  nfoPath: string,
  nfoNaming: NfoOptions["nfoNaming"] = "both",
): Promise<string | undefined> => runtimeReconcileExistingNfoFiles(nfoPath, nfoNaming, pathExists);
