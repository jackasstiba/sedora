@echo off
chcp 65001 > nul
rem Sedori Radar: scrape reservation/release info and save to DB
cd /d "%~dp0"
echo [%date% %time%] scrape start >> scrape_log.txt
call npm run scrape >> scrape_log.txt 2>&1
echo [%date% %time%] scrape end >> scrape_log.txt
rem 一覧完結型ソース(rarecheck等)は記事本文を開かず画像を持てないので、og:imageを後付けする。
rem scrape.ts が imageUrl=null で上書きしないため、一度付いた画像は次回以降も温存される。
echo [%date% %time%] backfill images start >> scrape_log.txt
call npm run scrape:images >> scrape_log.txt 2>&1
echo [%date% %time%] backfill images end >> scrape_log.txt
