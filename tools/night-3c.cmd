@echo off
rem Night runs after step 4 part 3c (notes/bot-roles.md): bot retrain, then the duel sweep (16 seeds) and a
rem full Balance Lab run with the retrained bots. Summaries go to notes\night-*.txt for the next session;
rem notes\night-status.txt gets a time stamp as each run starts and ends.
rem Start it with tools\night-start.ps1 (launched by Windows, so it outlives the Claude app), not from a shell.
cd /d "%~dp0.."
echo %date% %time% retrain started> notes\night-status.txt
node tools/train-bots.mjs --no-quick > notes\night-train.txt 2>&1
echo %date% %time% retrain ended, exit %errorlevel%; duel sweep started>> notes\night-status.txt
node tools/duels.mjs --brief --seeds 16 --no-fail --json balance/results/duels-3c-16.json > notes\night-duels.txt 2>&1
echo %date% %time% duel sweep ended, exit %errorlevel%; Balance Lab run started>> notes\night-status.txt
node tools/balance.mjs fighters --full > notes\night-balance.txt 2>&1
echo %date% %time% Balance Lab run ended, exit %errorlevel%. All night runs done.>> notes\night-status.txt
