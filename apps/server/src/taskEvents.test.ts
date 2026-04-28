import { describe, expect, it } from "vitest";

import { createTaskEventBus, formatSseEvent, type TaskEventEnvelope } from "./taskEvents";

describe("TaskEventBus", () => {
  it("publishes task events to active subscribers", () => {
    const taskEvents = createTaskEventBus();
    const receivedEvents: TaskEventEnvelope[] = [];

    const unsubscribe = taskEvents.subscribe((event) => {
      receivedEvents.push(event);
    });

    const event = taskEvents.publish({
      taskId: "task-1",
      status: "queued",
      emittedAt: "2026-04-28T00:00:00.000Z",
    });

    expect(event).toEqual({
      id: "1",
      event: "task-update",
      data: {
        taskId: "task-1",
        status: "queued",
        emittedAt: "2026-04-28T00:00:00.000Z",
      },
    });
    expect(receivedEvents).toEqual([event]);
    expect(taskEvents.listenerCount()).toBe(1);

    unsubscribe();

    taskEvents.publish({
      taskId: "task-2",
      status: "running",
      emittedAt: "2026-04-28T00:00:01.000Z",
    });

    expect(receivedEvents).toEqual([event]);
    expect(taskEvents.listenerCount()).toBe(0);
  });
});

describe("formatSseEvent", () => {
  it("formats a task event envelope as an SSE message", () => {
    expect(
      formatSseEvent({
        id: "7",
        event: "task-update",
        data: {
          taskId: "task-7",
          status: "success",
          message: "Scan completed",
          emittedAt: "2026-04-28T00:00:00.000Z",
        },
      }),
    ).toBe(
      'id: 7\nevent: task-update\ndata: {"taskId":"task-7","status":"success","message":"Scan completed","emittedAt":"2026-04-28T00:00:00.000Z"}\n\n',
    );
  });
});
