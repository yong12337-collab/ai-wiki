@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py -3 aiwiki_server.py) || (python aiwiki_server.py)
pause
