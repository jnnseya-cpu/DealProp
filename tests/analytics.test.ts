import { describe, expect, it } from "vitest";
import {
  isTrackableRoute,
  mayTrack,
  META_STANDARD_EVENTS,
  reportablePath,
  sanitiseProperties,
  type AnalyticsEvent,
} from "@shared/domain/analytics";
import { consentAllowsAnalytics, parseConsent } from "@shared/consent";

/**
 * These are the tests that matter most in this file, and they are the exclusion
 * ones. Everything else here is a funnel report; a failure in the exclusions is
 * a seller's file reaching two advertising networks.
 */

const SELLER_DATA_ROUTES = [
  "/deals",
  "/deals/deal-0001",
  "/deals/deal-0001/memorandum",
  "/sell/enq-vJ8kQ2mXpL9wR4tY7nB1cF6hD3gS5aZ0",
  "/operator",
  "/operator/accounts",
  "/operator/audit",
  "/account/certify",
  "/invest",
  "/opportunities",
  "/portfolio",
  "/opportunities/deal-0001",
  "/capital",
  "/api/health",
  "/api/cron/newsletter",
];

const PUBLIC_ROUTES = [
  "/",
  "/sell",
  "/blog",
  "/blog/why-we-rejected-handsworth-b21",
  "/blog/topic/tax",
  "/glossary",
  "/glossary/true-discount",
  "/newsletter",
  "/offline",
];

describe("no pixel touches a page carrying seller data", () => {
  it("refuses every operator and seller-identifying route", () => {
    for (const route of SELLER_DATA_ROUTES) {
      expect(isTrackableRoute(route), route).toBe(false);
    }
  });

  it("refuses a seller's own result page while allowing the public form", () => {
    // /sell is the form anybody can open. /sell/{token} is one seller's answers,
    // and the URL is the credential that opens it.
    expect(isTrackableRoute("/sell")).toBe(true);
    expect(isTrackableRoute("/sell/enq-abc123def456")).toBe(false);
  });

  it("is not fooled by a trailing slash or a query string", () => {
    expect(isTrackableRoute("/deals/")).toBe(false);
    expect(isTrackableRoute("/deals?utm_source=x")).toBe(false);
    expect(isTrackableRoute("/sell/enq-abc123def456?ref=email")).toBe(false);
    expect(isTrackableRoute("/deals#top")).toBe(false);
  });

  it("denies a route nobody has classified yet", () => {
    // Deny by default: a route added next year is untracked until somebody
    // decides otherwise, rather than instrumented because it missed a denylist.
    expect(isTrackableRoute("/some-future-page")).toBe(false);
    expect(isTrackableRoute("/admin")).toBe(false);
  });

  it("allows the public marketing surfaces", () => {
    for (const route of PUBLIC_ROUTES) {
      expect(isTrackableRoute(route), route).toBe(true);
    }
  });
});

describe("what may be reported", () => {
  it("never returns a path for an excluded route", () => {
    for (const route of SELLER_DATA_ROUTES) {
      expect(reportablePath(route), route).toBeUndefined();
    }
  });

  it("strips the query string from a path it does report", () => {
    // `?next=/deals/enq-abc` on a sign-in redirect would otherwise hand an
    // operator route to two advertising networks.
    expect(reportablePath("/blog?utm_campaign=x&next=/deals/enq-abc")).toBe("/blog");
    expect(reportablePath("/glossary/true-discount#faq")).toBe("/glossary/true-discount");
  });

  it("normalises a trailing slash so one page is not two rows in a report", () => {
    expect(reportablePath("/blog/")).toBe("/blog");
  });
});

describe("event gating", () => {
  it("refuses any event on an excluded route", () => {
    for (const route of SELLER_DATA_ROUTES) {
      expect(mayTrack("page_view", route), route).toBe(false);
      expect(mayTrack("sell_intake_submitted", route), route).toBe(false);
    }
  });

  it("allows known events on public routes", () => {
    expect(mayTrack("sell_intake_started", "/sell")).toBe(true);
    expect(mayTrack("blog_post_viewed", "/blog/a-post")).toBe(true);
  });

  it("refuses an event name outside the vocabulary", () => {
    // Cast because the point is to prove a value that escaped the type system
    // is still refused at runtime.
    expect(mayTrack("investor_certified" as AnalyticsEvent, "/blog")).toBe(false);
    expect(mayTrack("account_sign_in" as AnalyticsEvent, "/blog")).toBe(false);
  });
});

describe("event properties", () => {
  it("drops anything resembling an email address", () => {
    expect(sanitiseProperties({ content: "seller@example.com" }).content).toBeUndefined();
  });

  it("drops anything resembling a UK postcode", () => {
    // A postcode plus a page view is enough to identify a household.
    expect(sanitiseProperties({ content: "B23 6TT" }).content).toBeUndefined();
    expect(sanitiseProperties({ category: "b236tt" }).category).toBeUndefined();
  });

  it("drops our own capability tokens and record numbers", () => {
    expect(sanitiseProperties({ content: "enq-vJ8kQ2mXpL9wR4tY" }).content).toBeUndefined();
    expect(sanitiseProperties({ content: "deal-0001" }).content).toBeUndefined();
    expect(sanitiseProperties({ content: "acc-1234abcd5678" }).content).toBeUndefined();
    expect(sanitiseProperties({ content: "buy-P8cvKiu3iMEIy7aQ" }).content).toBeUndefined();
  });

  it("keeps public slugs that merely start with a record-ish word", () => {
    // A first version of the identifier rule flagged anything beginning
    // "deal-", which silently dropped the topic name and the blog slug of the
    // most-read post on the site — both already public in the sitemap.
    expect(sanitiseProperties({ category: "deal-analysis" }).category).toBe("deal-analysis");
    expect(sanitiseProperties({ content: "deal-breakdown-erdington-b23" }).content).toBe(
      "deal-breakdown-erdington-b23",
    );
  });

  it("keeps a public slug and a topic", () => {
    const clean = sanitiseProperties({
      content: "why-we-rejected-handsworth-b21",
      category: "deal-analysis",
    });
    expect(clean.content).toBe("why-we-rejected-handsworth-b21");
    expect(clean.category).toBe("deal-analysis");
  });

  it("caps length so a body of text cannot be posted through a label", () => {
    expect(sanitiseProperties({ content: "x".repeat(200) }).content).toBeUndefined();
  });

  it("accepts only a sane step number", () => {
    expect(sanitiseProperties({ step: 3 }).step).toBe(3);
    expect(sanitiseProperties({ step: 0 }).step).toBeUndefined();
    expect(sanitiseProperties({ step: -1 }).step).toBeUndefined();
    expect(sanitiseProperties({ step: 1.5 }).step).toBeUndefined();
  });

  it("returns an empty object rather than undefined for no properties", () => {
    expect(sanitiseProperties()).toEqual({});
  });
});

describe("Meta event mapping", () => {
  it("maps the conversions Meta optimises against", () => {
    expect(META_STANDARD_EVENTS.sell_intake_submitted).toBe("Lead");
    expect(META_STANDARD_EVENTS.newsletter_confirmed).toBe("CompleteRegistration");
    expect(META_STANDARD_EVENTS.page_view).toBe("PageView");
  });

  it("maps only to real Meta standard event names", () => {
    // A misspelled standard event is silently treated as custom, and the
    // optimisation it was mapped for quietly stops happening.
    const standard = new Set([
      "PageView",
      "ViewContent",
      "Lead",
      "CompleteRegistration",
      "InitiateCheckout",
      "Contact",
      "Search",
      "Subscribe",
    ]);
    for (const [event, name] of Object.entries(META_STANDARD_EVENTS)) {
      expect(standard.has(name), `${event} -> ${name}`).toBe(true);
    }
  });
});

describe("consent", () => {
  it("treats anything other than an explicit yes as no", () => {
    // Unknown is not consent, and neither is a tampered cookie.
    expect(consentAllowsAnalytics(parseConsent(undefined))).toBe(false);
    expect(consentAllowsAnalytics(parseConsent(""))).toBe(false);
    expect(consentAllowsAnalytics(parseConsent("yes"))).toBe(false);
    expect(consentAllowsAnalytics(parseConsent("true"))).toBe(false);
    expect(consentAllowsAnalytics(parseConsent("GRANTED"))).toBe(false);
    expect(consentAllowsAnalytics(parseConsent("denied"))).toBe(false);
  });

  it("accepts the one value that means yes", () => {
    expect(consentAllowsAnalytics(parseConsent("granted"))).toBe(true);
  });
});
