@echo off
cd /d "%~dp0"
start "" http://127.0.0.1:4178/
where py >nul 2>nul && (py serve_beeline.py) || (python serve_beeline.py)
pause
