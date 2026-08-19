/**
 * raffle_kuji の締切の引き直しを、**巡回を回さずに**単体で実行する入口。
 * 巡回(36分)を回さないと一度も動かせない掃除は、入れた日に確かめられない
 * （cleanupRecentWindow.ts / runCleanupTakaraTomy.ts と同じ理由）。
 *
 * 引数なし＝DBにある raffle_kuji の全行を応募ページで確認する。
 */
import { prisma } from "@/lib/prisma";
import { refreshRafflePeriods } from "./refreshRafflePeriods";

refreshRafflePeriods(prisma, [])
  .then((r) => console.log(`確認 ${r.checked}件 / 引き直し ${r.updated}件 / 期間を読めず ${r.unreadable}件`))
  .finally(() => prisma.$disconnect());
