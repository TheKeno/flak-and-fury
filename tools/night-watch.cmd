@echo off
rem Opens the night run's live log in this window (tools/night-watch.mjs): the whole log so far, then new
rem lines as they come. Safe to close at any time: the run goes on.
cd /d "%~dp0.."
node tools/night-watch.mjs
