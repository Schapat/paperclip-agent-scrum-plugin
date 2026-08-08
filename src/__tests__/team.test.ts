/**
 * Tests for the team definition and its reporting line.
 *
 * The plugin cannot set the hierarchy structurally (the managed-agent schema
 * has no `reportsTo`), so the least it must do is state the intent correctly
 * and notice when reality differs.
 */

import { describe, it, expect } from "vitest";
import {
  TEAM,
  describeReportingLine,
  detectReportingDrift,
  expectedSuperiorId,
  teamMember,
  type TeamAgentKey,
} from "../team";

describe("team definition", () => {
  it("declares exactly the six Scrum roles", () => {
    expect(TEAM).toHaveLength(6);
    expect(TEAM.map((m) => m.role).sort()).toEqual([
      "developer",
      "developer",
      "product_owner",
      "qa_engineer",
      "scrum_master",
      "technical_lead",
    ]);
  });

  it("uses unique agent keys", () => {
    const keys = TEAM.map((m) => m.agentKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses keys the host accepts", () => {
    // agentKey must be a lowercase slug; a mismatch fails manifest validation
    for (const member of TEAM) {
      expect(member.agentKey).toMatch(/^[a-z0-9][a-z0-9._:-]*$/);
    }
  });

  it("has developers report to the Technical Lead", () => {
    for (const dev of TEAM.filter((m) => m.role === "developer")) {
      expect(dev.reportsTo).toBe("technical-lead");
    }
  });

  it("has every other role report to the company lead", () => {
    for (const member of TEAM.filter((m) => m.role !== "developer")) {
      expect(member.reportsTo).toBeNull();
    }
  });

  it("never points a reporting line at a missing member", () => {
    for (const member of TEAM) {
      if (member.reportsTo === null) continue;
      expect(teamMember(member.reportsTo)).toBeDefined();
    }
  });

  it("contains no reporting cycles", () => {
    for (const member of TEAM) {
      const seen = new Set<string>();
      let cursor: TeamAgentKey | null = member.reportsTo;
      while (cursor) {
        expect(seen.has(cursor)).toBe(false);
        seen.add(cursor);
        cursor = teamMember(cursor)?.reportsTo ?? null;
      }
    }
  });
});

describe("describeReportingLine", () => {
  it("renders the tree with developers under the Technical Lead", () => {
    const tree = describeReportingLine();

    expect(tree).toContain("Company lead (CEO)");
    expect(tree.indexOf("Technical Lead")).toBeLessThan(tree.indexOf("Developer 1"));
    expect(tree).toContain("Developer 2");
  });
});

describe("detectReportingDrift", () => {
  /** Resolution map as the worker builds it after reconciling. */
  function resolutions(overrides: Record<string, string | null> = {}) {
    const map = new Map<string, { agentId: string; reportsTo: string | null }>();
    for (const member of TEAM) {
      const id = `id-${member.agentKey}`;
      const expected =
        member.reportsTo === null ? null : `id-${member.reportsTo}`;
      map.set(member.agentKey, {
        agentId: id,
        reportsTo: member.agentKey in overrides ? overrides[member.agentKey] : expected,
      });
    }
    return map;
  }

  it("reports nothing when the hierarchy matches", () => {
    expect(detectReportingDrift(resolutions())).toEqual([]);
  });

  it("flags a developer that does not report to the Technical Lead", () => {
    // Freshly created managed agents have no superior at all — the common case
    const drift = detectReportingDrift(resolutions({ "developer-1": null }));

    expect(drift).toHaveLength(1);
    expect(drift[0].displayName).toBe("Developer 1");
    expect(drift[0].expected).toBe("Technical Lead");
  });

  it("flags a developer reporting to the wrong agent", () => {
    const drift = detectReportingDrift(resolutions({ "developer-2": "id-product-owner" }));

    expect(drift.map((d) => d.displayName)).toEqual(["Developer 2"]);
    expect(drift[0].actualAgentId).toBe("id-product-owner");
  });

  it("accepts a null superior when the company has no lead", () => {
    // Without a CEO these roles genuinely are top level
    expect(detectReportingDrift(resolutions({ "product-owner": null }))).toEqual([]);
  });

  it("flags a lead-level role not reporting to the CEO", () => {
    // An empty reportsTo puts the role *beside* the CEO in the org chart
    const drift = detectReportingDrift(resolutions({ "product-owner": null }), "id-ceo");

    expect(drift.map((d) => d.displayName)).toContain("Product Owner");
    expect(drift.find((d) => d.displayName === "Product Owner")?.expected).toBe(
      "the company lead",
    );
  });

  it("accepts lead-level roles that already report to the CEO", () => {
    const withCeo = resolutions();
    for (const member of TEAM.filter((m) => m.reportsTo === null)) {
      withCeo.set(member.agentKey, { agentId: `id-${member.agentKey}`, reportsTo: "id-ceo" });
    }

    expect(detectReportingDrift(withCeo, "id-ceo")).toEqual([]);
  });

  it("flags a lead-level role that reports into the team", () => {
    const drift = detectReportingDrift(resolutions({ "scrum-master": "id-technical-lead" }));

    expect(drift).toHaveLength(1);
    expect(drift[0].expected).toBe("the company lead");
  });

  it("resolves the intended superior for each role", () => {
    const map = resolutions();
    const dev = TEAM.find((m) => m.agentKey === "developer-1")!;
    const po = TEAM.find((m) => m.agentKey === "product-owner")!;

    expect(expectedSuperiorId(dev, map, "id-ceo")).toBe("id-technical-lead");
    expect(expectedSuperiorId(po, map, "id-ceo")).toBe("id-ceo");
    expect(expectedSuperiorId(po, map, null)).toBeNull();
  });

  it("ignores members that were not resolved", () => {
    const partial = new Map([
      ["developer-1", { agentId: "id-developer-1", reportsTo: "id-technical-lead" }],
    ]);
    // technical-lead missing from the map — nothing to compare against
    expect(detectReportingDrift(partial)).toEqual([]);
  });
});
