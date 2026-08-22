import { NextResponse } from "next/server";
import { tokenMatches } from "@backend/auth/tokens";
import { redactEmail, resolveTransport } from "@backend/email";
import {
  absolute,
  composeIssue,
  isoWeekKey,
  recipientsForWeek,
  type PlatformStats,
  type SenderIdentity,
} from "@shared/domain/newsletter";
import { listBuyBoxes, listDeals, listFundingBoxes, listSubscribers, markIssueSent } from "@backend/store/repository";
import { scoreDeal } from "@shared/domain/dealScore";
import { toWorkingDeal } from "@shared/domain/workingDeal";

export const dynamic = "force-dynamic";

/**
 * Weekly newsletter send.
 *
 * Invoked by a scheduler (Vercel Cron, GitHub Actions, systemd timer — the
 * endpoint does not care) once a week. Point the schedule at Monday morning.
 *
 * Three properties matter more than anything else here:
 *
 *  1. AUTHENTICATED. This endpoint mails real people and is otherwise a free
 *     spam cannon for anyone who finds the URL. It requires CRON_SECRET and
 *     refuses to run at all if none is configured, rather than defaulting open.
 *  2. IDEMPOTENT. Recipients are selected by ISO week and each is stamped once
 *     sent, so a scheduler that fires twice, retries, or is triggered by hand
 *     after a partial failure will not mail anyone the same issue again.
 *  3. PARTIAL FAILURE IS SURVIVABLE. Sends are stamped per successful
 *     recipient, not in one batch at the end, so a provider outage halfway
 *     through leaves the first half marked and the rest to be picked up by the
 *     next run.
 */

/** Sends are spaced to stay inside typical provider rate limits. */
const SEND_GAP_MS = 120;

/** Runs are capped so one invocation cannot hang for an unbounded time. */
const MAX_PER_RUN = 500;

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    // Fail closed. An unconfigured secret means anyone can trigger a send.
    return NextResponse.json(
      { error: "CRON_SECRET is not configured; refusing to run." },
      { status: 503 },
    );
  }

  const provided = bearerToken(request.headers.get("authorization"));
  if (provided === undefined || !tokenMatches(provided, secret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const weekKey = isoWeekKey(new Date());
  const subscribers = await listSubscribers();
  const recipients = recipientsForWeek(subscribers, weekKey).slice(0, MAX_PER_RUN);

  if (recipients.length === 0) {
    return NextResponse.json({
      weekKey,
      recipients: 0,
      sent: 0,
      failed: 0,
      note: "No confirmed subscribers are due this issue.",
    });
  }

  const stats = await gatherStats();
  const transport = resolveTransport();
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const sender = senderIdentity();

  const sentIds: string[] = [];
  const failures: { email: string; error: string; retryable: boolean }[] = [];

  for (const subscriber of recipients) {
    const issue = composeIssue({ weekKey, baseUrl, stats, subscriber, sender });
    const unsubscribeUrl = absolute(
      baseUrl,
      `/newsletter/unsubscribe?token=${subscriber.unsubscribeToken}`,
    );

    const outcome = await transport.send({
      to: subscriber.email,
      subject: issue.subject,
      html: issue.html,
      text: issue.text,
      unsubscribeUrl,
    });

    if (outcome.ok) {
      sentIds.push(subscriber.id);
    } else {
      // Redacted: the log is operational, not a copy of the mailing list.
      failures.push({
        email: redactEmail(subscriber.email),
        error: outcome.error,
        retryable: outcome.retryable,
      });
    }

    // Stamp as we go rather than at the end. If the process dies mid-run,
    // everyone already mailed stays marked and will not be mailed twice.
    if (sentIds.length > 0 && sentIds.length % 25 === 0) {
      await markIssueSent(sentIds, weekKey);
    }

    if (SEND_GAP_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
    }
  }

  const stamped = await markIssueSent(sentIds, weekKey);

  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({
      event: "newsletter.run",
      weekKey,
      transport: transport.name,
      recipients: recipients.length,
      sent: sentIds.length,
      failed: failures.length,
    }),
  );

  return NextResponse.json({
    weekKey,
    transport: transport.name,
    recipients: recipients.length,
    sent: sentIds.length,
    stamped,
    failed: failures.length,
    failures,
  });
}

/**
 * GET reports what the next run would do without sending anything.
 *
 * Same authentication as POST: the answer includes how many people are on the
 * list, which is not public information.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  const provided = bearerToken(request.headers.get("authorization"));
  if (provided === undefined || !tokenMatches(provided, secret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const weekKey = isoWeekKey(new Date());
  const subscribers = await listSubscribers();
  return NextResponse.json({
    weekKey,
    transport: resolveTransport().name,
    confirmed: subscribers.filter((s) => s.status === "confirmed").length,
    pending: subscribers.filter((s) => s.status === "pending").length,
    unsubscribed: subscribers.filter((s) => s.status === "unsubscribed").length,
    dueThisWeek: recipientsForWeek(subscribers, weekKey).length,
  });
}

function bearerToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match?.[1];
}

/**
 * Sender identity, required in every marketing email.
 *
 * Falls back to placeholders that are obviously placeholders. A newsletter
 * quoting a fake registered address would be worse than one quoting none.
 */
function senderIdentity(): SenderIdentity {
  return {
    name: process.env.NEWSLETTER_SENDER_NAME ?? "Lode (sender identity not configured)",
    postalAddress:
      process.env.NEWSLETTER_SENDER_ADDRESS ?? "postal address not configured",
    replyTo: process.env.NEWSLETTER_REPLY_TO ?? "reply-to not configured",
  };
}

/** Real platform state. Every figure in the issue comes from here. */
async function gatherStats(): Promise<PlatformStats> {
  const [deals, fundingBoxes, buyBoxes] = await Promise.all([
    listDeals(),
    listFundingBoxes(),
    listBuyBoxes(),
  ]);

  const scored = deals.map((d) => scoreDeal(toWorkingDeal(d.inputs).inputs));
  const weekAgo = Date.now() - 7 * 86_400_000;

  return {
    totalDeals: deals.length,
    newThisWeek: deals.filter((d) => Date.parse(d.createdAt) >= weekAgo).length,
    bestScore: scored.reduce((best, s) => Math.max(best, s.breakdown.composite), 0),
    blockedCount: scored.filter((s) => s.protection.blocked).length,
    fundingMandates: fundingBoxes.filter((b) => b.active).length,
    buyBoxes: buyBoxes.filter((b) => b.active).length,
  };
}
