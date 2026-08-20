import { describe, expect, it } from "vitest";
import { runScrapeItems } from "./executor";

describe("runScrapeItems", () => {
  it("runs every item when no control is supplied", async () => {
    const ran: number[] = [];
    const results = await runScrapeItems([10, 20, 30], { concurrency: 1 }, (item, index) => ({
      item,
      index,
      run: async () => {
        ran.push(item);
        return item * 2;
      },
    }));

    expect(ran).toEqual([10, 20, 30]);
    expect(results).toEqual([20, 40, 60]);
  });

  it("shares one resume gate across every item waiting on the same pause", async () => {
    let paused = false;
    let pauseNotifications = 0;
    const ran: number[] = [];
    let release!: () => void;
    let observePause!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pauseObserved = new Promise<void>((resolve) => {
      observePause = resolve;
    });

    const execution = runScrapeItems(
      [1, 2, 3, 4, 5],
      {
        concurrency: 1,
        control: {
          isPaused: () => paused,
          onPaused: async () => {
            pauseNotifications += 1;
            observePause();
            await gate;
          },
        },
      },
      (item, index) => ({
        item,
        index,
        run: async () => {
          ran.push(item);
          if (item === 1) paused = true;
          return item;
        },
      }),
    );

    await pauseObserved;
    expect(ran).toEqual([1]);
    paused = false;
    release();
    await execution;
    expect(ran).toEqual([1, 2, 3, 4, 5]);
    expect(pauseNotifications).toBe(1);
  });

  it("keeps paused items in the current run until resumed", async () => {
    let paused = true;
    const ran: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const execution = runScrapeItems(
      [1, 2, 3],
      { concurrency: 2, control: { isPaused: () => paused, onPaused: async () => await gate } },
      (item, index) => ({
        item,
        index,
        run: async () => {
          ran.push(item);
          return item;
        },
      }),
    );

    expect(ran).toEqual([]);
    paused = false;
    release();
    const resumed = await execution;

    expect(ran).toEqual([1, 2, 3]);
    expect(resumed).toEqual([1, 2, 3]);
  });

  it("stops the run when a stop is requested", async () => {
    const ran: number[] = [];
    await expect(
      runScrapeItems([1, 2, 3], { concurrency: 1, control: { isStopRequested: () => true } }, (item, index) => ({
        item,
        index,
        run: async () => {
          ran.push(item);
          return item;
        },
      })),
    ).rejects.toThrow("Scrape stopped");

    expect(ran).toEqual([]);
  });

  it("rechecks stop requests after a paused run is released", async () => {
    let stopped = false;
    let release!: () => void;
    let observePause!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pauseObserved = new Promise<void>((resolve) => {
      observePause = resolve;
    });
    const execution = runScrapeItems(
      [1],
      {
        concurrency: 1,
        control: {
          isPaused: () => true,
          isStopRequested: () => stopped,
          onPaused: async () => {
            observePause();
            await gate;
          },
        },
      },
      (item, index) => ({ item, index, run: async () => item }),
    );

    await pauseObserved;
    stopped = true;
    release();

    await expect(execution).rejects.toThrow("Scrape stopped");
  });
});
