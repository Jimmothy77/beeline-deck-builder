BeeLine Deck Builder v{VERSION} (local build, commit {COMMIT})

Double-click "Start BeeLine.bat". It serves the site at http://127.0.0.1:4178/ using Python and opens your browser. Close the black window to stop it.

The .bat runs serve_beeline.py: Python's own web server, only reachable from this computer, plus the cross-origin header the deck splashes need to load their fonts (GitHub Pages sends the same header), on the splash files only. It answers only to http://127.0.0.1:4178/ or http://localhost:4178/, never lists a folder, and serves nothing outside the site folder.

Paid-pack unlock needs a Google API key in site\config.js, restricted to http://127.0.0.1:4178/* (and the GitHub Pages address once there is one). Until then only the free Standard decks work.
