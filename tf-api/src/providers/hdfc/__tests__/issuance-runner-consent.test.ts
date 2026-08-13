import { describe, it, expect } from "vitest";
import {
  parsePhase,
  parseOnly,
  parseRps,
  consentError,
  planRun,
} from "../../../../scripts/hdfc-uat-issuance.ts";

/**
 * The consent gate on scripts/hdfc-uat-issuance.ts is the one code path in this
 * provider that BINDS REAL POLICIES on HDFC's shared UAT sandbox. It used to live
 * at module top level behind `process.exit`, which made it unimportable and so
 * untested — and it failed OPEN: `--phase=ISSUED`, `--phase=` and `--phase=bind`
 * all fell past both gates straight into `provider.issuePolicy()`.
 *
 * These tests pin the gate to fail CLOSED. They never touch the network: the
 * functions under test are pure, and the runner's top level only executes when
 * the file is the process entrypoint.
 */

/** Would `argv` be allowed to run at all? Exactly what the runner's top level asks. */
function allowed(argv: string[]): boolean {
  return !("error" in planRun(argv));
}

/** The refusal message a blocked argv produces. */
function refusal(argv: string[]): string {
  const plan = planRun(argv);
  if (!("error" in plan)) throw new Error(`expected ${JSON.stringify(argv)} to be refused`);
  return plan.error;
}

describe("issuance runner consent gate", () => {
  // Each row is exactly one invocation of `npm run hdfc:issue -- <argv>`.
  const table: ReadonlyArray<{ argv: string[]; allow: boolean; why: string }> = [
    { argv: [], allow: false, why: "defaults to proposal and carries no consent flag" },
    { argv: ["--phase=proposal"], allow: false, why: "no consent flag" },
    {
      argv: ["--phase=proposal", "--yes-i-will-create-proposals"],
      allow: true,
      why: "the proposal phase with its own flag",
    },
    { argv: ["--phase=issue"], allow: false, why: "no consent flag" },
    {
      argv: ["--phase=issue", "--yes-i-will-create-proposals"],
      allow: false,
      why: "the proposal flag does not authorise binding",
    },
    {
      argv: ["--phase=issue", "--yes-i-will-bind-policies"],
      allow: true,
      why: "the binding phase with the binding flag",
    },
    {
      argv: ["--phase=ISSUE", "--yes-i-will-create-proposals"],
      allow: false,
      why: "phase is matched exactly — a capitalisation slip is not 'issue'",
    },
    { argv: ["--phase="], allow: false, why: "an empty phase is not a phase" },
    { argv: ["--phase=bind"], allow: false, why: "an unknown phase word" },
    {
      argv: ["--phase", "issue"],
      allow: false,
      why: "space-separated is not parsed, so this defaults to proposal with no flag",
    },
  ];

  for (const { argv, allow, why } of table) {
    it(`${allow ? "allows" : "refuses"} \`${argv.join(" ") || "(no args)"}\` — ${why}`, () => {
      expect(allowed(argv)).toBe(allow);
    });
  }

  // The three capitalisation/typo rows above are the regression: before the fix
  // they did not merely skip the gate, they ran the ISSUE path.
  it("never lets a mistyped phase reach the binding path", () => {
    for (const bad of ["ISSUE", "", "bind", "Proposal", "issue "]) {
      const plan = planRun([`--phase=${bad}`, "--yes-i-will-bind-policies"]);
      expect(plan).toEqual({
        error: expect.stringContaining("proposal") as unknown as string,
      });
    }
  });

  it("names the valid phases when refusing an invalid one", () => {
    const message = refusal(["--phase=ISSUE"]);
    expect(message).toContain("ISSUE");
    expect(message).toContain("proposal");
    expect(message).toContain("issue");
  });

  it("says which flag is missing when the phase itself is valid", () => {
    expect(refusal(["--phase=proposal"])).toContain("--yes-i-will-create-proposals");
    expect(refusal(["--phase=issue"])).toContain("--yes-i-will-bind-policies");
  });
});

describe("parsePhase", () => {
  it("defaults to the non-binding proposal phase when --phase is absent", () => {
    expect(parsePhase([])).toBe("proposal");
    expect(parsePhase(["--only=3"])).toBe("proposal");
  });

  it("accepts exactly the two valid phases", () => {
    expect(parsePhase(["--phase=proposal"])).toBe("proposal");
    expect(parsePhase(["--phase=issue"])).toBe("issue");
  });

  it("rejects anything else rather than falling through to the binding path", () => {
    for (const bad of ["ISSUE", "Issue", "", "bind", "issues", " issue"]) {
      expect(parsePhase([`--phase=${bad}`])).toEqual({
        error: expect.stringContaining("proposal") as unknown as string,
      });
    }
  });
});

describe("consentError", () => {
  // Default-deny: anything that is not the proposal phase needs the BINDING flag,
  // so a third phase added later cannot silently inherit a cheaper gate.
  it("requires the proposal flag for the proposal phase", () => {
    expect(consentError("proposal", [])).toContain("--yes-i-will-create-proposals");
    expect(consentError("proposal", ["--yes-i-will-create-proposals"])).toBeUndefined();
    expect(consentError("proposal", ["--yes-i-will-bind-policies"])).toBeDefined();
  });

  it("requires the binding flag for the issue phase", () => {
    expect(consentError("issue", [])).toContain("--yes-i-will-bind-policies");
    expect(consentError("issue", ["--yes-i-will-create-proposals"])).toBeDefined();
    expect(consentError("issue", ["--yes-i-will-bind-policies"])).toBeUndefined();
  });

  it("demands the binding flag for any hypothetical future phase", () => {
    expect(consentError("reissue", ["--yes-i-will-create-proposals"])).toContain(
      "--yes-i-will-bind-policies",
    );
    expect(consentError("reissue", ["--yes-i-will-bind-policies"])).toBeUndefined();
  });
});

describe("parseOnly", () => {
  it("returns undefined when --only is absent, meaning run every scenario", () => {
    expect(parseOnly([])).toBeUndefined();
  });

  it("returns the scenario number for a valid --only", () => {
    expect(parseOnly(["--only=3"])).toBe(3);
  });

  // `--only=abc` used to become NaN, filter the queue to nothing, and then
  // overwrite the committed five-policy evidence table with zero rows.
  it("rejects a non-integer --only instead of silently emptying the queue", () => {
    for (const bad of ["abc", "", "0", "-1", "2.5", "NaN"]) {
      expect(parseOnly([`--only=${bad}`])).toEqual({
        error: expect.stringContaining("--only") as unknown as string,
      });
    }
  });
});

describe("parseRps", () => {
  it("uses the 0.5 default when --rps is absent", () => {
    expect(parseRps([])).toBe(0.5);
  });

  it("honours a positive rate", () => {
    expect(parseRps(["--rps=2"])).toBe(2);
  });

  // `--rps=abc` became NaN, sleep(NaN) returned immediately, and the rate limit
  // against a shared vendor sandbox silently disappeared.
  it("falls back to the default rather than removing the rate limit", () => {
    for (const bad of ["abc", "", "0", "-1", "Infinity"]) {
      expect(parseRps([`--rps=${bad}`])).toBe(0.5);
    }
  });
});

describe("planRun", () => {
  it("returns the parsed run when phase, consent and options are all valid", () => {
    expect(planRun(["--phase=issue", "--yes-i-will-bind-policies", "--only=4", "--rps=1"])).toEqual({
      phase: "issue",
      only: 4,
      rps: 1,
    });
  });

  it("refuses an invalid --only before anything runs", () => {
    expect(refusal(["--phase=proposal", "--yes-i-will-create-proposals", "--only=abc"])).toContain(
      "--only",
    );
  });

  it("checks the phase before the consent flag, so a typo is never a consent question", () => {
    expect(refusal(["--phase=bind", "--yes-i-will-bind-policies"])).toContain("bind");
  });
});
