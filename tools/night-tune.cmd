@echo off
rem The night after the fighter design pass (notes/auto-tuner.md, notes/fighter-design.md): retrain the bots under
rem the propeller physics (4 rounds, about 1.5 h), then the auto-tuner air-to-air with a 5 hour budget, hands off.
rem Logs: notes\night-train.txt, notes\night-tune.txt; notes\night-status.txt gets a time stamp per stage.
rem Start it with: powershell -ExecutionPolicy Bypass -File tools\night-start.ps1 tools\night-tune.cmd
rem (launched by Windows, so it outlives the Claude app). A stopped tuning carries on with tune-planes --resume.
cd /d "%~dp0.."
echo %date% %time% retrain started (4 rounds)> notes\night-status.txt
node tools/train-bots.mjs --rounds 4 --no-quick > notes\night-train.txt 2>&1
echo %date% %time% retrain ended, exit %errorlevel%; auto-tuner started (5 h budget)>> notes\night-status.txt
node tools/tune-planes.mjs --hours 5 > notes\night-tune.txt 2>&1
echo %date% %time% auto-tuner ended, exit %errorlevel%. All night runs done.>> notes\night-status.txt
