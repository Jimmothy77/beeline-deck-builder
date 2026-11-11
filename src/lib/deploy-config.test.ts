import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { configWithKey, PLACEHOLDER_LINE } from "../../scripts/write-config";

/**
 * The deploy-time key: .github/workflows/pages.yml runs scripts/write-config.ts after the build, with the
 * GOOGLE_API_KEY repository secret in env. The Actions run itself can't be tested here; these check the
 * workflow text, the write step, and a local dry run of the step with a fake key.
 */
const root = path.resolve(import.meta.dirname, "../..");
const workflow = readFileSync(path.join(root, ".github/workflows/pages.yml"), "utf8");
const template = readFileSync(path.join(root, "public/config.js"), "utf8");
// Made up, with the characters that would break naive quoting or a replacement string.
const FAKE = 'fake-key_"quote"\\back$&$1`tick`';
const keyIn = (text: string) => (runInNewContext(text, { window: {} }) as { googleApiKey: string }).googleApiKey;

describe("the Pages workflow writes the key from the secret", () => {
  const lines = workflow.split("\n");
  const stepAt = lines.findIndex((line) => line.trim() === "- name: Write the Google API key into dist/config.js");
  const step = lines.slice(stepAt, stepAt + 4).map((line) => line.trim());

  it("has the step after the build and before the upload, with the secret passed only through env", () => {
    expect(stepAt).toBeGreaterThan(lines.findIndex((line) => line.trim() === "- run: npm run build"));
    expect(stepAt).toBeLessThan(lines.findIndex((line) => line.includes("actions/upload-pages-artifact")));
    expect(step).toEqual(["- name: Write the Google API key into dist/config.js", "env:", "GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}", "run: npx tsx scripts/write-config.ts dist/config.js"]);
    // The secret appears once, in that env block, and nowhere in a command.
    expect(workflow.match(/secrets\./g)).toHaveLength(1);
  });

  it("never echoes, prints or traces the key", () => {
    const runs = lines.filter((line) => /^\s*-?\s*run:/.test(line)).join("\n");
    expect(runs).not.toMatch(/GOOGLE_API_KEY|secrets|echo|printf|\bcat\b|\btee\b|set -x|::debug|::set-output|GITHUB_OUTPUT|GITHUB_ENV/);
    expect(workflow).not.toMatch(/set -x|ACTIONS_STEP_DEBUG|shell:\s*bash -x/);
  });

  it("finds exactly one placeholder line in public/config.js, which stays the placeholder", () => {
    expect(template.split("\n").filter((line) => line === PLACEHOLDER_LINE)).toHaveLength(1);
    expect(keyIn(template)).toBe("YOUR_GOOGLE_API_KEY");
  });
});

describe("scripts/write-config.ts", () => {
  it("keeps the placeholder byte for byte when the secret is unset, empty or blank", () => {
    for (const key of [undefined, "", "   ", "\n"]) {
      const result = configWithKey(template, key);
      expect(result).toEqual({ text: template, wrote: false, message: "GOOGLE_API_KEY is not set, so config.js keeps the placeholder and paid unlock stays off." });
    }
  });

  it("writes the key as a safe string literal in the same format, changing only that line", () => {
    const result = configWithKey(template, `  ${FAKE}\n`);
    expect(result.wrote).toBe(true);
    expect(keyIn(result.text)).toBe(FAKE);
    const before = template.split("\n");
    const after = result.text.split("\n");
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, index) => line !== before[index])).toEqual([`  googleApiKey: ${JSON.stringify(FAKE)},`]);
    expect(result.message).not.toContain(FAKE);
  });

  it("refuses a key with spaces or line breaks, or a config.js without exactly one placeholder line, without saying the key", () => {
    for (const key of ["two words", "line\nbreak", "tab\there", "YOUR_GOOGLE_API_KEY"]) {
      let message = "";
      try {
        configWithKey(template, key);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, key).toMatch(/^The GOOGLE_API_KEY secret has spaces/);
      expect(message).not.toContain(key);
    }
    expect(() => configWithKey(template.replace(PLACEHOLDER_LINE, '  googleApiKey: "",'), FAKE)).toThrow(/exactly one placeholder line .* but has 0/);
    expect(() => configWithKey(`${template}\n${PLACEHOLDER_LINE}`, FAKE)).toThrow(/but has 2/);
  });

  it("runs as the workflow runs it: a dry run with a fake key writes it and prints nothing of it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "beeline-config-"));
    try {
      const file = path.join(dir, "config.js");
      writeFileSync(file, template);
      const run = (env: Record<string, string>) =>
        execFileSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "scripts/write-config.ts"), file], {
          cwd: root,
          env: { PATH: process.env.PATH ?? "", ...env },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      expect(run({})).toBe("config.js: GOOGLE_API_KEY is not set, so config.js keeps the placeholder and paid unlock stays off.\n");
      expect(readFileSync(file, "utf8")).toBe(template);
      const out = run({ GOOGLE_API_KEY: FAKE });
      expect(out).toBe("config.js: Wrote the Google API key from the GOOGLE_API_KEY secret into config.js.\n");
      expect(out).not.toContain("fake-key");
      expect(keyIn(readFileSync(file, "utf8"))).toBe(FAKE);
      // In GitHub Actions a missing secret is a ::warning:: annotation; a set one is the same plain line, never the key.
      writeFileSync(file, template);
      expect(run({ GITHUB_ACTIONS: "true" })).toBe("::warning title=Paid unlock is off::GOOGLE_API_KEY is not set, so config.js keeps the placeholder and paid unlock stays off.\n");
      expect(readFileSync(file, "utf8")).toBe(template);
      const ci = run({ GITHUB_ACTIONS: "true", GOOGLE_API_KEY: FAKE });
      expect(ci).toBe("config.js: Wrote the Google API key from the GOOGLE_API_KEY secret into config.js.\n");
      expect(ci).not.toContain("fake-key");
      expect(ci).not.toContain("::warning");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
