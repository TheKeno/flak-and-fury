@echo off
rem Night runs after step 4 part 3b (notes/bot-roles.md): bot retrain, then the duel sweep (16 seeds) and a
rem full Balance Lab run with the retrained bots. Summaries go to notes\night-*.txt for the next session.
rem The PC must stay awake (the session asks the app to keep it awake).
rem   cmd /c tools\night-3b.cmd
cd /d "%~dp0.."
echo Retrain...
node tools/train-bots.mjs --no-quick > notes\night-train.txt 2>&1
echo Duel sweep...
node tools/duels.mjs --brief --seeds 16 --no-fail --json balance/results/duels-3b-16.json > notes\night-duels.txt 2>&1
echo Balance Lab full run...
node tools/balance.mjs fighters --full > notes\night-balance.txt 2>&1
echo All night runs done.
