import { describe, expect, it } from "vitest";
import { agentPaused, anyAgentPaused, describePause, parseAgentPause } from "@shared/domain/agentControls";

/**
 * The agent kill switch. The tests that matter are that an empty value runs
 * everything, "all" pauses everything, and a named list pauses only those kinds
 * — a parser that over- or under-reads the switch is a safety control that
 * lies.
 */

describe("parsing the pause value", () => {
  it("empty or absent means nothing is paused", () => {
    for (const raw of [undefined, "", "   "]) {
      const p = parseAgentPause(raw);
      expect(p.all).toBe(false);
      expect(p.kinds).toEqual([]);
      expect(anyAgentPaused(p)).toBe(false);
    }
  });

  it("'all' (and its synonyms) pause every kind", () => {
    for (const raw of ["all", "ALL", "1", "true", "on"]) {
      const p = parseAgentPause(raw);
      expect(p.all).toBe(true);
      expect(agentPaused(p, "live-analysis")).toBe(true);
      expect(agentPaused(p, "intake-qualification")).toBe(true);
    }
  });

  it("a named list pauses only those kinds", () => {
    const p = parseAgentPause("live-analysis");
    expect(p.all).toBe(false);
    expect(agentPaused(p, "live-analysis")).toBe(true);
    expect(agentPaused(p, "intake-qualification")).toBe(false);
  });

  it("ignores unknown kinds rather than pausing everything", () => {
    const p = parseAgentPause("not-a-kind, intake-qualification");
    expect(p.kinds).toEqual(["intake-qualification"]);
    expect(agentPaused(p, "live-analysis")).toBe(false);
    expect(agentPaused(p, "intake-qualification")).toBe(true);
  });

  it("deterministic observers are never paused by a list", () => {
    expect(agentPaused(parseAgentPause("deterministic"), "deterministic")).toBe(false);
    // but "all" is all
    expect(agentPaused(parseAgentPause("all"), "deterministic")).toBe(true);
  });

  it("describes what is paused for a read-only surface", () => {
    expect(describePause(parseAgentPause(""))).toMatch(/no agents/i);
    expect(describePause(parseAgentPause("all"))).toMatch(/all/i);
    expect(describePause(parseAgentPause("live-analysis"))).toMatch(/live-analysis/);
  });
});
