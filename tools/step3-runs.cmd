@echo off
rem Milestone 8 step 3, the long runs (see notes\milestone8-step3.md): the height count in real matches as the
rem game is, the same with "don't follow down" for the high planes, then the band check with that rule.
rem Results: notes\height-count-<date>.txt and notes\band-check-<date>.txt. Closing this window stops the run.
cd /d "%~dp0.."
node tools\height-count.mjs --label "as it is"
set "FF_TACTICS={"bf109g6":{"followDown":300},"p47d":{"followDown":300}}"
node tools\height-count.mjs --label "followDown 300 for the Bf 109 and P-47"
node tools\band-check.mjs --bands low,mid,high --seeds 101-160
echo [%time:~0,8%] All step 3 runs done.>> notes\step3-runs-done.txt
