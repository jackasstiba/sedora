"use client";

import { Analytics } from "@vercel/analytics/next";
import { useEffect } from "react";
import { logEvent } from "@/lib/logEvent";
import { applyNologDecision, currentNologDecision, NOLOG_OPTOUT_EVENT } from "@/lib/nolog";

/**
 * Vercel Web Analytics の設置口。**自分たちの訪問をここで落とす。**
 *
 * `beforeSend` は関数なので client component からしか渡せない（layout.tsx はサーバ側）。
 * それだけのためのラッパで、判定そのものは `src/lib/nolog.ts` にある（検査で固定するため）。
 *
 * `beforeSend` は送信のたびに呼ばれるので、`?nolog=1` を踏んだ瞬間から効く。
 */
export function SiteAnalytics() {
  useEffect(() => {
    // `?nolog=1` / `?nolog=0` を localStorage の印に落とす。
    // 除外を**始めた瞬間だけ**足跡を残す（漏れて本物の読者が消えたら件数で見える）。
    const decision = currentNologDecision();
    if (applyNologDecision(decision)) {
      logEvent(NOLOG_OPTOUT_EVENT);
    }
  }, []);

  return <Analytics beforeSend={(event) => (currentNologDecision().skip ? null : event)} />;
}
