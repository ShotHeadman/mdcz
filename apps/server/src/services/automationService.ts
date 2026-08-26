import type {
  AutomationRecentResponse,
  AutomationScrapeStartInput,
  AutomationScrapeStartResponse,
  AutomationWebhookDeliveryStatusDto,
  AutomationWebhookDeliveryStatusResponse,
  AutomationWebhookEventDto,
} from "@mdcz/shared/serverDtos";
import type { TaskEventBus, TaskLifecycleEvent } from "../taskEvents";
import type { MaintenanceService } from "./maintenanceService";
import type { ScanQueueService } from "./scanQueueService";
import type { ScrapeService } from "./scrapeService";

const MAX_TRACKED_WEBHOOK_TASKS = 1_000;
const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;
const WEBHOOK_PHASE_STARTED = 1;
const WEBHOOK_PHASE_TERMINAL = 2;

export interface AutomationWebhookOptions {
  secret?: string;
  url?: string;
}

export class AutomationService {
  readonly #webhook?: AutomationWebhookOptions;
  #deliveryStatus: AutomationWebhookDeliveryStatusDto;
  #deliveryChain: Promise<void> = Promise.resolve();
  readonly #taskDeliveryPhases = new Map<string, number>();

  constructor(
    private readonly scans: ScanQueueService,
    private readonly scrape: ScrapeService,
    private readonly maintenance: MaintenanceService,
    taskEvents: TaskEventBus,
    webhook: AutomationWebhookOptions = {
      secret: process.env.MDCZ_AUTOMATION_WEBHOOK_SECRET,
      url: process.env.MDCZ_AUTOMATION_WEBHOOK_URL,
    },
  ) {
    this.#webhook = webhook.url ? webhook : undefined;
    this.#deliveryStatus = {
      configured: Boolean(this.#webhook?.url),
      delivered: 0,
      failed: 0,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
    };
    taskEvents.subscribeLifecycle((task) => this.enqueueWebhook(task));
  }

  async scrapeStart(input: AutomationScrapeStartInput): Promise<AutomationScrapeStartResponse> {
    if (input.refs?.length) {
      const task = (
        await this.scrape.start({
          refs: input.refs,
          outputRootId: input.outputRootId,
          manualUrl: input.manualUrl,
          uncensoredConfirmed: input.uncensoredConfirmed,
        })
      ).task;
      return { task, webhook: this.toWebhookEvent(task) };
    }

    if (!input.rootId) {
      throw new Error("Either refs or rootId is required");
    }

    const task = await this.scans.start(input.rootId);
    return { task, webhook: this.toWebhookEvent(task) };
  }

  async recent(input?: { limit?: number }): Promise<AutomationRecentResponse> {
    const limit = input?.limit ?? 20;
    const [scanTasks, scrapeHistory, maintenanceTask] = await Promise.all([
      this.scans.list(),
      this.scrape.history(),
      this.maintenance.automationTask(),
    ]);

    const tasks = [
      ...scanTasks.tasks.map((task) => ({ updatedAt: task.updatedAt, event: this.toWebhookEvent(task) })),
      ...scrapeHistory.runs.map((run) => ({
        updatedAt: run.completedAt ?? run.createdAt,
        event: {
          taskId: run.id,
          kind: "scrape" as const,
          status: run.disposition === "completed" ? ("completed" as const) : ("failed" as const),
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          summary: `刮削 ${run.rootDisplayName || run.rootId}: ${run.disposition}`,
          errors: run.error ? [run.error] : [],
        },
      })),
      ...(maintenanceTask
        ? [{ updatedAt: maintenanceTask.updatedAt, event: this.toWebhookEvent(maintenanceTask) }]
        : []),
    ];
    return {
      tasks: tasks
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit)
        .map(({ event }) => event),
    };
  }

  deliveryStatus(): AutomationWebhookDeliveryStatusResponse {
    return { webhook: { ...this.#deliveryStatus } };
  }

  toWebhookEvent(task: TaskLifecycleEvent): AutomationWebhookEventDto {
    return {
      taskId: task.id,
      kind: task.kind,
      status: task.status,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      summary: this.summary(task),
      errors: task.error ? [task.error] : [],
    };
  }

  private summary(task: TaskLifecycleEvent): string {
    const target = task.rootDisplayName || task.rootId;
    if (task.kind === "scan") {
      return `扫描 ${target}: ${task.status}`;
    }
    if (task.kind === "scrape") {
      return `刮削 ${target}: ${task.status}`;
    }
    return `维护 ${target}: ${task.status}`;
  }

  private enqueueWebhook(task: TaskLifecycleEvent): void {
    if (!this.#webhook?.url) {
      return;
    }

    const phase =
      task.status === "running"
        ? WEBHOOK_PHASE_STARTED
        : task.status === "completed" || task.status === "failed"
          ? WEBHOOK_PHASE_TERMINAL
          : 0;
    if (phase === 0) {
      return;
    }

    const deliveredPhases = this.#taskDeliveryPhases.get(task.id) ?? 0;
    if ((deliveredPhases & phase) !== 0) {
      return;
    }

    if (!this.#taskDeliveryPhases.has(task.id) && this.#taskDeliveryPhases.size >= MAX_TRACKED_WEBHOOK_TASKS) {
      let evictionCandidate: string | undefined;
      for (const [taskId, taskPhases] of this.#taskDeliveryPhases) {
        evictionCandidate ??= taskId;
        if ((taskPhases & WEBHOOK_PHASE_TERMINAL) !== 0) {
          evictionCandidate = taskId;
          break;
        }
      }
      if (evictionCandidate) {
        this.#taskDeliveryPhases.delete(evictionCandidate);
      }
    }
    this.#taskDeliveryPhases.set(task.id, deliveredPhases | phase);

    const payload = this.toWebhookEvent(task);
    this.#deliveryChain = this.#deliveryChain.then(() => this.deliverWebhook(payload));
  }

  private async deliverWebhook(payload: AutomationWebhookEventDto): Promise<void> {
    if (!this.#webhook?.url) {
      return;
    }

    this.#deliveryStatus.lastAttemptAt = new Date().toISOString();
    try {
      const response = await fetch(this.#webhook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.#webhook.secret ? { "x-mdcz-webhook-secret": this.#webhook.secret } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(WEBHOOK_DELIVERY_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Webhook delivery failed: ${response.status}`);
      }
      this.#deliveryStatus.delivered += 1;
      this.#deliveryStatus.lastSuccessAt = new Date().toISOString();
      this.#deliveryStatus.lastError = null;
    } catch (error) {
      this.#deliveryStatus.failed += 1;
      this.#deliveryStatus.lastError = error instanceof Error ? error.message : String(error);
    }
  }
}
