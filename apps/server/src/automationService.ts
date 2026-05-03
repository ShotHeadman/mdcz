import type {
  AutomationRecentResponse,
  AutomationScrapeStartInput,
  AutomationScrapeStartResponse,
  AutomationWebhookDeliveryStatusDto,
  AutomationWebhookDeliveryStatusResponse,
  AutomationWebhookEventDto,
  ScanTaskDto,
} from "@mdcz/shared/serverDtos";
import type { MaintenanceService } from "./maintenanceService";
import type { ScanQueueService } from "./scanQueueService";
import type { ScrapeService } from "./scrapeService";
import type { TaskEventBus } from "./taskEvents";

export interface AutomationWebhookOptions {
  secret?: string;
  url?: string;
}

export class AutomationService {
  readonly #webhook?: AutomationWebhookOptions;
  #deliveryStatus: AutomationWebhookDeliveryStatusDto;

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
    taskEvents.subscribe((event) => {
      if (event.data.kind === "task") {
        void this.deliverWebhook(this.toWebhookEvent(event.data.task));
      }
    });
  }

  async scrapeStart(input: AutomationScrapeStartInput): Promise<AutomationScrapeStartResponse> {
    if (input.refs?.length) {
      const task = await this.scrape.start({
        refs: input.refs,
        outputRootId: input.outputRootId,
        manualUrl: input.manualUrl,
        uncensoredConfirmed: input.uncensoredConfirmed,
      });
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
    const [scanTasks, scrapeTasks, maintenanceTasks] = await Promise.all([
      this.scans.list(),
      this.scrape.list(),
      this.maintenance.list(),
    ]);

    return {
      tasks: [...scanTasks.tasks, ...scrapeTasks.tasks, ...maintenanceTasks.tasks]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit)
        .map((task) => this.toWebhookEvent(task)),
    };
  }

  deliveryStatus(): AutomationWebhookDeliveryStatusResponse {
    return { webhook: { ...this.#deliveryStatus } };
  }

  toWebhookEvent(task: ScanTaskDto): AutomationWebhookEventDto {
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

  private summary(task: ScanTaskDto): string {
    const target = task.rootDisplayName || task.rootId;
    if (task.kind === "scan") {
      return `扫描 ${target}: ${task.status}`;
    }
    if (task.kind === "scrape") {
      return `刮削 ${target}: ${task.status}`;
    }
    return `维护 ${target}: ${task.status}`;
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
