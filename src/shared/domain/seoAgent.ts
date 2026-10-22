import type { BlogPost, Topic } from "@shared/domain/blog";
import { TOPIC_DEFINITIONS, TOPICS } from "@shared/domain/blog";
import type { SeoReport } from "@shared/domain/seo";

/**
 * The SEO agent: what to do next about the blog, ranked.
 *
 * It is an agent in the §12 sense, not a model. It observes two things this
 * codebase already computes — the SEO audit (`seo.ts`, which checks only what
 * we control) and how often each post is actually opened (`blogViews`, counted
 * on our own server) — and turns them into a ranked list of actions a named
 * person decides on. It does not write anything, it does not publish anything,
 * and it does not touch a figure. When a person chooses to act on a "write"
 * proposal, the drafter at the edge (`backend/blog/agent.ts`) helps draft the
 * prose, and the engine fills the numbers; the agent only decides the queue.
 *
 * It is deliberately deterministic for the same reason `seo.ts` is an audit and
 * not a prediction: it never claims to know a ranking, a backlink or a search
 * volume, because none of those is knowable from here. Every proposal is
 * grounded in a figure the codebase can see — a score, an issue count, how many
 * times a post was opened, how many posts cover a topic, how long since one was
 * updated. A recommendation it cannot ground, it does not make.
 */

export type SeoProposalKind = "fix-post" | "cover-topic" | "refresh";

export interface SeoProposal {
  readonly id: string;
  readonly kind: SeoProposalKind;
  /** 0–100, higher means act sooner. Computed, never guessed. */
  readonly priority: number;
  readonly severity: "problem" | "improvement";
  /** What to do, as an instruction. */
  readonly action: string;
  /** Why, in figures. Never "looks good" and never a ranking claim. */
  readonly reason: string;
  /** The slug, topic or term this concerns. */
  readonly target: string;
  /** Where to go to act on it. */
  readonly href: string;
}

export interface SeoAgentInput {
  readonly corpus: readonly BlogPost[];
  readonly reports: readonly SeoReport[];
  /** Opens per slug, from the server-side count. */
  readonly views: ReadonlyMap<string, number>;
  readonly now?: Date;
}

/** Beyond this a post is old enough to be worth a freshness review. */
const STALE_MONTHS = 12;

function monthsSince(iso: string, now: Date): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.floor((now.getTime() - then) / (1000 * 60 * 60 * 24 * 30.44));
}

/**
 * How much the traffic a post gets should raise the priority of fixing it.
 *
 * A problem on a post nobody opens is worth less than the same problem on the
 * one people actually read. Capped, so a single popular post cannot swamp the
 * queue, and log-shaped so the tenth open matters less than the first.
 */
function trafficBoost(views: number): number {
  if (views <= 0) return 0;
  return Math.min(25, Math.round(Math.log2(views + 1) * 5));
}

/**
 * Turn the audit and the view counts into a ranked action list.
 *
 * Three kinds of proposal, each grounded in a figure: fix an existing post that
 * the audit flags, cover a topic that is thin or missing, and refresh a post
 * that has gone stale. Ranked by a computed priority, worst first.
 */
export function proposeSeoActions(input: SeoAgentInput): readonly SeoProposal[] {
  const now = input.now ?? new Date();
  const proposals: SeoProposal[] = [];

  // 1. Fix existing posts the audit flags.
  for (const report of input.reports) {
    if (report.issues.length === 0) continue;
    const views = input.views.get(report.slug) ?? 0;
    const hasProblem = report.issues.some((i) => i.severity === "problem");
    const worst = report.issues[0];
    // A low score and a real problem both raise priority; so does traffic.
    const base = hasProblem ? 55 : 35;
    const scoreGap = Math.max(0, 100 - report.score); // worse score, higher
    const priority = Math.min(100, base + Math.round(scoreGap * 0.3) + trafficBoost(views));
    proposals.push({
      id: `fix:${report.slug}`,
      kind: "fix-post",
      priority,
      severity: hasProblem ? "problem" : "improvement",
      action: `Fix “${report.title}”`,
      reason: `SEO ${report.score} (${report.band}), ${report.issues.length} issue${
        report.issues.length === 1 ? "" : "s"
      }, ${views.toLocaleString("en-GB")} open${views === 1 ? "" : "s"}.${
        worst?.remedy !== undefined ? ` Start with: ${worst.remedy}` : ""
      }`,
      target: report.slug,
      href: `/blog/${report.slug}`,
    });
  }

  // 2. Cover topics that are thin or missing.
  const postsByTopic = new Map<Topic, number>();
  for (const post of input.corpus) {
    postsByTopic.set(post.topic, (postsByTopic.get(post.topic) ?? 0) + 1);
  }
  for (const topic of TOPICS) {
    const count = postsByTopic.get(topic) ?? 0;
    if (count >= 2) continue; // covered
    const label = TOPIC_DEFINITIONS[topic].label;
    proposals.push({
      id: `topic:${topic}`,
      kind: "cover-topic",
      // A topic with nothing is a strategic hole; one with a single post is a
      // gap worth filling but not urgent.
      priority: count === 0 ? 70 : 40,
      severity: count === 0 ? "problem" : "improvement",
      action: count === 0 ? `Write the first post on ${label}` : `Add a second post on ${label}`,
      reason:
        count === 0
          ? `No post covers ${label}. A topic hub with nothing under it is an empty promise.`
          : `Only one post covers ${label}. A single post does not make a hub a reader trusts.`,
      target: topic,
      href: `/blog/topic/${topic}`,
    });
  }

  // 3. Refresh posts that have gone stale.
  for (const post of input.corpus) {
    const age = monthsSince(post.updatedAt, now);
    if (age < STALE_MONTHS) continue;
    const views = input.views.get(post.slug) ?? 0;
    proposals.push({
      id: `refresh:${post.slug}`,
      kind: "refresh",
      priority: Math.min(60, 25 + Math.round((age - STALE_MONTHS) * 1.5) + trafficBoost(views)),
      severity: "improvement",
      action: `Review “${post.title}”`,
      reason: `Not updated in ${age} months, ${views.toLocaleString("en-GB")} open${
        views === 1 ? "" : "s"
      }. Figures and law move; a reader is entitled to a current date.`,
      target: post.slug,
      href: `/blog/${post.slug}`,
    });
  }

  return proposals.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export interface SeoAgentDigest {
  readonly total: number;
  readonly problems: number;
  readonly toFix: number;
  readonly toWrite: number;
  readonly toRefresh: number;
  /** One honest sentence for a page to show. */
  readonly summary: string;
}

/** A digest of the queue, for the top of the operator page. */
export function seoAgentDigest(proposals: readonly SeoProposal[]): SeoAgentDigest {
  const by = (k: SeoProposalKind): number => proposals.filter((p) => p.kind === k).length;
  const problems = proposals.filter((p) => p.severity === "problem").length;
  const toFix = by("fix-post");
  const toWrite = by("cover-topic");
  const toRefresh = by("refresh");
  return {
    total: proposals.length,
    problems,
    toFix,
    toWrite,
    toRefresh,
    summary:
      proposals.length === 0
        ? "Nothing to do: every post clears the audit and every topic is covered."
        : `${proposals.length} recommended action${proposals.length === 1 ? "" : "s"} — ${toFix} to fix, ${toWrite} to write, ${toRefresh} to refresh${
            problems > 0 ? `, ${problems} flagged as a problem` : ""
          }. From the audit and the open counts, not from any guess about rankings.`,
  };
}
