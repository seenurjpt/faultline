/**
 * Runs `items` through `work` with at most `concurrency` in flight, and
 * returns the results in item order.
 *
 * The first failure is the one reported: it cancels everything still running
 * through the signal handed to `work`, and the cancellations it causes are
 * never reported in its place. The caller's own signal cancels the same way,
 * in which case the error that surfaces is whatever `work` throws for it.
 */
export async function runPool<T, R>(
  items: readonly T[],
  work: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  options: { concurrency: number; signal?: AbortSignal },
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const internal = new AbortController();
  const external = options.signal;
  const forward = () => internal.abort();
  if (external?.aborted) internal.abort();
  else external?.addEventListener("abort", forward);

  let next = 0;
  let failed = false;
  let firstError: unknown;

  const runner = async (): Promise<void> => {
    for (;;) {
      if (failed || internal.signal.aborted) return;
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await work(items[index], index, internal.signal);
      } catch (error: unknown) {
        if (!failed) {
          failed = true;
          firstError = error;
          internal.abort();
        }
        return;
      }
    }
  };

  const width = Math.max(1, Math.min(options.concurrency, items.length));
  try {
    await Promise.all(Array.from({ length: width }, runner));
  } finally {
    external?.removeEventListener("abort", forward);
  }

  if (failed) throw firstError;
  return results;
}
