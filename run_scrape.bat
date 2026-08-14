@echo off
rem === Hatsukore: scheduled update + checks ===
rem
rem WHY THIS FILE IS ASCII-ONLY (do not add Japanese here):
rem cmd.exe re-reads a .bat by byte offset while executing it. With multi-byte
rem (UTF-8) text in the file the parser de-syncs and starts running the middle of
rem comment lines as commands. This file was silently broken that way and had not
rem run since 2026-07-21 (see run_scrape.md). "chcp 65001" and a UTF-8 BOM do not
rem fix it. Keep this file ASCII; the Japanese rationale lives in run_scrape.md.
rem
rem This is the single place that mechanically guarantees "update and check are one
rem operation". If any step reports ERROR the bat exits 1, so the scheduler records
rem a failure instead of the problem passing silently.
cd /d "%~dp0"
set LOG=scrape_log.txt

echo. >> %LOG%
echo ========================================= >> %LOG%
echo [%date% %time%] run start >> %LOG%

rem --- 1. data update ---
call :step "scrape"            "npm run scrape"             || exit /b 1
call :step "backfill images"   "npm run scrape:images"      || exit /b 1
call :step "reenrich collabo"  "npm run reenrich:collabo"   || exit /b 1
rem Market-price steps (scrape:prices / prices:recheck / scrape:kuji:prices) are ON HOLD
rem since 2026-08-10: the /premium view and all price badges were withdrawn, so these
rem would spend ~10 min per run scraping data nothing displays. Scripts and DB columns
rem are kept. To revive, put the three "call :step" lines back. See run_scrape.md.

rem --- 2. checks ---
call :step "audit selftest"    "npm run audit:selftest"     || exit /b 1
call :step "audit"             "npm run audit"              || exit /b 1
call :step "audit facts"       "npm run audit:facts"        || exit /b 1
rem "audit tomorrow" replays today's data with the calendar moved forward (+1 / +7 days)
rem and fails if a check starts firing purely because dates passed. Added 2026-08-11
rem after page_vanished, added the day before, stopped this run at 11:39 with a false
rem ERROR: a genre page whose only item was dated 8/10 disappeared overnight. Catching
rem that kind the same day it is written is the whole point. It writes nothing.
call :step "audit tomorrow"    "npm run audit:tomorrow"     || exit /b 1

echo [%date% %time%] data update and machine checks OK (rendered-page audit NOT run) >> %LOG%
echo Data update and machine checks passed.
echo NOTE: "npm run audit:page" (rendered-page audit) has NOT been run - it needs a dev
echo server or the production URL. Do not claim "everything was checked" until it is.
exit /b 0

:step
echo [%date% %time%] %~1 start >> %LOG%
call %~2 >> %LOG% 2>&1
if errorlevel 1 (
  echo [%date% %time%] %~1 FAILED >> %LOG%
  echo FAILED: %~1 - see %LOG%
  exit /b 1
)
echo [%date% %time%] %~1 ok >> %LOG%
exit /b 0
