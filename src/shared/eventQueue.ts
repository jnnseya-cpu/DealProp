/**
 * Hold events until the thing that sends them exists.
 *
 * Meta Pixel and Google Tag both load asynchronously, so `window.fbq` and
 * `window.gtag` do not exist while a page is mounting — and a page that records
 * a view on mount is doing exactly that. Without a buffer those events are
 * dropped silently: no error, no warning, simply no data.
 *
 * That happened. The first version of the analytics loader called the vendors
 * directly from a mount effect, and `blog_post_viewed` and
 * `glossary_term_viewed` never fired once on any page. `page_view` masked it,
 * because its effect re-runs when consent resolves and by then the scripts had
 * arrived. This module exists so the ordering is a thing that can be tested
 * rather than a thing that has to be watched in a browser.
 *
 * Pure and framework-free: it knows nothing about React, the vendors, or what
 * an event is. It knows that some number of senders must report in before
 * anything may go out.
 */

export interface EventQueue {
  /** Send now if every sender is ready, otherwise hold. */
  deliver(send: () => void): void;
  /** One sender has finished initialising. Drains the queue once all have. */
  senderReady(): void;
  /** How many events are waiting. For tests and diagnostics. */
  waiting(): number;
}

/**
 * Why there is a cap.
 *
 * If a sender never arrives — an ad blocker, a blocked domain, an offline tab —
 * nothing ever drains the queue. A held event is a closure holding whatever it
 * captured, so an uncapped queue on a long-lived tab is a leak. Twenty is far
 * more than a session generates before the scripts land, and dropping the
 * overflow is right: analytics is the thing that gives way.
 */
const DEFAULT_LIMIT = 20;

export function createEventQueue(expected: number, limit = DEFAULT_LIMIT): EventQueue {
  const pending: Array<() => void> = [];
  let ready = 0;

  const drained = (): boolean => ready >= expected;

  return {
    deliver(send: () => void): void {
      // With no senders configured there is nothing to wait for and nothing to
      // send to. The call still runs, so a caller that does its own no-op check
      // behaves identically whether or not a vendor is configured.
      if (expected > 0 && !drained()) {
        if (pending.length < limit) pending.push(send);
        return;
      }
      send();
    },

    senderReady(): void {
      ready += 1;
      if (!drained()) return;
      // Shift rather than iterate: a held event that queues another must not be
      // lost, and must not be replayed by a second drain.
      while (pending.length > 0) {
        pending.shift()?.();
      }
    },

    waiting(): number {
      return pending.length;
    },
  };
}
