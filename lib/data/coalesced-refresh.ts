/** Combine bursts while retaining a trailing refresh for events during a request. */
export function createCoalescedRefresh(refresh: () => Promise<void>, delayMs = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = false;
  let disposed = false;

  async function run() {
    timer = undefined;
    if (disposed) return;
    running = true;
    pending = false;
    try {
      await refresh();
    } catch {
      // Providers report their own failures; background triggers must not reject.
    } finally {
      running = false;
      if (pending && !disposed) timer = setTimeout(() => void run(), delayMs);
    }
  }

  return {
    request() {
      if (disposed) return;
      if (running) { pending = true; return; }
      if (!timer) timer = setTimeout(() => void run(), delayMs);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
    },
  };
}
