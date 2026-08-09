@echo off
chcp 65001 > nul
rem ハツコレ 定例更新＋チェック（System/rules.md の「ハツコレを更新して」の定義に合わせる）
rem
rem ここが「更新とチェックはセット」を**機械で**担保する唯一の場所。
rem 人間（や私）が手順を覚えていることに依存させない。どこかで ERROR が出たら
rem bat 自体を exit 1 で終えるので、スケジューラから見ても失敗として残る。
cd /d "%~dp0"
set LOG=scrape_log.txt

echo. >> %LOG%
echo ========================================= >> %LOG%
echo [%date% %time%] 定例更新 開始 >> %LOG%

rem ── 1. データ更新 ────────────────────────────────────────────────
call :step "scrape"            "npm run scrape"            || exit /b 1
call :step "backfill images"   "npm run scrape:images"     || exit /b 1
call :step "reenrich collabo"  "npm run reenrich:collabo"  || exit /b 1
call :step "scrape prices"     "npm run scrape:prices"     || exit /b 1
rem 既存の相場も洗う。scrape:prices は未取得を優先するので、一度付いた誤りは
rem これを回さないと永久に残る（しかも相場降順の /premium では誤りほど上位に出る）。
call :step "recheck prices"    "npm run prices:recheck"    || exit /b 1
call :step "kuji prices"       "npm run scrape:kuji:prices" || exit /b 1

rem ── 2. チェック ──────────────────────────────────────────────────
rem 監査より先に「監査自身が鳴るべき入力で鳴るか」を確かめる。検査は本番を壊さないので、
rem 壊れていても咎められずに残る＝空振りしたまま「0件」と報告してしまう。
call :step "audit selftest"    "npm run audit:selftest"    || exit /b 1
rem 表示品質の常設監査。ERROR があれば「きれい」と言えない。
call :step "audit"             "npm run audit"             || exit /b 1
rem 一次情報との突合（リンク先の本文と識別語・価格を照合）。
rem 2026-08-09まで、このステップは **1件も突合できなくても exit 0** だったので関門として
rem 機能していなかった（`--source zzz` で再現）。空振り・母数の半減・要確認の増加で落ちる。
call :step "audit facts"       "npm run audit:facts"       || exit /b 1

echo [%date% %time%] データ更新と機械チェックは正常終了（描画監査は未実行） >> %LOG%
echo データ更新と機械チェックは通りました。
echo ただし **描画監査 npm run audit:page はまだ回していません**（dev サーバか本番URLが要るため）。
echo 画面に出た文字列の検査はこれをやるまで済んでいません。「全部チェックした」と言わないこと。
exit /b 0

:step
echo [%date% %time%] %~1 start >> %LOG%
call %~2 >> %LOG% 2>&1
if errorlevel 1 (
  echo [%date% %time%] %~1 FAILED >> %LOG%
  echo 【失敗】%~1 で ERROR が出ました。%LOG% を確認してください。
  exit /b 1
)
echo [%date% %time%] %~1 ok >> %LOG%
exit /b 0
