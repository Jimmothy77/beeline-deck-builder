import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, "local", file), "utf8");
const python = ["python3", "python"].find((cmd) => spawnSync(cmd, ["--version"]).status === 0);

describe("local build", () => {
  it("starts serve_beeline.py from a plain .bat", () => {
    const bat = read("Start BeeLine.bat");
    expect(bat).toMatch(/\r\n/);
    expect(bat.split("\r\n").filter(Boolean)).toEqual([
      "@echo off",
      'cd /d "%~dp0"',
      'start "" http://127.0.0.1:4178/',
      "where py >nul 2>nul && (py serve_beeline.py) || (python serve_beeline.py)",
      "pause",
    ]);
    expect(read("README.txt").split(/\r?\n/)[0]).toBe("BeeLine Deck Builder v{VERSION} (local build, commit {COMMIT})");
  });

  it("serves only on this computer, with the standard library and the cross-origin header", () => {
    const server = read("serve_beeline.py");
    expect(server).toMatch(/^HOST = "127\.0\.0\.1"$/m);
    expect(server).not.toMatch(/0\.0\.0\.0|""\s*,\s*PORT/);
    expect(new Set([...server.matchAll(/^import (\w+)/gm)].map((m) => m[1]))).toEqual(new Set(["functools", "http", "os", "sys"]));
    expect(server).not.toMatch(/^from /m);
    expect(server).toContain('self.send_header("Access-Control-Allow-Origin", "*")');
    // Pinned here, not left to the system: a Windows registry setting can map .js to text/plain.
    for (const [ext, type] of [[".js", "text/javascript"], [".css", "text/css"], [".woff2", "font/woff2"], [".webp", "image/webp"], [".svg", "image/svg+xml"]]) {
      expect(server).toContain(`    "${ext}": "${type}",\n`);
    }
  });

  it.skipIf(!python)("answers with the header and the right content types (run with Python)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "beeline-local-"));
    try {
      copyFileSync(path.join(root, "local/serve_beeline.py"), path.join(dir, "serve_beeline.py"));
      mkdirSync(path.join(dir, "site/fonts"), { recursive: true });
      writeFileSync(path.join(dir, "site/index.html"), "<p>hi</p>");
      writeFileSync(path.join(dir, "site/app.js"), "export {};");
      writeFileSync(path.join(dir, "site/fonts/x.woff2"), "wOF2");
      const port = 41000 + Math.floor(Math.random() * 2000);
      const child = spawn(python!, [path.join(dir, "serve_beeline.py"), String(port)], { stdio: ["ignore", "pipe", "pipe"] });
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("server did not start")), 5000);
          child.stdout!.on("data", (chunk: Buffer) => {
            if (chunk.toString().includes(`http://127.0.0.1:${port}/`)) {
              clearTimeout(timer);
              resolve();
            }
          });
        });
        const font = await fetch(`http://127.0.0.1:${port}/fonts/x.woff2`);
        expect(font.status).toBe(200);
        expect(font.headers.get("access-control-allow-origin")).toBe("*");
        expect(font.headers.get("content-type")).toBe("font/woff2");
        expect((await fetch(`http://127.0.0.1:${port}/app.js`)).headers.get("content-type")).toBe("text/javascript");
        expect((await fetch(`http://127.0.0.1:${port}/`)).headers.get("access-control-allow-origin")).toBe("*");
      } finally {
        child.kill();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
