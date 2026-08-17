import { describe, expect, it } from "vitest";
import {
  absolute,
  composeIssue,
  escapeHtml,
  featuresFor,
  FEATURES,
  isMailable,
  isoWeekKey,
  LINKS,
  mailableSubscribers,
  normaliseEmail,
  recipientsForWeek,
  type PlatformStats,
  type SenderIdentity,
  type Subscriber,
} from "@/domain/newsletter";
import { consoleTransport, redactEmail, resolveTransport } from "@/lib/email";
import { newToken, tokenMatches } from "@/lib/tokens";

function subscriber(overrides: Partial<Subscriber> = {}): Subscriber {
  return {
    id: "sub-1",
    email: "reader@example.com",
    audience: "investor",
    status: "confirmed",
    consentText: "I agree to receive a weekly email.",
    createdAt: "2026-08-01T00:00:00.000Z",
    confirmedAt: "2026-08-01T00:05:00.000Z",
    confirmToken: "confirm-token",
    unsubscribeToken: "unsub-token",
    source: "newsletter-form",
    ...overrides,
  };
}

const STATS: PlatformStats = {
  totalDeals: 5,
  newThisWeek: 2,
  bestScore: 62,
  blockedCount: 1,
  fundingMandates: 3,
  buyBoxes: 3,
};

const SENDER: SenderIdentity = {
  name: "Lode Ltd",
  postalAddress: "1 Example Street, Birmingham B1 1AA",
  replyTo: "hello@example.com",
};

describe("consent gating", () => {
  it("mails only confirmed subscribers", () => {
    expect(isMailable(subscriber({ status: "confirmed" }))).toBe(true);
    expect(isMailable(subscriber({ status: "pending" }))).toBe(false);
    expect(isMailable(subscriber({ status: "unsubscribed" }))).toBe(false);
    expect(isMailable(subscriber({ status: "bounced" }))).toBe(false);
  });

  it("never includes an unconfirmed address in a send", () => {
    // Double opt-in is the whole safeguard: a pending address belongs to
    // someone who has not agreed, possibly because someone else typed it.
    const all = [
      subscriber({ id: "a", status: "pending" }),
      subscriber({ id: "b", email: "b@example.com", status: "confirmed" }),
      subscriber({ id: "c", email: "c@example.com", status: "unsubscribed" }),
    ];
    const mailable = mailableSubscribers(all);
    expect(mailable.map((s) => s.id)).toEqual(["b"]);
  });

  it("drops a subscriber from future sends the moment they unsubscribe", () => {
    const before = subscriber();
    expect(recipientsForWeek([before], "2026-W33")).toHaveLength(1);
    const after = { ...before, status: "unsubscribed" as const };
    expect(recipientsForWeek([after], "2026-W33")).toHaveLength(0);
  });
});

describe("idempotency", () => {
  it("excludes anyone already sent this week", () => {
    const sent = subscriber({ lastSentWeek: "2026-W33" });
    expect(recipientsForWeek([sent], "2026-W33")).toHaveLength(0);
  });

  it("includes them again the following week", () => {
    const sent = subscriber({ lastSentWeek: "2026-W33" });
    expect(recipientsForWeek([sent], "2026-W34")).toHaveLength(1);
  });

  it("computes stable ISO week keys", () => {
    // 2026-08-17 is a Monday in ISO week 34.
    expect(isoWeekKey(new Date("2026-08-17T00:00:00Z"))).toBe("2026-W34");
    // Same week, later day, must produce the same key or a re-run double-sends.
    expect(isoWeekKey(new Date("2026-08-23T23:59:00Z"))).toBe("2026-W34");
    // Next day rolls over.
    expect(isoWeekKey(new Date("2026-08-24T00:00:00Z"))).toBe("2026-W35");
  });

  it("keeps the key stable across a run that spans hours", () => {
    const start = isoWeekKey(new Date("2026-08-17T00:01:00Z"));
    const end = isoWeekKey(new Date("2026-08-17T23:59:00Z"));
    expect(start).toBe(end);
  });
});

describe("issue composition", () => {
  const ctx = {
    weekKey: "2026-W34",
    baseUrl: "https://lode.example",
    stats: STATS,
    subscriber: subscriber(),
    sender: SENDER,
  };

  it("always includes a working unsubscribe link", () => {
    // Legally required in every marketing message. If this ever fails, the
    // send must not go out.
    const issue = composeIssue(ctx);
    const unsubscribe = `https://lode.example/newsletter/unsubscribe?token=unsub-token`;
    expect(issue.html).toContain(unsubscribe);
    expect(issue.text).toContain(unsubscribe);
    expect(issue.links).toContain(unsubscribe);
  });

  it("includes the sender identity", () => {
    const issue = composeIssue(ctx);
    expect(issue.html).toContain("Lode Ltd");
    expect(issue.html).toContain("1 Example Street");
    expect(issue.text).toContain("hello@example.com");
  });

  it("produces many hyperlinks, all absolute", () => {
    const issue = composeIssue(ctx);
    expect(issue.links.length).toBeGreaterThanOrEqual(4);
    for (const link of issue.links) {
      expect(link.startsWith("https://lode.example")).toBe(true);
    }
  });

  it("only links to routes that exist", () => {
    // A newsletter linking to a 404 costs more trust than it earns.
    const known = new Set<string>(Object.values(LINKS));
    for (const feature of FEATURES) {
      expect(known.has(feature.path)).toBe(true);
    }
  });

  it("uses real platform figures, not invented ones", () => {
    const issue = composeIssue(ctx);
    expect(issue.subject).toContain("2");
    expect(issue.html).toContain("5 opportunities");
    expect(issue.html).toContain("3 capital mandates");
  });

  it("adapts the subject when nothing new arrived", () => {
    const quiet = composeIssue({ ...ctx, stats: { ...STATS, newThisWeek: 0 } });
    expect(quiet.subject).not.toContain("new opportunit");
    expect(quiet.subject).toContain("pipeline");
  });

  it("sends a plain-text alternative alongside the HTML", () => {
    const issue = composeIssue(ctx);
    expect(issue.text.length).toBeGreaterThan(200);
    expect(issue.text).not.toContain("<table");
  });

  it("segments content by audience", () => {
    const funder = composeIssue({ ...ctx, subscriber: subscriber({ audience: "funder" }) });
    const curious = composeIssue({ ...ctx, subscriber: subscriber({ audience: "curious" }) });
    expect(funder.html).not.toBe(curious.html);
    expect(featuresFor("funder").length).toBeGreaterThan(0);
    expect(featuresFor("curious").length).toBeGreaterThan(0);
  });

  it("escapes content that reaches the HTML", () => {
    const hostile = composeIssue({
      ...ctx,
      sender: { ...SENDER, name: '<script>alert("x")</script>' },
    });
    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).toContain("&lt;script&gt;");
  });
});

describe("address handling", () => {
  it("normalises case and whitespace", () => {
    expect(normaliseEmail("  Reader@Example.COM ")).toBe("reader@example.com");
  });

  it("rejects addresses containing newlines", () => {
    // Header injection: a newline could add arbitrary SMTP headers.
    expect(normaliseEmail("a@b.com\nBcc: victim@example.com")).toBeUndefined();
    expect(normaliseEmail("a@b.com\rX: y")).toBeUndefined();
  });

  it("rejects malformed and absurd addresses", () => {
    expect(normaliseEmail("")).toBeUndefined();
    expect(normaliseEmail("no-at-sign")).toBeUndefined();
    expect(normaliseEmail("no@tld")).toBeUndefined();
    expect(normaliseEmail(`${"a".repeat(250)}@example.com`)).toBeUndefined();
  });

  it("accepts ordinary addresses", () => {
    expect(normaliseEmail("a.b+tag@sub.example.co.uk")).toBe("a.b+tag@sub.example.co.uk");
  });

  it("redacts addresses for logs", () => {
    const redacted = redactEmail("reader@example.com");
    expect(redacted).toContain("@example.com");
    expect(redacted).not.toContain("reader");
  });
});

describe("tokens", () => {
  it("generates unique, high-entropy tokens", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t.length).toBeGreaterThanOrEqual(40);
  });

  it("compares in constant time and rejects mismatches", () => {
    const token = newToken();
    expect(tokenMatches(token, token)).toBe(true);
    expect(tokenMatches(token, newToken())).toBe(false);
    expect(tokenMatches(token, "")).toBe(false);
    expect(tokenMatches(token, `${token}x`)).toBe(false);
  });
});

describe("transport", () => {
  it("falls back to a non-sending transport when unconfigured", () => {
    // Fail closed: an unconfigured deployment must not mail real people.
    expect(resolveTransport({}).name).toBe("console");
  });

  it("requires every credential before it will send for real", () => {
    const partial = { EMAIL_API_URL: "https://x", EMAIL_API_KEY: "" };
    expect(resolveTransport(partial).name).toBe("console");
  });

  it("uses the HTTP transport once fully configured", () => {
    const full = {
      EMAIL_API_URL: "https://provider.example/send",
      EMAIL_API_KEY: "key",
      EMAIL_FROM: "Lode <hello@example.com>",
    };
    expect(resolveTransport(full).name).toBe("http");
  });

  it("reports success without sending on the console transport", async () => {
    const outcome = await consoleTransport.send({
      to: "reader@example.com",
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      unsubscribeUrl: "https://lode.example/newsletter/unsubscribe?token=x",
    });
    expect(outcome.ok).toBe(true);
  });
});

describe("url building", () => {
  it("joins base and path without doubling slashes", () => {
    expect(absolute("https://lode.example/", "/deals")).toBe("https://lode.example/deals");
    expect(absolute("https://lode.example", "deals")).toBe("https://lode.example/deals");
  });

  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});
