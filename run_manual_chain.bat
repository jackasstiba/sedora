@echo off
rem One-off (2026-09-12): continue the aborted 15:11 run with the fixed scrapers.
rem ASCII only (see run_scrape.bat header). Same step format so the log reads the same way.
cd /d "%~dp0"
set LOG=scrape_log.txt
echo [%date% %time%] (manual chain) continuing 15:11 run: targeted re-scrape with fixed code, then the 5 gates >> %LOG%
call :step "scrape (only tenbaiquest,card_chusen,pokemoncard,sofvi,collabo_cafe,takaratomy_mall)" "npm run scrape -- --only=tenbaiquest,card_chusen,pokemoncard,sofvi,collabo_cafe,takaratomy_mall" || exit /b 1
call :step "reenrich collabo"  "npm run reenrich:collabo"   || exit /b 1
call :step "audit selftest"    "npm run audit:selftest"     || exit /b 1
call :step "audit clock"       "npm run audit:clock"        || exit /b 1
call :step "audit"             "npm run audit"              || exit /b 1
call :step "audit facts"       "npm run audit:facts"        || exit /b 1
call :step "audit tomorrow"    "npm run audit:tomorrow"     || exit /b 1
echo [%date% %time%] data update and machine checks OK (manual chain; rendered-page audit NOT run) >> %LOG%
exit /b 0

:step
echo [%date% %time%] %~1 start >> %LOG%
call %~2 >> %LOG% 2>&1
if errorlevel 1 (
  echo [%date% %time%] %~1 FAILED >> %LOG%
  exit /b 1
)
echo [%date% %time%] %~1 ok >> %LOG%
exit /b 0
