"""Serve BeeLine's site folder at http://127.0.0.1:4178/ for the local build.

Python standard library only. It is Python's own http.server with two additions:
- Access-Control-Allow-Origin: * on every response, as GitHub Pages sends. The deck splashes run in a
  sandboxed frame, and a sandboxed frame's font requests need that header.
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


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def end_headers(self):
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
