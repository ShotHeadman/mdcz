import {
  type CreateSymlinkPayload,
  createSymlinks,
  type SymlinkTaskResult as RuntimeSymlinkTaskResult,
  SymlinkServiceError,
} from "@mdcz/runtime/tools";
import type { SignalService } from "../SignalService";

export type { CreateSymlinkPayload };
export { SymlinkServiceError };

export interface SymlinkTaskResult {
  total: number;
  linked: number;
  copied: number;
  skipped: number;
  failed: number;
}

export interface SymlinkServiceDependencies {
  signalService: SignalService;
}

const stripRuntimePlanned = (result: RuntimeSymlinkTaskResult): SymlinkTaskResult => ({
  total: result.total,
  linked: result.linked,
  copied: result.copied,
  skipped: result.skipped,
  failed: result.failed,
});

export class SymlinkService {
  constructor(private readonly deps: SymlinkServiceDependencies) {}

  async prepare(payload: CreateSymlinkPayload): Promise<CreateSymlinkPayload> {
    await createSymlinks({ ...payload, dryRun: true });
    return {
      sourceDir: payload.sourceDir.trim(),
      destDir: payload.destDir.trim(),
      copyFiles: Boolean(payload.copyFiles),
    };
  }

  async run(payload: CreateSymlinkPayload): Promise<SymlinkTaskResult> {
    return this.runPrepared(await this.prepare(payload));
  }

  async runPrepared(payload: CreateSymlinkPayload): Promise<SymlinkTaskResult> {
    this.deps.signalService.showLogText("Starting symlink task");
    this.deps.signalService.showLogText(`Symlink source: ${payload.sourceDir}`);
    this.deps.signalService.showLogText(`Symlink destination: ${payload.destDir}`);

    const result = stripRuntimePlanned(await createSymlinks(payload));
    this.deps.signalService.showLogText(
      `Symlink task completed. Total: ${result.total}, Linked: ${result.linked}, Copied: ${result.copied}, Skipped: ${result.skipped}, Failed: ${result.failed}`,
    );
    return result;
  }
}
