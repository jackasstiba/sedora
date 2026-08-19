// 自前アクセス解析イベントを /api/track へ送る（クライアント専用）。
// Vercel Web Analytics のカスタムイベントは Hobby では API 取得不可のため、
// Claude が読めるよう Turso にも記録する二経路のうちの「自前」側。fire-and-forget。
//
// outbound_click は送信直後にページ遷移が起きるので、遷移でキャンセルされない
// navigator.sendBeacon を優先する（fetch keepalive をフォールバック）。
//
// ⚠ 2026-08-19: **自分たちの操作をここで落とす**。
// 落とす前の記録は「1分間に14ジャンル全部」「同一商品へ3連打」で埋まっていて、
// 実需の証拠として読めなくなっていた（System/mistakes ミス33）。判定は src/lib/nolog.ts。
import { currentNologDecision, NOLOG_OPTOUT_EVENT } from "./nolog";

export function logEvent(name: string, value?: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  // 除外を始めた足跡（NOLOG_OPTOUT_EVENT）だけは、除外中でも送る。
  // これを落とすと「誰が除外されたか」が永久に分からなくなる。
  if (name !== NOLOG_OPTOUT_EVENT && currentNologDecision().skip) return;
  try {
    const payload = JSON.stringify({
      name,
      value,
      data,
      path: window.location.pathname,
    });
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/track", blob);
      return;
    }
    void fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    });
  } catch {
    // 解析の送信失敗はユーザー体験に影響させない。
  }
}
