import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  closeTestServers,
  createTempRoot,
  createTestLibrary,
  createTestServer,
  loginAsAdmin,
} from "@mdcz/server/app.testSupport";
import { formatSseEvent } from "@mdcz/server/taskEvents";
import { afterEach, describe, expect, it } from "vitest";
import { createApiRequestHandler } from "./apiProtocol";

afterEach(async () => {
  await closeTestServers();
});

describe("API scheme handler", () => {
  it("answers API calls, ranged assets and task events, and ends a cancelled body's server response", async () => {
    const root = await createTempRoot("api-scheme");
    await writeFile(join(root, "trailer.mp4"), "0123456789");
    const { fastify, services } = await createTestServer();
    const token = await loginAsAdmin(fastify);
    const { rootId } = await createTestLibrary(fastify, token, root);
    const handle = createApiRequestHandler(fastify);
    const headers = { authorization: `Bearer ${token}`, origin: "mdcz-api://app" };

    const foreign = await handle(
      new Request("mdcz-api://app/trpc/libraries.list", { headers: { ...headers, origin: "https://evil.example" } }),
    );
    expect(foreign.status).toBe(403);

    const ensured = await handle(
      new Request("mdcz-api://app/trpc/mediaRoots.ensurePath", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ hostPath: root }),
      }),
    );
    expect(await ensured.json()).toMatchObject({ result: { data: { id: rootId } } });

    const ranged = await handle(
      new Request(`mdcz-api://app/api/library/assets/${rootId}/trailer.mp4`, {
        headers: { ...headers, range: "bytes=2-5" },
      }),
    );
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe("2345");

    const listeners = services.taskEvents.listenerCount();
    const events = await handle(new Request("mdcz-api://app/events/tasks", { headers }));
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    const reader = events.body?.getReader();
    if (!reader) throw new Error("Expected an event stream body");
    const readyEvent = formatSseEvent({ kind: "invalidate", resources: ["ready"] });
    let received = "";
    const decoder = new TextDecoder();
    while (!received.includes(readyEvent)) received += decoder.decode((await reader.read()).value);
    expect(services.taskEvents.listenerCount()).toBe(listeners + 1);

    // A closed EventSource, a seek or a new `src` cancels the body; the subscription or file behind it must end too.
    await reader.cancel();
    await expect.poll(() => services.taskEvents.listenerCount()).toBe(listeners);
  });
});
