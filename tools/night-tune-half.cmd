@echo off
rem The same night run as night-tune.cmd on half the cores, so the computer stays usable meanwhile.
call "%~dp0night-tune.cmd" --half
