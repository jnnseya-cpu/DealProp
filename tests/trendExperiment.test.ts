import { describe, expect, it } from "vitest";
import {
  evaluateExperiment,
  freezeExperiment,
  type ExperimentPlan,
  type FreezeParams,
} from "@shared/domain/trend/experiment";

const freezeParams = (over: Partial<FreezeParams> = {}): FreezeParams => ({
  experimentId: "exp_91",
  hypothesis: "A clearer onboarding guide lifts qualified trials",
  baselineRate: 0.1,
  primaryOutcome: "qualified_trial_started",
  denominator: "eligible_session",
  segment: "small_teams",
  controlMethod: "holdout",
  minDetectableEffect: 0.1,
  observationTarget: 1000,
  windowStart: "2026-11-10T00:00:00Z",
  windowEnd: "2026-11-24T00:00:00Z",
  owner: "ana",
  ...over,
});

function plan(over: Partial<FreezeParams> = {}): ExperimentPlan {
  const r = freezeExperiment(freezeParams(over));
  if (!r.ok) throw new Error(r.reason);
  return r.plan;
}

describe("freezeExperiment (§10.1)", () => {
  it("freezes a valid plan", () => {
    expect(freezeExperiment(freezeParams()).ok).toBe(true);
  });
  it("rejects an inverted window", () => {
    expect(freezeExperiment(freezeParams({ windowStart: "2026-11-24T00:00:00Z", windowEnd: "2026-11-10T00:00:00Z" })).ok).toBe(false);
  });
  it("requires an owner and a primary outcome", () => {
    expect(freezeExperiment(freezeParams({ owner: "" })).ok).toBe(false);
    expect(freezeExperiment(freezeParams({ primaryOutcome: "" })).ok).toBe(false);
  });
});

describe("evaluateExperiment hard stops (§10.3)", () => {
  it("rolls back immediately on a policy incident, whatever the metric", () => {
    const r = evaluateExperiment(plan(), { treatmentEligible: 5000, treatmentOutcomes: 4000, policyIncident: true });
    expect(r.recommendation).toBe("rollback");
  });
  it("rolls back immediately on stock unavailable", () => {
    const r = evaluateExperiment(plan(), { treatmentEligible: 5000, treatmentOutcomes: 4000, stockUnavailable: true });
    expect(r.recommendation).toBe("rollback");
  });
  it("rolls back on a breached guardrail (refund rate)", () => {
    const p = plan({ guardrails: [{ metric: "refund_rate", direction: "max", threshold: 0.05 }] });
    const r = evaluateExperiment(p, { treatmentEligible: 5000, treatmentOutcomes: 900, guardrailValues: { refund_rate: 0.09 } });
    expect(r.recommendation).toBe("rollback");
    expect(r.guardrailBreaches.length).toBe(1);
  });
});

describe("evaluateExperiment maturity and credibility (§10.3)", () => {
  it("keeps gathering below the observation target — never promotes on noise", () => {
    const r = evaluateExperiment(plan(), { treatmentEligible: 200, treatmentOutcomes: 60, controlEligible: 200, controlOutcomes: 20 });
    expect(r.mature).toBe(false);
    expect(r.recommendation).toBe("continue");
  });

  it("continues a mature, credible positive above the MDE", () => {
    // treatment 0.15, control 0.10 → relative +0.5 ≥ MDE 0.1
    const r = evaluateExperiment(plan(), { treatmentEligible: 2000, treatmentOutcomes: 300, controlEligible: 2000, controlOutcomes: 200 });
    expect(r.mature).toBe(true);
    expect(r.recommendation).toBe("continue");
    expect(r.lift?.relative).toBeCloseTo(0.5, 5);
  });

  it("rolls back a mature, clearly-negative result", () => {
    // treatment 0.06, control 0.10 → relative -0.4 ≤ -MDE
    const r = evaluateExperiment(plan(), { treatmentEligible: 2000, treatmentOutcomes: 120, controlEligible: 2000, controlOutcomes: 200 });
    expect(r.mature).toBe(true);
    expect(r.recommendation).toBe("rollback");
  });

  it("revises a mature but flat result rather than scaling on noise", () => {
    // treatment 0.102, control 0.10 → relative +0.02 < MDE 0.1
    const r = evaluateExperiment(plan(), { treatmentEligible: 5000, treatmentOutcomes: 510, controlEligible: 5000, controlOutcomes: 500 });
    expect(r.mature).toBe(true);
    expect(r.recommendation).toBe("revise");
  });
});

describe("evaluateExperiment observational and confound (§10.2)", () => {
  it("marks a result observational when there is no randomised/holdout control", () => {
    const p = plan({ controlMethod: "matched_control" });
    const r = evaluateExperiment(p, { treatmentEligible: 2000, treatmentOutcomes: 300 });
    expect(r.lift?.observational).toBe(true);
  });

  it("is inconclusive under a site-wide confound", () => {
    const r = evaluateExperiment(plan(), { treatmentEligible: 2000, treatmentOutcomes: 300, controlEligible: 2000, controlOutcomes: 200, confounded: true });
    expect(r.recommendation).toBe("inconclusive");
  });
});
