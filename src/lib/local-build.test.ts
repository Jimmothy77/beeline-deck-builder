import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { connect } from "node:net";
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

  it("serves only on this computer, with the standard library, and the cross-origin header on splash files only", () => {
    const server = read("serve_beeline.py");
    expect(server).toMatch(/^HOST = "127\.0\.0\.1"$/m);
    expect(server).not.toMatch(/0\.0\.0\.0|""\s*,\s*PORT/);
    expect(new Set([...server.matchAll(/^import (\w+)/gm)].map((m) => m[1]))).toEqual(new Set(["functools", "http", "os", "sys"]));
    expect(server).not.toMatch(/^from /m);
    expect(server).toContain('ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}');
    expect(server.match(/Access-Control-Allow-Origin", "\*"/g)).toHaveLength(1);
    expect(server).toContain('        if inside(os.path.join(self.directory, "splash"), self.translate_path(self.path)):\n            self.send_header("Access-Control-Allow-Origin", "*")');
    expect(server).toMatch(/def list_directory\(self, path\):\n\s+self\.send_error\(404/);
    // Pinned here, not left to the system: a Windows registry setting can map .js to text/plain.
    for (const [ext, type] of [[".js", "text/javascript"], [".css", "text/css"], [".woff2", "font/woff2"], [".webp", "image/webp"], [".svg", "image/svg+xml"]]) {
      expect(server).toContain(`    "${ext}": "${type}",\n`);
    }
  });

  /** One raw HTTP request, so the Host header and the path go out exactly as written. */
  function raw(port: number, target: string, host: string | null): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      socket.on("connect", () => socket.write(`GET ${target} HTTP/1.0\r\n${host === null ? "" : `Host: ${host}\r\n`}\r\n`));
      socket.on("data", (chunk) => (data += chunk.toString("latin1")));
      socket.on("error", reject);
      socket.on("end", () => {
        const [head = "", ...rest] = data.split("\r\n\r\n");
        const [statusLine = "", ...lines] = head.split("\r\n");
        const headers: Record<string, string> = {};
        for (const line of lines) {
          const at = line.indexOf(":");
          headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
        }
        resolve({ status: Number(statusLine.split(" ")[1]), headers, body: rest.join("\r\n\r\n") });
      });
    });
  }

  it.skipIf(!python)("answers only to its own address, lists no folder, stays in the site folder, and sends the header on splash files (run with Python)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "beeline-local-"));
    try {
      copyFileSync(path.join(root, "local/serve_beeline.py"), path.join(dir, "serve_beeline.py"));
      mkdirSync(path.join(dir, "site/splash/fonts"), { recursive: true });
      mkdirSync(path.join(dir, "site/splash/splashes"), { recursive: true });
      mkdirSync(path.join(dir, "site/assets"), { recursive: true });
      writeFileSync(path.join(dir, "site/index.html"), "<p>hi</p>");
      writeFileSync(path.join(dir, "site/assets/app.js"), "export {};");
      writeFileSync(path.join(dir, "site/splash/fonts/x.woff2"), "wOF2");
      writeFileSync(path.join(dir, "site/splash/splashes/tmnt.html"), "<p>tmnt</p>");
      writeFileSync(path.join(dir, "secret.txt"), "outside the site");
      symlinkSync(path.join(dir, "secret.txt"), path.join(dir, "site/leak.txt"));
      symlinkSync(path.join(dir, "secret.txt"), path.join(dir, "site/splash/leak.txt"));
      symlinkSync(dir, path.join(dir, "site/up"));
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
        const me = `127.0.0.1:${port}`;
        const font = await raw(port, "/splash/fonts/x.woff2", me);
        expect(font.status).toBe(200);
        expect(font.headers["access-control-allow-origin"]).toBe("*");
        expect(font.headers["content-type"]).toBe("font/woff2");
        expect((await raw(port, "/splash/splashes/tmnt.html", `localhost:${port}`)).headers["access-control-allow-origin"]).toBe("*");
        const page = await raw(port, "/", me);
        expect(page.status).toBe(200);
        expect(page.body).toBe("<p>hi</p>");
        expect(page.headers["access-control-allow-origin"]).toBeUndefined();
        const app = await raw(port, "/assets/app.js", me);
        expect(app.headers["content-type"]).toBe("text/javascript");
        expect(app.headers["access-control-allow-origin"]).toBeUndefined();
        // The header follows the file served, not the path's first segment.
        for (const sneaky of ["/splash/../assets/app.js", "/splash/%2e%2e/assets/app.js", "/splash/..%2fassets/app.js"]) {
          const got = await raw(port, sneaky, me);
          expect([sneaky, got.headers["access-control-allow-origin"]]).toEqual([sneaky, undefined]);
        }
        // Only its own address: no other name, port, or a missing Host.
        expect((await raw(port, "/", `localhost:${port}`)).status).toBe(200);
        for (const host of ["evil.example", `evil.example:${port}`, "127.0.0.1", `127.0.0.1:${port + 1}`, `localhost.evil.example:${port}`, `127.0.0.2:${port}`, null]) {
          const got = await raw(port, "/", host);
          expect([host, got.status]).toEqual([host, 403]);
          expect(got.body).not.toContain("<p>hi</p>");
        }
        // No folder listings.
        for (const folder of ["/assets/", "/splash/", "/splash/fonts/"]) expect([folder, (await raw(port, folder, me)).status]).toEqual([folder, 404]);
        expect((await raw(port, "/splash", me)).status).toBe(301);
        // Nothing outside the site folder, by .. or by a link.
        for (const out of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/leak.txt", "/splash/leak.txt", "/up/secret.txt", "/up/", "//etc/passwd"]) {
          const got = await raw(port, out, me);
          expect([out, got.status]).toEqual([out, 404]);
          expect(got.body).not.toContain("outside the site");
        }
      } finally {
        child.kill();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
