@echo off
rem Night runs after step 4 part 3d (notes/bot-roles.md "Part 3d"): no retrain (3d changed no trained knob and the
rem duels at normal are unchanged), a 16-seed duel sweep at each skill level, the skill-order and bot-life checks, then
rem a full Balance Lab run. Summaries go to notes\night-*.txt; notes\night-status.txt gets a time stamp per run.
rem Start it with tools\night-start.ps1 tools\night-3d.cmd (launched by Windows, so it outlives the Claude app).
cd /d "%~dp0.."
echo %date% %time% duel sweeps started> notes\night-status.txt
node tools/duels.mjs --brief --seeds 16 --no-fail --skill normal --json balance/results/duels-3d-normal-16.json > notes\night-duels.txt 2>&1
node tools/duels.mjs --brief --seeds 16 --no-fail --skill easy --json balance/results/duels-3d-easy-16.json > notes\night-duels-easy.txt 2>&1
node tools/duels.mjs --brief --seeds 16 --no-fail --skill ace --json balance/results/duels-3d-ace-16.json > notes\night-duels-ace.txt 2>&1
echo %date% %time% duel sweeps ended; skill order and bot life started>> notes\night-status.txt
node tools/skill-order.mjs --seeds 24 > notes\night-skill-order.txt 2>&1
node tools/bot-life.mjs --minutes 10 --seeds 4 > notes\night-botlife.txt 2>&1
node tools/bot-life.mjs --alone --minutes 14 --seeds 4 > notes\night-botlife-alone.txt 2>&1
echo %date% %time% skill order and bot life ended; Balance Lab run started>> notes\night-status.txt
node tools/balance.mjs fighters --full > notes\night-balance.txt 2>&1
echo %date% %time% Balance Lab run ended, exit %errorlevel%. All night runs done.>> notes\night-status.txt
