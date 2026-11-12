import { describe, expect, it } from "vitest";
import { verdictOf } from "../../scripts/mutate-verdict";

const file = (status: string, tests: Array<[string, string]>, message = "") => ({
  name: "/x/a.test.ts",
  status,
  message,
  assertionResults: tests.map(([fullName, s]) => ({ fullName, status: s, failureMessages: s === "failed" ? ["AssertionError: expected 1 to be 2\n  at ..."] : [] })),
});

describe("mutation verdicts from the vitest JSON report", () => {
  it("counts a kill only when a test ran and failed", () => {
    const verdict = verdictOf({ numTotalTests: 3, numPassedTests: 2, numFailedTests: 1, numFailedTestSuites: 1, testResults: [file("failed", [["a passes", "passed"], ["a fails", "failed"], ["b passes", "passed"]])] });
    expect(verdict.kind).toBe("killed");
    expect(verdict.detail[0]).toBe("Tests 1 failed");
    expect(verdict.detail[1]).toBe("FAILED: a fails :: AssertionError: expected 1 to be 2");
  });

  it("does not count a file that failed to load (a patch that breaks parsing) as a kill", () => {
    const verdict = verdictOf({ numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numFailedTestSuites: 4, testResults: [file("failed", [], "SyntaxError: Unexpected token\n at storage.ts:12")] });
    expect(verdict.kind).toBe("invalid");
    expect(verdict.detail.join("\n")).toContain("LOAD: SyntaxError: Unexpected token");
    // A load failure next to passing tests elsewhere is still not a kill.
    expect(verdictOf({ numPassedTests: 5, numFailedTests: 0, numFailedTestSuites: 1, testResults: [file("passed", [["ok", "passed"]]), file("failed", [], "Error: boom")] }).kind).toBe("invalid");
  });

  it("does not count a filter that matched nothing, or no report at all, as a kill", () => {
    expect(verdictOf({ numTotalTests: 40, numPassedTests: 0, numFailedTests: 0, numFailedTestSuites: 0, testResults: [file("passed", [["x", "skipped"]])] }).kind).toBe("invalid");
    expect(verdictOf(null)).toEqual({ kind: "invalid", detail: ["no JSON report (vitest did not run)"] });
    // A failure count with no failed test in the results (a corrupt report) is not trusted.
    expect(verdictOf({ numPassedTests: 0, numFailedTests: 1, testResults: [] }).kind).toBe("invalid");
  });

  it("reports a mutation whose tests all passed as surviving", () => {
    expect(verdictOf({ numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numFailedTestSuites: 0, testResults: [file("passed", [["a", "passed"], ["b", "passed"]])] })).toEqual({ kind: "survived", detail: ["Tests 2 passed"] });
  });
});
