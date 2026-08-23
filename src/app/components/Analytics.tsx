"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isTrackableRoute,
  mayTrack,
  META_STANDARD_EVENTS,
  reportablePath,
  sanitiseProperties,
  type AnalyticsEvent,
  type EventProperties,
} from "@shared/domain/analytics";
import {
  CONSENT_COOKIE,
  consentAllowsAnalytics,
  parseConsent,
  type ConsentState,
} from "@shared/consent";
import { ConsentBanner } from "@/app/components/ConsentBanner";
import { createEventQueue } from "@shared/eventQueue";

/**
 * Meta Pixel and Google Tag, loaded together and gated the same way.
 *
 * Four conditions must all hold before a single request leaves the browser:
 *
 *  1. **An ID is configured.** No `NEXT_PUBLIC_META_PIXEL_ID` or
 *     `NEXT_PUBLIC_GA_MEASUREMENT_ID` means the script never renders — the same
 *     fail-closed rule the cron endpoint and the email transport follow.
 *  2. **Consent has been given.** Both vendors set non-essential cookies, so
 *     PECR requires agreement before they load, not after.
 *  3. **The route is on the allowlist.** Deny by default. The pipeline, the
 *     Deal Room, the memorandum and a seller's own result page are excluded:
 *     they carry reported financial distress and health concerns, and a pixel
 *     sends the URL, title and referrer to two advertising networks.
 *  4. **The event is known and its properties survive sanitising.** Counts and
 *     stages, never content.
 *
 * The route check is re-run on every navigation rather than only at mount,
 * because this is a single-page app: moving from the blog into the Deal Room
 * must stop the pixel, not merely fail to start it again.
 */

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gtag?: (...args: any[]) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dataLayer?: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fbq?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _fbq?: any;
  }
}

const META_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";
const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";

/**
 * Events fired before the vendor scripts have run.
 *
 * Both tags load with `afterInteractive`, so neither vendor's function exists
 * while the page is mounting — and a page that records a view on mount is doing
 * exactly that. The first version of this file called them directly and every
 * such event was dropped: `blog_post_viewed` and `glossary_term_viewed` never
 * fired once, on any page, while `page_view` appeared to work because its
 * effect re-runs when consent resolves. The queue is in `eventQueue.ts` so the
 * ordering can be tested rather than watched.
 *
 * Only events that already passed the consent check are queued, so nothing
 * collected before agreement can be sent by a later flush.
 *
 * Both init snippets install a buffer of their own — `dataLayer` for Google, an
 * internal queue for Meta — so once they have run, an event is safe to hand
 * over even before the remote library arrives. Waiting for the snippet is
 * therefore enough; waiting for the network is not required.
 */
const VENDORS_EXPECTED = (GA_ID !== "" ? 1 : 0) + (META_ID !== "" ? 1 : 0);
const queue = createEventQueue(VENDORS_EXPECTED);

/** Consent, read at the moment of the call rather than from a flag set later. */
function consentNow(): boolean {
  if (typeof document === "undefined") return false;
  const raw = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CONSENT_COOKIE}=`))
    ?.split("=")[1];
  return consentAllowsAnalytics(parseConsent(raw));
}

/**
 * Send an event.
 *
 * Exported and called from anywhere in the app. Safe to call from an excluded
 * page, during server rendering, before consent, or with no ID configured — in
 * every one of those cases it does nothing rather than throwing, because an
 * analytics call that can break a page is worse than no analytics.
 */
export function track(event: AnalyticsEvent, properties: EventProperties = {}): void {
  if (typeof window === "undefined") return;
  if (!mayTrack(event, window.location.pathname)) return;
  if (!consentNow()) return;

  const clean = sanitiseProperties(properties);
  const standard = META_STANDARD_EVENTS[event];

  queue.deliver(() => {
    try {
      window.gtag?.("event", event, clean);
    } catch {
      // A vendor script that throws must not take the page with it.
    }

    try {
      if (standard !== undefined) {
        window.fbq?.("track", standard, clean);
      } else {
        window.fbq?.("trackCustom", event, clean);
      }
    } catch {
      // As above.
    }
  });
}

export function Analytics() {
  const pathname = usePathname();
  const [consent, setConsent] = useState<ConsentState>("unknown");
  const lastPath = useRef<string | undefined>(undefined);

  const allowed = consentAllowsAnalytics(consent);
  const configured = VENDORS_EXPECTED > 0;
  const trackable = isTrackableRoute(pathname);
  const active = allowed && configured && trackable;

  const onChange = useCallback((next: ConsentState) => {
    setConsent(next);
  }, []);

  // A page view per navigation. Next does not reload between routes, so
  // neither vendor sends one by itself after the first.
  useEffect(() => {
    if (!active) return;
    const path = reportablePath(pathname);
    if (path === undefined || path === lastPath.current) return;
    lastPath.current = path;

    // The path is sent explicitly rather than left to the vendor's own
    // location read, so what is reported is the sanitised path and never a
    // query string. Queued like every other event: on a first load this runs
    // before the vendor scripts do.
    queue.deliver(() => {
      try {
        window.gtag?.("event", "page_view", { page_path: path });
      } catch {
        // As in `track`.
      }
      try {
        window.fbq?.("track", "PageView");
      } catch {
        // As above.
      }
    });
  }, [active, pathname]);

  return (
    <>
      {/*
        Only ask where the answer changes something. With no pixel configured
        there is nothing to consent to, and on an excluded route — the pipeline,
        the Deal Room, a seller's own result page — nothing loads whatever the
        visitor says. A banner there is a consent request for a thing that
        cannot happen, which teaches people to dismiss the ones that matter.
      */}
      {configured && trackable && <ConsentBanner onChange={onChange} />}

      {active && GA_ID !== "" && (
        <>
          <Script
            id="ga-src"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          />
          <Script id="ga-init" strategy="afterInteractive" onReady={queue.senderReady}>
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = gtag;
              gtag('js', new Date());
              gtag('consent', 'default', {
                ad_storage: 'granted',
                analytics_storage: 'granted',
                ad_user_data: 'granted',
                ad_personalization: 'granted'
              });
              gtag('config', '${GA_ID}', {
                send_page_view: false,
                anonymize_ip: true
              });
            `}
          </Script>
        </>
      )}

      {active && META_ID !== "" && (
        <Script id="meta-pixel" strategy="afterInteractive" onReady={queue.senderReady}>
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window,document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${META_ID}');
          `}
        </Script>
      )}
    </>
  );
}
