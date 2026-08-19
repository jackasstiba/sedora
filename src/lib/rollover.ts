/**
 * 「暦が変わったら配信済みHTMLを捨てる」仕掛けの定義（純関数だけ・prisma非依存）。
 *
 * 実体は `src/app/api/cron/rollover/route.ts`（毎日 0時台 JST に Vercel Cron が叩く）。
 * ここに置くのは **鳴る側と鳴らない側を合成データで固定できる形**にするため
 * （本物を動かすには本番のcronを待つしかなく、入れた当日は一度も確かめられない）。
 */

/** 実行の足跡を残す Event の名前。route も audit もこの定数だけを見る。 */
export const ROLLOVER_EVENT = "cache_rollover";

/** cron が叩くパス。vercel.json と実ファイルの突合に使う。 */
export const ROLLOVER_CRON_PATH = "/api/cron/rollover";

/**
 * 「止まっている」と判定するまでの猶予＝26時間。
 * 24時間ちょうどにすると、cronの発火が少し前後しただけで鳴る（＝暦で鳴る検査になる）。
 * Vercel の Hobby プランは発火時刻が1時間ほど揺れるので、24h + 2h を取る。
 */
export const ROLLOVER_MAX_AGE_MS = 26 * 60 * 60 * 1000;

/**
 * 直近の実行時刻から、報告すべき問題を返す（無ければ null）。
 *
 * **一度も動いていない**（null）と**動いていたのに止まった**は別物として扱う。
 * 前者はデプロイ直後に必ず通る状態なので、これを ERROR にすると
 * 「入れた日に必ず落ちる検査」になってしまう。
 */
export function rolloverProblem(
  lastAt: Date | null,
  now: Date
): { level: "warn" | "error"; message: string } | null {
  if (!lastAt) {
    return {
      level: "warn",
      message:
        "日付ロールオーバーが一度も動いていない（デプロイ直後ならこれで正常。翌日も出るなら vercel.json の cron を疑う）",
    };
  }
  const ageMs = now.getTime() - lastAt.getTime();
  if (ageMs > ROLLOVER_MAX_AGE_MS) {
    const hours = Math.floor(ageMs / 3_600_000);
    return {
      level: "error",
      message: `日付ロールオーバーが ${hours} 時間止まっている（最終 ${lastAt.toISOString()}）＝前日の「あと◯日」が配られている可能性`,
    };
  }
  return null;
}

/**
 * cron の schedule（UTC）が日本時間の何時に当たるかを返す。分・時が単一の値でなければ null。
 * 「日付が変わった直後に動く」ことを、書いてある文字列から機械で確かめるために使う。
 */
export function cronJstHour(schedule: string): number | null {
  const f = schedule.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hour, dom, mon, dow] = f;
  // 日付側が固定されている（毎日でない）なら、暦の変わり目の話ではないので対象外。
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;
  if (!/^\d{1,2}$/.test(min) || !/^\d{1,2}$/.test(hour)) return null;
  return (Number(hour) + 9) % 24;
}
