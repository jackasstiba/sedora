/**
 * 「時計を読む行」を src/lib/date.ts の外に書かせないための静的検査（純関数）。
 *
 * なぜコードを検査するのか（2026-08-16 ミス24の直後に、同じ型が他に何箇所あるか数えた結果）:
 * 「今日」を日本時間で求める +9h の実装が **6箇所にコピー**されていて、そのうち1つ
 * （cardChusen.ts）だけが UTC暦日を返していた。日本時間 09:00 より前に巡回した回だけ
 * 全部の締切が1日早くなる＝**昼に動かすと再現しない**ので、目視でもテストでも見つからない。
 * さらに月別ページURLを `new Date().getMonth()`（＝実行環境のローカル時刻）で組み立てている
 * スクレイパーが3つあり、UTCの箱で回せば毎月1日の朝だけ前月を取りに行く状態だった。
 *
 * データをいくら眺めても分からないが、**ファイルを1回読めば分かる型**なので機械で見る。
 * 「規約をドキュメントに書く」では守れなかった実績があるため（rules.md に「今日を求める関数が
 * 2つ以上あってはいけない」と書いた翌日に、6箇所あることが判明した）、audit の ERROR にする。
 *
 * 検査は「Dateの使用禁止」ではない。**壁時計を読む行**（今が何時かに依存する行）と
 * **ローカルTZに依存する行**だけを落とす。引数付きの `new Date(x)`・`Date.UTC(...)`・
 * `getUTC*()` は暦日の正しい扱い方そのものなので対象外。
 */

export type ClockViolation = { file: string; line: number; rule: string; snippet: string };

/** 検査対象から外すファイルと、その理由。**理由を書かずに足さないこと。** */
export const CLOCK_ALLOWLIST: { file: string; reason: string }[] = [
  { file: "src/lib/date.ts", reason: "時計を読む唯一の場所（この規約の実装本体）" },
  { file: "src/lib/clockLint.ts", reason: "この検査自身。禁止パターンを文字列として持つ" },
  {
    file: "scripts/fakeClock.mjs",
    reason: "audit:clock が時計を差し替えるための preload。Date を上書きするのが仕事",
  },
];

/**
 * コメントと文字列リテラルの中身を空白に潰す（行数と桁は保つ）。
 *
 * これをしないと、日付事故の経緯を書いた**説明コメント自身**が検査に引っかかる。
 * テンプレートリテラルは `${...}` の中に本物のコードが入るので、リテラル部分だけを潰す。
 */
export function maskNonCode(src: string): string {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  // テンプレートリテラルの入れ子（`a${`b`}c`）に対応するためのスタック
  const tmplStack: number[] = []; // 各テンプレートの ${ } のネスト深さ
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const end = src.indexOf("\n", i);
      blank(i, end < 0 ? n : end);
      i = end < 0 ? n : end;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      blank(i, end < 0 ? n : end + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j++;
        if (src[j] === "\n") break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === "`") {
      tmplStack.push(0);
      i++;
      // リテラル部分だけを潰し、${ } の中は残す
      while (i < n && tmplStack.length) {
        if (src[i] === "\\") {
          out[i] = " ";
          if (src[i + 1] !== "\n") out[i + 1] = " ";
          i += 2;
          continue;
        }
        if (src[i] === "`") {
          tmplStack.pop();
          i++;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          // 式の中はコードとして残す（対応する } まで進む）
          let depth = 1;
          i += 2;
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            else if (src[i] === "`") {
              // 式の中の入れ子テンプレートは、この while を抜けて外側の処理に任せる
              break;
            }
            i++;
          }
          continue;
        }
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

/** `new Date(` の引数の「トップレベルのカンマ」を数える（`new Date(Date.UTC(y,m,d))` は0個）。 */
function topLevelCommaCount(src: string, openParen: number): number {
  let depth = 0;
  let commas = 0;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return commas;
    } else if (c === "," && depth === 1) commas++;
  }
  return commas;
}

/** 呼び出しの引数テキストを取り出す（`(` の位置から対応する `)` まで）。 */
function callArgs(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(openParen + 1, i);
    }
  }
  return "";
}

const LOCAL_GETTERS = /\.(getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|getMilliseconds)\s*\(\s*\)/g;
const LOCAL_SETTERS = /\.(setFullYear|setMonth|setDate|setHours|setMinutes|setSeconds)\s*\(/g;
const WALL_CLOCK = /(?:new\s+Date\s*\(\s*\)|Date\s*\.\s*now\s*\(\s*\))/g;
const NEW_DATE = /new\s+Date\s*\(/g;
const TO_LOCALE = /\.(toLocaleDateString|toLocaleTimeString|toLocaleString)\s*\(/g;
const DATE_FIELD_OPTION = /\b(year|month|day|hour|minute|second|weekday|dateStyle|timeStyle)\s*:/;

export const CLOCK_RULE_WHY: Record<string, string> = {
  wall_clock:
    "壁時計を直接読んでいる。src/lib/date.ts の todayJst()（日本時間の暦日）/ nowInstant()（瞬間）を使う",
  local_getter:
    "ローカル時刻のゲッター。実行環境のTZで日付が変わる（暦日は UTC 0時で保存する規約なので getUTC* を使う）",
  local_setter: "ローカル時刻のセッター。同上（暦日の加減算は Date.UTC / ミリ秒で行う）",
  local_ctor:
    "new Date(年, 月, 日) はローカル0時を作る。暦日は new Date(Date.UTC(...)) で作る（UTCで動く本番と1日ズレる）",
  tz_unspecified_format:
    "TZを指定しない日時整形。実行環境のTZで日付が変わる（date.ts の formatShort/formatLong/formatDateTimeJst を使う）",
};

/** 1ファイル分の違反を返す（純関数）。file は表示用のパス。 */
export function findClockViolations(file: string, src: string): ClockViolation[] {
  const code = maskNonCode(src);
  const lineOf = (idx: number) => code.slice(0, idx).split("\n").length;
  const snippetOf = (idx: number) =>
    src
      .slice(Math.max(0, idx - 20), idx + 60)
      .replace(/\s+/g, " ")
      .trim();
  const out: ClockViolation[] = [];
  const push = (rule: string, idx: number) =>
    out.push({ file, line: lineOf(idx), rule, snippet: snippetOf(idx) });

  for (const m of code.matchAll(WALL_CLOCK)) push("wall_clock", m.index!);
  for (const m of code.matchAll(LOCAL_GETTERS)) push("local_getter", m.index!);
  for (const m of code.matchAll(LOCAL_SETTERS)) push("local_setter", m.index!);
  for (const m of code.matchAll(NEW_DATE)) {
    const open = m.index! + m[0].length - 1;
    if (topLevelCommaCount(code, open) >= 1) push("local_ctor", m.index!);
  }
  for (const m of code.matchAll(TO_LOCALE)) {
    const args = callArgs(code, m.index! + m[0].length - 1);
    if (m[1] === "toLocaleString" && !DATE_FIELD_OPTION.test(args)) continue; // 数値の桁区切り
    if (/timeZone\s*:/.test(args)) continue; // TZ を明示している＝可
    push("tz_unspecified_format", m.index!);
  }
  return out;
}

/** 検査対象のファイルか（allowlist を除く）。 */
export function isClockLinted(file: string): boolean {
  const f = file.replace(/\\/g, "/");
  return !CLOCK_ALLOWLIST.some((a) => a.file === f);
}
