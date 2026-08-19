/**
 * タカラトミーモールの受注終了行の掃除を、**巡回を回さずに**単体で実行する入口。
 * 巡回(36分)を回さないと一度も動かせない掃除は、入れた日に確かめられない（cleanupRecentWindow.ts と同じ理由）。
 *
 * 引数なし＝掲載中の全行を商品ページで確認する（＝巡回で拾えた行も念のため確認する）。
 */
import { prisma } from "@/lib/prisma";
import { cleanupTakaraTomyEnded } from "./cleanupTakaraTomyEnded";

cleanupTakaraTomyEnded(prisma, [])
  .then((r) => console.log(`確認 ${r.checked}件 / 削除 ${r.deleted}件 / 見送り ${r.skipped}件`))
  .finally(() => prisma.$disconnect());
