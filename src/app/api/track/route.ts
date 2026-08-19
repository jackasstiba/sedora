import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCountableUserAgent, NOLOG_OPTOUT_EVENT } from "@/lib/nolog";

// 自前アクセス解析の受け口。ユーザー操作イベントだけを Turso の Event に記録する。
// prisma(libSQL) を使うので Node ランタイム＋動的必須。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 記録を許すイベント名（未知の名前は無視＝任意書き込みの踏み台にしない）。
const ALLOWED = new Set(["genre_select", "search", "outbound_click", NOLOG_OPTOUT_EVENT]);

// どのケースでも 204 を返す（計測失敗をユーザーに晒さない・攻撃者に情報を与えない）。
const NO_CONTENT = () => new Response(null, { status: 204 });

export async function POST(req: NextRequest) {
  try {
    // クローラは基本 JS を実行しないが、素の POST だけしてくる bot を軽く弾く。
    // 自分たちの道具（Claude Code の内蔵ブラウザ等）も同じ関数で落とす＝
    // クライアント側(logEvent)と**同じ判定**を通す。片側だけ直すと静かにズレる。
    const ua = req.headers.get("user-agent") ?? "";
    if (!isCountableUserAgent(ua)) {
      return NO_CONTENT();
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body.name !== "string" || !ALLOWED.has(body.name)) {
      return NO_CONTENT();
    }
    const value =
      typeof body.value === "string" ? body.value.slice(0, 200) : null;
    const data =
      body.data == null ? null : JSON.stringify(body.data).slice(0, 500);
    const path = typeof body.path === "string" ? body.path.slice(0, 300) : null;

    await prisma.event.create({ data: { name: body.name, value, data, path } });
    return NO_CONTENT();
  } catch {
    return NO_CONTENT();
  }
}
