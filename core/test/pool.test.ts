// The upload sends batches through this pool, so these pin the properties the
// upload relies on: the bound holds, order is preserved, and one failure
// stops the rest without being mistaken for a cancellation.
import { describe, expect, it } from "vitest";
import { runPool } from "../../lib/pool";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe("runPool", () => {
  it("never has more than the bound in flight and keeps result order", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);

    const results = await runPool(
      items,
      async (n) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        // Vary the timing so completion order differs from start order.
        await new Promise((r) => setTimeout(r, (12 - n) % 4));
        inFlight--;
        return n * 10;
      },
      { concurrency: 4 },
    );

    expect(peak).toBe(4);
    expect(results).toEqual(items.map((n) => n * 10));
  });

  it("reports the first failure and cancels what is still running", async () => {
    const seen: number[] = [];
    let cancelled = 0;

    await expect(
      runPool(
        [0, 1, 2, 3, 4, 5],
        async (n, _i, signal) => {
          seen.push(n);
          if (n === 1) {
            await tick();
            throw new Error("batch 1 failed");
          }
          // Everything else waits on the signal, the way a fetch would.
          await new Promise<void>((_, reject) => {
            signal.addEventListener("abort", () => {
              cancelled++;
              reject(new Error("aborted"));
            });
          });
        },
        { concurrency: 3 },
      ),
    ).rejects.toThrow("batch 1 failed");

    // Three started; the two that were not the failure were cancelled by it,
    // and nothing beyond the bound was ever started.
    expect(seen).toEqual([0, 1, 2]);
    expect(cancelled).toBe(2);
  });

  it("propagates the caller's own cancellation", async () => {
    const controller = new AbortController();
    const started: number[] = [];

    const run = runPool(
      [0, 1, 2, 3],
      async (n, _i, signal) => {
        started.push(n);
        await new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("caller aborted")));
        });
      },
      { concurrency: 2, signal: controller.signal },
    );

    await tick();
    controller.abort();
    await expect(run).rejects.toThrow("caller aborted");
    expect(started).toEqual([0, 1]);
  });

  it("returns an empty result for no items without touching the signal", async () => {
    const controller = new AbortController();
    const results = await runPool([], async () => 1, {
      concurrency: 4,
      signal: controller.signal,
    });
    expect(results).toEqual([]);
    expect(controller.signal.aborted).toBe(false);
  });
});
