// コラボイベント記事の「本文」から、せどらーが最も欲しい情報＝抽選/ランダム/数量限定の
// 有無と、注目賞品（タオル・アクスタ等）を抽出する純関数。
//
// 背景: 一覧カード由来のコラボは「開催」1行止まりで、その中の“抽選で当たる高額賞品”
// （例: ホロライブ×極楽湯の描き下ろしランダム配布マフラータオル＝メルカリ毎回20万円台）に
// たどり着けなかった。記事本文は表組みでなく散文なので A賞/B賞 の構造化抽出はできないが、
// 「抽選/ランダム」等のシグナルと賞品名詞は本文テキストから堅牢に拾える。

// 本文コンテナ #single__container 開始〜フッターウィジェット（新着一覧ナビ）手前までを
// 取り出し、タグを除去してテキスト化する。ナビの見出しノイズを本文に混ぜないため区切る。
export function extractArticleBody(html: string): string {
  const start = html.indexOf("single__container");
  if (start < 0) return "";
  const foot = html.indexOf("single__foot__content", start);
  const slice = foot > start ? html.slice(start, foot) : html.slice(start);
  return decodeEntities(slice.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// 抽選・ランダム性（＝当たり外れがある＝相場が付く）を示す語。
const LOTTERY_RE = /抽選|ランダム|くじ引き|くじ|応募|当選|トレーディング|ガチャ|ブラインド/;
// 数量限定・先着・受注など「入手性が低い」を示す語（抽選ではないが希少）。
const SCARCITY_RE = /数量限定|先着|限定生産|受注(生産|販売)?|完全受注|予約限定|会場限定|店舗限定/;

// せどらーが狙う注目賞品の名詞。長い複合語を先に並べ、短い語（タオル/カード/バッジ）が
// 複合語（マフラータオル/ポストカード/缶バッジ）に内包される場合は複合語を優先する。
const GOODS_NOUNS = [
  "マフラータオル", "フェイスタオル", "バスタオル", "タオル",
  "アクリルスタンド", "アクリルキーホルダー", "アクスタ",
  "トレーディングカード", "ブロマイド", "ポストカード", "ポスター",
  "ぬいぐるみ", "フィギュア", "ねんどろいど",
  "缶バッジ", "ピンバッジ", "バッジ",
  "ラバーストラップ", "アクリルチャーム", "チャーム", "キーホルダー",
  "クリアファイル", "ステッカー", "シール", "コースター",
  "タペストリー", "色紙", "マグカップ", "グラス",
  "トレカ", "カード",
];

export type CollabEnrichment = {
  hasLottery: boolean; // 抽選・ランダム性のある賞品がある
  hasScarcity: boolean; // 数量限定・受注など希少性がある
  highlights: string | null; // カード/詳細に出す注目賞品の要約
};

/** 本文テキストから抽選/希少シグナルと注目賞品名を抽出して要約する。 */
export function analyzeCollab(bodyText: string): CollabEnrichment {
  const hasLottery = LOTTERY_RE.test(bodyText);
  const hasScarcity = SCARCITY_RE.test(bodyText);

  // 本文に出現する注目賞品名を、複合語優先で最大4件まで拾う。
  const nouns: string[] = [];
  for (const noun of GOODS_NOUNS) {
    if (!bodyText.includes(noun)) continue;
    // 既に採用済みの語が今の語を内包する（例: マフラータオル採用済 → タオルは省く）なら skip
    if (nouns.some((n) => n.includes(noun))) continue;
    nouns.push(noun);
    if (nouns.length >= 4) break;
  }

  if (!hasLottery && !hasScarcity && nouns.length === 0) {
    return { hasLottery, hasScarcity, highlights: null };
  }

  const label = hasLottery ? "抽選・ランダム賞品" : hasScarcity ? "数量限定" : "注目グッズ";
  const highlights = nouns.length ? `${label}：${nouns.join(" / ")}` : label + "あり";
  return { hasLottery, hasScarcity, highlights };
}
