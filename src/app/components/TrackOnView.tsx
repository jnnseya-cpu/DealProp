"use client";

import { useEffect } from "react";
import { track } from "@/app/components/Analytics";
import type { AnalyticsEvent, EventProperties } from "@shared/domain/analytics";

/**
 * Fire one event when a server-rendered page mounts.
 *
 * Server components cannot call `track` — it needs the browser — so pages that
 * want to record a view drop this in. It fires once per mount rather than once
 * per render, so a re-render from a state change elsewhere does not double-count
 * the same page view.
 */
export function TrackOnView({
  event,
  properties,
}: {
  event: AnalyticsEvent;
  properties?: EventProperties;
}) {
  useEffect(() => {
    track(event, properties);
    // The properties object is recreated by the parent on every render, so
    // depending on it directly would refire the event. The event name and the
    // page identity are what actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, properties?.content]);

  return null;
}
