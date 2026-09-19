export interface MaintenanceDirectoryTaskRow {
  id: string;
  rootId: string;
  outputRootId: string;
  outputRelativeDirectory: string;
  presetId: string;
  scopeJson: string;
  configurationJson: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export class MaintenanceDirectoryRepository {
  private readonly tasks = new Map<string, MaintenanceDirectoryTaskRow>();

  save(input: {
    id: string;
    rootId: string;
    outputRootId: string;
    outputRelativeDirectory: string;
    presetId: string;
    scopeJson: string;
    configurationJson: string;
  }): void {
    const now = new Date();
    this.tasks.set(input.id, {
      ...input,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
  }

  get(id: string): MaintenanceDirectoryTaskRow {
    const row = this.tasks.get(id);
    if (!row) throw new Error(`Maintenance directory task not found: ${id}`);
    return row;
  }

  setStatus(id: string, status: string): void {
    const row = this.tasks.get(id);
    if (row) {
      row.status = status;
      row.updatedAt = new Date();
    }
  }

  interruptUnfinished(): void {
    for (const row of this.tasks.values()) {
      if (["queued", "discovering", "running", "paused", "stopping"].includes(row.status)) {
        row.status = "interrupted";
        row.updatedAt = new Date();
      }
    }
  }
}
