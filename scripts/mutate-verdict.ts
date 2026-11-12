/**
 * How scripts/mutate.ts reads one vitest JSON report (--reporter=json --outputFile). Kept apart from
 * mutate.ts so it can be tested without running the mutations.
 */
export type Report = {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numFailedTestSuites?: number;
  testResults?: Array<{ name?: string; status?: string; message?: string; assertionResults?: Array<{ fullName?: string; status?: string; failureMessages?: string[] }> }>;
};
export type Verdict = { kind: "killed" | "survived" | "invalid"; detail: string[] };

/** Reads a vitest JSON report. Only a test that ran and failed is a kill. */
export function verdictOf(report: Report | null): Verdict {
  if (!report) return { kind: "invalid", detail: ["no JSON report (vitest did not run)"] };
  const failedTests = (report.testResults ?? []).flatMap((file) => (file.assertionResults ?? []).filter((test) => test.status === "failed"));
  const passedTests = (report.testResults ?? []).flatMap((file) => (file.assertionResults ?? []).filter((test) => test.status === "passed"));
  if ((report.numFailedTests ?? 0) > 0 && failedTests.length > 0) {
    return { kind: "killed", detail: [`Tests ${failedTests.length} failed`, ...failedTests.map((test) => `FAILED: ${test.fullName ?? "?"} :: ${(test.failureMessages?.[0] ?? "").split("\n")[0]!.slice(0, 200)}`)] };
  }
  const brokenFiles = (report.testResults ?? []).filter((file) => file.status === "failed" && !(file.assertionResults ?? []).some((test) => test.status === "failed"));
  if (brokenFiles.length || (report.numFailedTestSuites ?? 0) > 0) {
    return { kind: "invalid", detail: [`${brokenFiles.length || report.numFailedTestSuites} test file(s) failed to load, no test failed`, ...[...new Set(brokenFiles.map((file) => `LOAD: ${(file.message ?? "").split("\n").slice(0, 2).join(" ").slice(0, 200)}`))].slice(0, 3)] };
  }
  if ((report.numFailedTests ?? 0) > 0) return { kind: "invalid", detail: ["the report counts a failure but lists no failed test"] };
  if (passedTests.length === 0) return { kind: "invalid", detail: ["the test filter matched no test"] };
  return { kind: "survived", detail: [`Tests ${passedTests.length} passed`] };
}

