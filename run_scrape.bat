@echo off
chcp 65001 > nul
rem Sedori Radar: scrape reservation/release info and save to DB
cd /d "%~dp0"
echo [%date% %time%] scrape start >> scrape_log.txt
call npm run scrape >> scrape_log.txt 2>&1
echo [%date% %time%] scrape end >> scrape_log.txt
