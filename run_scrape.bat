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
rem 監査を回す前に、監査自身が「鳴るべき入力で鳴る」ことを確かめる。
rem 検査は本番を壊さないので、壊れていても咎められずに残る（＝発火しようのない検査を
rem 持っているだけの状態で「0件」と報告してしまう）。合成データで固定した期待値で守る。
echo [%date% %time%] audit selftest start >> scrape_log.txt
call npm run audit:selftest >> scrape_log.txt 2>&1
if errorlevel 1 (
  echo [%date% %time%] audit selftest FAILED ^(監査自身が壊れている^) >> scrape_log.txt
  echo 監査の自己テストが失敗しました。監査結果は信用できません。scrape_log.txt を確認してください。
  exit /b 1
)
echo [%date% %time%] audit selftest ok >> scrape_log.txt
rem 表示品質の常設監査。ERROR が出たら「きれい」と言えない状態なので、この bat 自体を
rem 失敗（exit 1）で終える。監査を回すかどうかを人間の記憶に委ねないための固定。
echo [%date% %time%] audit start >> scrape_log.txt
call npm run audit >> scrape_log.txt 2>&1
if errorlevel 1 (
  echo [%date% %time%] audit FAILED ^(ERROR あり: scrape_log.txt を確認^) >> scrape_log.txt
  echo 監査でERRORが出ました。scrape_log.txt を確認してください。
  exit /b 1
)
echo [%date% %time%] audit ok >> scrape_log.txt
