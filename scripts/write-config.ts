/**
 * Puts the Google API key into the built site's config.js at deploy time (.github/workflows/pages.yml).
 *
 *   GOOGLE_API_KEY=… npx tsx scripts/write-config.ts dist/config.js
 *
 * The key is read only from the GOOGLE_API_KEY environment variable, never from the command line, and this
 * script never prints it: not on success, not in an error. When the variable is unset or empty the file is left
 * as it is, so the site keeps the placeholder and paid unlock stays off. public/config.js in the repository
 * always keeps the placeholder; only the built copy gets the key.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The one line in public/config.js that holds the key. */
export const PLACEHOLDER_LINE = '  googleApiKey: "YOUR_GOOGLE_API_KEY",';

export type ConfigResult = { text: string; wrote: boolean; message: string };

/** config.js with the key in place of the placeholder (as a JSON string literal, so quotes and backslashes are safe). */
export function configWithKey(template: string, rawKey: string | undefined): ConfigResult {
  const key = (rawKey ?? "").trim();
  if (!key) {
    return { text: template, wrote: false, message: "GOOGLE_API_KEY is not set, so config.js keeps the placeholder and paid unlock stays off." };
  }
  // A key never has spaces or control characters; one that does is a mistake in the secret. Fail without saying what it is.
  const control = [...key].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);
  if (control || /\s/.test(key) || key.includes("YOUR_GOOGLE")) {
    throw new Error("The GOOGLE_API_KEY secret has spaces, line breaks or control characters in it, or is still the placeholder. Fix the secret. config.js was not changed.");
  }
  const found = template.split("\n").filter((line) => line === PLACEHOLDER_LINE).length;
  if (found !== 1) {
    throw new Error(`config.js should have exactly one placeholder line (${PLACEHOLDER_LINE.trim()}), but has ${found}. config.js was not changed.`);
  }
  // A function, not a replacement string, so "$&" or "$1" in a key is written as it is.
  const text = template.replace(PLACEHOLDER_LINE, () => `  googleApiKey: ${JSON.stringify(key)},`);
  return { text, wrote: true, message: "Wrote the Google API key from the GOOGLE_API_KEY secret into config.js." };
}

function main(): number {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: GOOGLE_API_KEY=… npx tsx scripts/write-config.ts dist/config.js");
    return 2;
  }
  try {
    const result = configWithKey(readFileSync(target, "utf8"), process.env.GOOGLE_API_KEY);
    if (result.wrote) writeFileSync(target, result.text);
    console.log(`${path.basename(target)}: ${result.message}`);
    return 0;
  } catch (error) {
    // Only the message: the messages above never hold the key.
    console.error(error instanceof Error ? error.message : "Could not write config.js.");
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main());
}
