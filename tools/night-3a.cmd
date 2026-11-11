@echo off
rem Night runs after step 4 part 3a (notes/bot-roles.md): duel sweep (16 seeds), bot retrain, full Balance
rem Lab run, one after the other. Summaries go to notes\night-*.txt for the next morning's session.
rem   cmd /c tools\night-3a.cmd
cd /d "%~dp0.."
if not exist balance\results\duels-3a-16.json (
  echo Duel sweep...
  node tools/duels.mjs --brief --seeds 16 --no-fail --json balance/results/duels-3a-16.json > notes\night-duels.txt 2>&1
)
echo Retrain...
node tools/train-bots.mjs > notes\night-train.txt 2>&1
echo Balance Lab full run...
node tools/balance.mjs fighters --full > notes\night-balance.txt 2>&1
echo All night runs done.
