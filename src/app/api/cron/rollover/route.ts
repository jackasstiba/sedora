import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { nowInstant, todayJst } from "@/lib/date";
import { ROLLOVER_EVENT } from "@/lib/rollover";

/**
 * 日付が変わった瞬間に、配信済みのHTMLを捨てる（`/api/cron/rollover`・毎日 0時台 JST）。
 *
 * 由来（2026-08-19 実測・本番）: 一覧ページは ISR（`export const revalidate = 1800`）なので
 * **「あと◯日」がHTMLに焼き付く**。ISRは*リクエストが来たとき*にしか作り直さないので、
 * 夜のうちに誰も来なければ前日の版がそのまま残る。実際 08:20 の `/tcg/遊戯王` は
 * 「あと5日」（正しくは あと4日）で、08:40 に再取得したら直っていた＝**日本時間0時を回ってから
 * 最初の訪問者が来るまで、前日の数字を配り続けていた**（audit:page が 4件/2925バッジ で検出）。
 * カウントダウンはこのサイトでいちばん時間に敏感な表示なので、暦が変わったら必ず作り直す。
 *
 * `revalidate` の値をいくら短くしてもこの型は消えない（短くなるのは「古いと見なすまでの時間」で、
 * 作り直す引き金は依然としてアクセス）。**暦の側から捨てにいく**のが唯一の直し方。
 *
 * 動いたことは Event（name="cache_rollover"）に残す。残さないと
 * **cronが静かに止まったときに誰も気付けない**（audit `cache_rollover_stalled` がこれを見る）。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 直前の実行からこの時間以内なら何もしない（同じ日に何度叩かれても増幅しない＝踏み台対策）。 */
const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** 作り直しを待たせないために温め直すページ（少数に絞る。残りは最初の訪問者が引き金になる）。
 *  /en を含める: 日本時間0時＝米国の昼なので、英語版こそ purge 直後に訪問が来る
 *  （[[Projects/sedori_radar_en]] 注意点§2「ISRの焼き付きは時差で悪化する」）。 */
const WARM_PATHS = ["/", "/lottery", "/en"];

function unauthorized(): Response {
  return new Response("unauthorized", { status: 401 });
}

export async function GET(req: NextRequest) {
  // CRON_SECRET を設定してあるなら必須にする（Vercel Cron は自動でこのヘッダを付ける）。
  // 未設定でも動くようにしてあるのは、**設定を忘れた日に黙って直らなくなるのを避ける**ため。
  // このエンドポイントの効果はキャッシュ破棄だけで、短時間の連打は下の間隔ガードが吸収する。
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return unauthorized();

  const last = await prisma.event.findFirst({
    where: { name: ROLLOVER_EVENT },
    orderBy: { createdAt: "desc" },
  });
  // 壁時計を読むのは src/lib/date.ts だけ（audit clock_discipline / eslint の両方が見張っている）。
  const now = nowInstant().getTime();
  if (last && now - last.createdAt.getTime() < MIN_INTERVAL_MS) {
    return Response.json({ ok: true, skipped: "直前の実行から12時間以内", last: last.createdAt });
  }

  // ルートレイアウト配下＝全ページを対象に捨てる。ページを列挙すると、
  // 新しいページを足した日に必ず漏れる（同じ型の穴を「表示範囲」で一度踏んでいる）。
  revalidatePath("/", "layout");

  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const warmed: string[] = [];
  if (site) {
    for (const p of WARM_PATHS) {
      try {
        const res = await fetch(`${site}${p}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) warmed.push(p);
      } catch {
        // 温め直しは付加価値。失敗しても捨てる方は済んでいるので握りつぶす。
      }
    }
  }

  const jstDate = todayJst().toISOString().slice(0, 10);
  await prisma.event.create({
    data: { name: ROLLOVER_EVENT, value: jstDate, path: "/api/cron/rollover", data: JSON.stringify({ warmed }) },
  });
  return Response.json({ ok: true, jstDate, warmed });
}
