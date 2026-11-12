@echo off
rem The auto-tuner's long run (notes/auto-tuner.md): tools\tune-planes.mjs with an 8 hour budget, hands off.
rem Its log goes to notes\night-tune.txt; notes\night-status.txt gets a time stamp at the start and the end.
rem Start it with: powershell -ExecutionPolicy Bypass -File tools\night-start.ps1 tools\night-tune.cmd
rem (launched by Windows, so it outlives the Claude app). A stopped run carries on with --resume.
cd /d "%~dp0.."
echo %date% %time% auto-tuner started (8 h budget)> notes\night-status.txt
node tools/tune-planes.mjs --hours 8 > notes\night-tune.txt 2>&1
echo %date% %time% auto-tuner ended, exit %errorlevel%.>> notes\night-status.txt
