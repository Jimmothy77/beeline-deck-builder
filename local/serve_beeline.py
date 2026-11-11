"""Serve BeeLine's site folder at http://127.0.0.1:4178/ for the local build.

Python standard library only. It is Python's own http.server, tightened:
- Access-Control-Allow-Origin: * only on files under /splash/, as GitHub Pages sends. The deck splashes
  run in a sandboxed frame, and a sandboxed frame's font requests need that header. Nothing else gets it,
  so no other web page can read the site's files.
- The Host header must be 127.0.0.1:<port> or localhost:<port>. Anything else (a web page that points
  its own domain name at this computer) gets 403.
- No folder listings: a folder without an index.html is 404.
- Only files inside the site folder: a path that leaves it, or a link that points out of it, is 404.
- Fixed content types for the site's files, so a Windows registry setting can't serve .js as text.
It only listens on 127.0.0.1 (this computer), never on the network.
"""
import functools
import http.server
import os
import sys

HOST = "127.0.0.1"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4178
SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}

TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".txt": "text/plain",
}


def inside(root, target):
    """True when target, with every link resolved, is root or a path under it."""
    root = os.path.realpath(root)
    target = os.path.realpath(target)
    return target == root or target.startswith(root + os.sep)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def send_head(self):
        if self.headers.get("Host", "").lower() not in ALLOWED_HOSTS:
            self.send_error(403, "This server only answers http://127.0.0.1:%d/" % PORT)
            return None
        if not inside(self.directory, self.translate_path(self.path)):
            self.send_error(404, "File not found")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "File not found")
        return None

    def end_headers(self):
        # Decided on the file actually served, so /splash/../index.html doesn't get the header.
        if inside(os.path.join(self.directory, "splash"), self.translate_path(self.path)):
            self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


def main():
    server = http.server.ThreadingHTTPServer((HOST, PORT), functools.partial(Handler, directory=SITE))
    print(f"BeeLine is running at http://{HOST}:{PORT}/  (close this window to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
