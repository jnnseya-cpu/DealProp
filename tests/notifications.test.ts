import { describe, expect, it } from "vitest";
import {
  channelCoverage,
  NOTIFICATION_CATALOGUE,
  notificationEvent,
  permittedChannels,
  routeEvent,
  type Channel,
  type ChannelContext,
  type NotificationEvent,
} from "@shared/domain/notifications";

/** A context with everything reachable and nothing consented or suppressed. */
function ctx(over: {
  reachable?: Partial<Record<Channel, boolean>>;
  marketingConsent?: Partial<Record<Channel, boolean>>;
  suppressed?: Partial<Record<Channel, boolean>>;
} = {}): ChannelContext {
  const all = (v: boolean) => ({ inapp: v, email: v, sms: v, push: v });
  return {
    reachable: { ...all(true), ...over.reachable },
    marketingConsent: { ...all(false), ...over.marketingConsent },
    suppressed: { ...all(false), ...over.suppressed },
  };
}

const ev = (key: string) => notificationEvent(key)!;

describe("notification routing — lawful basis", () => {
  it("delivers a security notice even when the channel is suppressed", () => {
    // "your password changed" cannot be silenced by a marketing opt-out.
    const decisions = routeEvent(ev("password.changed"), ctx({ suppressed: { email: true } }));
    const email = decisions.find((d) => d.channel === "email")!;
    expect(email.permitted).toBe(true);
  });

  it("stops a service message on a suppressed channel, but keeps the in-app copy", () => {
    const channels = permittedChannels(ev("payment.successful"), ctx({ suppressed: { email: true } }));
    expect(channels).not.toContain("email");
    expect(channels).toContain("inapp");
  });

  it("sends marketing email only with recorded consent and no suppression", () => {
    const noConsent = permittedChannels(ev("marketing.newsletter"), ctx());
    expect(noConsent).not.toContain("email");

    const consented = permittedChannels(ev("marketing.newsletter"), ctx({ marketingConsent: { email: true } }));
    expect(consented).toContain("email");

    const suppressed = permittedChannels(
      ev("marketing.newsletter"),
      ctx({ marketingConsent: { email: true }, suppressed: { email: true } }),
    );
    expect(suppressed).not.toContain("email");
  });

  it("never sends marketing to an individual by SMS or push (PECR reg. 22)", () => {
    const marketingBySms: NotificationEvent = {
      key: "test.marketing",
      category: "Marketing",
      title: "test",
      lawfulBasis: "marketing",
      severity: "info",
      channels: ["email", "sms", "push"],
    };
    // Everything reachable and fully consented — still refused on sms/push.
    const decisions = routeEvent(
      marketingBySms,
      ctx({ marketingConsent: { email: true, sms: true, push: true } }),
    );
    expect(decisions.find((d) => d.channel === "sms")!.permitted).toBe(false);
    expect(decisions.find((d) => d.channel === "push")!.permitted).toBe(false);
    expect(decisions.find((d) => d.channel === "sms")!.reason).toMatch(/PECR/);
    expect(decisions.find((d) => d.channel === "email")!.permitted).toBe(true);
  });

  it("never sends on an unreachable channel", () => {
    const channels = permittedChannels(ev("payment.failed"), ctx({ reachable: { sms: false } }));
    expect(channels).not.toContain("sms");
    expect(channels).toContain("email");
  });

  it("always records to the in-app inbox regardless of consent or suppression", () => {
    const marketing = permittedChannels(
      ev("marketing.opportunity_digest"),
      ctx({ suppressed: { inapp: true } }),
    );
    expect(marketing).toContain("inapp");
  });

  it("gives every configured channel a decision with a reason", () => {
    const decisions = routeEvent(ev("auth.login.suspicious"), ctx());
    expect(decisions.length).toBe(ev("auth.login.suspicious").channels.length);
    for (const d of decisions) expect(d.reason.length).toBeGreaterThan(0);
  });
});

describe("notification catalogue invariants", () => {
  it("gives every event at least one channel and a known basis", () => {
    for (const e of Object.values(NOTIFICATION_CATALOGUE)) {
      expect(e.channels.length).toBeGreaterThan(0);
      expect(["service", "security", "marketing"]).toContain(e.lawfulBasis);
    }
  });

  it("never configures a marketing event on SMS or push", () => {
    for (const e of Object.values(NOTIFICATION_CATALOGUE)) {
      if (e.lawfulBasis !== "marketing") continue;
      expect(e.channels).not.toContain("sms");
      expect(e.channels).not.toContain("push");
    }
  });

  it("counts channel coverage consistently with the catalogue", () => {
    const coverage = channelCoverage();
    const inappByHand = Object.values(NOTIFICATION_CATALOGUE).filter((e) =>
      e.channels.includes("inapp"),
    ).length;
    expect(coverage.inapp).toBe(inappByHand);
  });
});
