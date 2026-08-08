// Xミラー系(channeltono/rarecheck)のタイトルは実況コメント込みの自由文で長い。
// 一覧カードでの可読性を上げるため、表示用に商品名へ寄せて整形する。
// ※ 非破壊: DBの生titleは検索・詳細ページ用にそのまま残し、これは「一覧カードの表示専用」。
//   誤って商品名を削らないよう、剥がすのは実況コメント語を含む部分だけに限定し、
//   商品タグ(【特典】等)や『』内は決して削らない。結果が短くなりすぎたら生titleに戻す。

// タイトルが「商品名」ではなく投稿本文（実況・告知の自由文）であるソース。
// x_watch も X の投稿をそのまま取り込むので同じ性質（実測: 「7月24日11時より30日まで！
// ガンダムカードゲーム ブースターパック…」が /premium の先頭に出ていた）。
const CLEANABLE_SOURCES = new Set(["channeltono", "rarecheck", "x_watch"]);

// snkrdunk（スニーカーダンク）は全商品タイトル末尾に「｜抽選/販売/定価情報」という
// 内部向けの定型ラベルが付く。ユーザーには無意味なノイズなので、表示時に必ず剥がす。
// （DBの生titleは isLotteryItem 等の判定に使うので温存し、これは表示専用。）
const SOURCE_LABEL_TAIL = /\s*[｜|]\s*(?:抽選|販売|定価|情報)[^｜|]*$/;
// 先頭の「最新リーク｜」「リーク｜」等のラベル（snkrdunkのリーク記事）。
const SOURCE_LABEL_HEAD = /^(?:最新)?リーク\s*[｜|]\s*/;

// 開き括弧だけが余っているタイトル（実測: トレカ速報の12件が
// 「『【MTG】プレイヤーズカードスリーブ … 《調和した大合唱》(80枚入り)」と、
// 閉じない『で始まっていた）。文の始まりに閉じない括弧があるのは、人間なら一瞬で気付く粗。
const BRACKET_PAIRS: [string, string][] = [
  ["『", "』"],
  ["「", "」"],
  ["【", "】"],
  ["（", "）"],
];

/**
 * 対応が取れていない括弧記号だけを落とす。対応が取れている括弧には触らない。
 *
 * 収集元の原文が壊れていることがある（実測: 「…世界最強の戦士【OP-17」＝投稿者が閉じ括弧を
 * 打ち忘れ、「ヴァンガード『征標艦隊提督 …(70枚入り)」＝記事側の誤記）。中身は正しい情報なので
 * 消さず、**余った記号だけ**を取り除いて「…世界最強の戦士OP-17」と読める形にする。
 * 括弧を補って閉じる（＝無い文字を足す）ことはしない。
 */
function dropUnmatchedBrackets(title: string): string {
  let t = title.trim();
  for (const [open, close] of BRACKET_PAIRS) {
    let opens = t.split(open).length - 1;
    let closes = t.split(close).length - 1;
    // 開きが余る → 最後の開き括弧を落とす（先頭の孤立した『も同じ規則で消える）
    while (opens > closes && opens > 0) {
      const i = t.lastIndexOf(open);
      t = (t.slice(0, i) + t.slice(i + open.length)).trim();
      opens--;
    }
    // 閉じが余る → 最初の閉じ括弧を落とす
    while (closes > opens && closes > 0) {
      const i = t.indexOf(close);
      t = (t.slice(0, i) + t.slice(i + close.length)).trim();
      closes--;
    }
  }
  return t;
}

// 見えない文字（ゼロ幅スペース等）。表示は正常に見えるのに、検索・重複判定・文字数を狂わせる。
// 収集元のHTMLから紛れ込むので、表示用整形の入口で必ず落とす。
const INVISIBLE = /[​-‍﻿⁠­]/g;

/** 情報元由来の定型ラベル（末尾「｜抽選/販売/定価情報」・先頭「最新リーク｜」等）を表示用に除去する。全ソース対象。 */
export function stripSourceLabel(title: string): string {
  const t = dropUnmatchedBrackets(
    title.replace(INVISIBLE, "").replace(SOURCE_LABEL_TAIL, "").replace(SOURCE_LABEL_HEAD, "").trim()
  );
  return t.length >= 4 ? t : title.trim();
}

// 末尾の「〜M月D日より〜開催/登場/発売/コラボ!」型の日付告知（主にコラボ記事タイトル）。
// 例:「ちいかわ × パレード 7月24日よりプレゼントキャンペーン実施!」→「ちいかわ × パレード」。
// 「8月より登場!」(日なし)・「2026.10.3より開催!」(ドット日付)・「7月第4週より登場!」
// 「12月頃より発売!」も対象。日付＋「より/から/〜」＋告知語＋！で終わる末尾節を丸ごと剥がす。
// 発売日・イベント種別は eventDate バッジ・eventType バッジで別途表示されるので、
// タイトル末尾の重複した告知文は純粋なノイズ。「より/から」を必須にして誤爆を抑える
// （単に「◯月発売」で終わる商品名は剥がさない）。剥がして6字未満になるなら原文を返す。
const ANNOUNCE_VERB =
  "(?:開催|開店|登場|発売|配信|上映|放送|スタート|販売|受付|開始|実施|オープン|解禁|予約|決定|コラボ|順次|リリース)";
// 日付トークン:「2026年8月」「8月12日」「8月」「10.16」「2026.10.3」「7月第4週」「7月5週」「12月頃」等。
// 「N週」は第あり・なし両方。曜日カッコ (土) も日付側で許容。
const DATE_TOKEN =
  "(?:\\d{4}\\s*[年.．]\\s*)?\\d{1,2}\\s*[月.．]\\s*(?:第?\\s*\\d{1,2}\\s*週|\\d{1,2}\\s*日?|上旬|中旬|下旬|末|頃|ごろ)?";
const DATE_NOTICE_TAIL = new RegExp(
  `(?:\\s|　|を|は|も|が|、|・)*${DATE_TOKEN}\\s*(?:\\([日月火水木金土]\\))?\\s*(?:頃|ごろ)?\\s*(?:より|から|〜|~|以降)\\s*[^!！。]*?${ANNOUNCE_VERB}[^!！。]*[!！]\\s*$`
);

/** 末尾の日付告知（「〜8月6日よりコラボ開催!」等）を表示用に除去する。全ソース対象・非破壊。
 *  ※「!」入りの商品名（ラブライブ!／ぱたぱたっ！ 等）を巻き込まないよう、複数文にまたがる
 *   末尾告知の一括除去はしない（誤爆が大きいため）。日付＋より＋告知語＋!の1節だけを剥がす。 */
export function stripDateNoticeTail(title: string): string {
  const t = title.trim().replace(DATE_NOTICE_TAIL, "").trim();
  return t.length >= 6 ? t : title.trim();
}

/**
 * subGenre（種別）バッジの表示値。収集元の痕跡（X巡回ハンドル @xxx）は非公開方針のため出さない。
 * 書き込み側(xWatch)は修正済みだが、既存DBに残る @handle の subGenre を表示層でも握りつぶす。
 */
export function displaySubGenre(subGenre: string | null | undefined): string | null {
  if (!subGenre) return null;
  const t = subGenre.trim();
  if (!t || t.startsWith("@")) return null;
  return t;
}

// 実況コメント特有の語。これを含む先頭/末尾セグメントだけを剥がす。
// ※「特典/限定販売/数量限定」は商品タグ(【特典】等)の一部なのでコメント語に含めない。
const COMMENTARY =
  /(予約|販売|再開|開始|完売|まだあり|まだいけ|ご注意|注意を|きたー|来たー|復活|オフ|％オフ|値引|大幅|残り|即完売|豪華|人気|お早め|お早目|きました|いけます|即完|抽選受付|受付開始|更新|動画|いいね)/;

// 末尾の「〜が抽選受付開始！」等のアクション告知（商品名ではない）。連結助詞＋動作句＋記号。
const TRAILING_ACTION =
  /\s*(?:が|も|を|は|、|。)?\s*(?:(?:抽選)?受付開始|予約(?:受付)?開始|販売(?:開始|再開)|受注(?:生産)?(?:開始)?|再販(?:開始|決定)?|再入荷|復活)(?:へ|中|です)?[！!。\s]*$/;

/** 商品名らしさ（英数・4字以上のカタカナ・商品タグを含む＝コメントとして剥がしてはいけない）。
 *  カタカナ判定には長音「ー」と中黒「・」を含める。[ァ-ヶ] だけだと「ボードゲーム」「リコール」が
 *  長音で分断されて3字扱いになり、商品名なのにコメントと誤判定されていた（実測で掲載漏れ）。 */
function looksProduct(s: string): boolean {
  return /[【『「]/.test(s) || /[A-Za-z0-9]/.test(s) || /[ァ-ヶー・]{4,}/.test(s);
}

// ── 節（セグメント）選択方式 ─────────────────────────────────────────────
// Xミラー(channeltono)の生タイトルは商品名ではなく**実況ツイート本文**で、商品名は文中の
// どこに現れるか決まっていない。「先頭から剥がす／末尾から剥がす」手続き型だと、商品名が
// 中間にある投稿で逆に商品名を捨ててコメントを残す（実測: 「あみあみで販売再開まさかの
// まだあり！キルラキル 纏流子…　ヤフオク高騰の人気なのでお早めに」→「ヤフオク高騰の
// 人気なのでお早めに」）。正規表現を足し続けても、この非対称は消えない。
//
// そこで「剥がす」のをやめ、**節に割って商品名の節だけを選ぶ**方式にする。人間が一瞬で
// 見分けているのも節単位（これは実況、これは商品名）なので、判断の単位を合わせる。
//   1) 「！」「。」「全角スペース」で節に割る
//   2) 節ごとに前後の店舗告知を落としてから、商品節／コメント節に分類する
//   3) コメント節を捨て、残った**隣接する商品節ブロックの最長**を元の区切りで結合して採用
// 商品節が1つも無い投稿（「もうすぐあみあみで復活更新があるかと…」等）は商品として成立
// していない＝ hasProductSegment() が false になり、一覧から除外する（itemFilter 側）。

// 販促・ランキング告知（商品名ではない）。楽天セール文言・順位・いいね数など。
const PROMO_NOISE =
  /(?:楽天スーパーDEAL|お買い物マラソン|楽天カード\s*\d+\s*倍|ポイント\s*\d+\s*倍|スーパーセール|ブランドデー|クーポン|送料無料|\d+\s*位(?:と\d+\s*位)*|いいね数|独占へ|上位へ)/;

// 販売チャネル（店舗）名。単体では商品名を含む節にも出るので、動作語との併用で判定する。
const STORE_NAME =
  /(?:あみあみ|プレバン|プレミアムバンダイ|駿河屋|楽天ブックス|楽天|ヨドバシ(?:カメラ)?|Amazon|アマゾン|ビックカメラ|ビック|アキバソフマップ|ソフマップ|エディオン|ジョーシン|ヤマダ電機|ケーズデンキ|ノジマ|DMM|HMV|Neowing|でじたみん|イエローサブマリン|ぐるぐる王国|バトンストア|ミニストップ|セブン(?:ネット)?|ローソン|イオン|タカラトミーモール|ハピネット|dショッピング|マクドナルド|ホビーストック|ホビーサーチ|アニメイト|メディアワールド|A-TOYS|TSUTAYA|ドン・キホーテ)/;

const STORE_NAME_G = new RegExp(STORE_NAME.source, "g");

// 在庫・受付の状態語（商品名ではない）。
const STOCK_ACTION =
  /(?:予約(?:受付)?(?:開始|再開|中)|販売(?:開始|再開|中)|受付(?:開始|中)|再入荷|入荷|復活(?:更新)?|受注|抽選受付|完売|品薄|即完|値引|[％%]オフ|特価)/;

// 節の末尾に付く実況の締め（「〜お早めに」「〜ご注意を」「〜まだあり」「〜人気かと」等）。
// 商品名の後ろに直付けされることが多く、区切り文字が無いので節内で落とす必要がある。
const SEG_TAIL_NOISE = new RegExp(
  "(?:" +
    [
      "(?:お|ご)?(?:早|はや)めに?どうぞ?",
      "ご?注意(?:を|ください|下さい)?",
      "まだあり(?:ます)?",
      "まだいけ(?:ます)?",
      "お知らせ",
      "が?(?:特に)?(?:大変)?人気(?:だった)?(?:かと|です|高そうです|そうです|ようです)?",
      "入手困難かと",
      "だそうです",
      "(?:だった)?ようです",
      "完売(?:中|です)?",
      "他店[もは]?(?:即)?完売の?(?:人気)?",
      "の?予約(?:再開|開始)など?",
      "送料無料へ?",
      "(?:まだ)?[０-９0-9]{1,3}\\s*[％%]\\s*オフ(?:あり|で)?",
      "の?(?:予約|販売)?(?:開始|再開)が?あったので[^、。！!]{0,12}",
      "が[^、。！!]{0,16}(?:で|にて)(?:の)?(?:販売|予約)?(?:再開|開始|中|復活)(?:です|中)?[^、。！!]{0,10}",
      "が(?:予約|販売|受注|抽選)?(?:受付)?(?:開始|再開|中|決定)(?:です|でした|中)?",
      // 「が」を伴わない受付告知の末尾（「…などで予約開始」）。これを残すと、告知節の方が
      // 商品名の節より長くなり、最長ブロック選択で告知側が採用されてしまう（実測）。
      "(?:など)?(?:で|にて)?(?:予約|販売|受注)(?:受付)?(?:開始|再開|中)(?:です|中|きたー|来たー)?",
      "が?多数あり(?:今回も)?",
      // 楽天のセール文言が商品名の後ろに直付けされるケース（区切り記号が無い）。
      // ※ セール語の手前に「任意の文字」を許すと商品名を巻き込んで削る（実測で
      //   「TurboPowerチャージャー同梱 本日楽天カード4倍…」→「TurboPowerチャー」）。
      //   手前に許すのは空白と定型の副詞・接続助詞だけに限定する。
      "[\\s　]*(?:本日|しかも|さらに|なお)?[\\s　]*(?:や|と|、)?(?:楽天)?(?:楽天カード\\s*[０-９0-9]+\\s*倍|お買い物マラソン|楽天スーパーDEAL|ブランドデー)[^、。！!]{0,16}",
    ].join("|") +
    ")[。、！!\\s　]*$"
);

// 節の先頭に付く実況の入り（「まずは」「残り10個ですが」「昼間あみあみで」「◯◯楽天で」等）。
const SEG_HEAD_NOISE = new RegExp(
  "^[\\s　]*(?:" +
    [
      "まずは",
      "まさかの",
      "しかも",
      "(?:本日|昨日|一昨日|明日|昼間|今朝|先ほど|最近|もうすぐ|まもなく|いつのまにか)",
      // 「8月7日12時より楽天ファッションで」型。先頭が日付なので商品名ではないと断定できる。
      // 店舗名を辞書に持たなくても、日付＋より＋（短い語）＋で／にて で切り出せる。
      "[０-９0-9]{1,2}\\s*月\\s*[０-９0-9]{1,2}\\s*日\\s*(?:\\([日月火水木金土]\\))?\\s*(?:[０-９0-9]{1,2}\\s*時)?\\s*(?:より|から)?\\s*(?:[^、。！!]{0,12}?(?:で|にて))?",
      "[^、。！!]{0,10}(?:ですが|ますが)",
      "残り\\d+\\s*個(?:ですが)?",
      "各店(?:で|にて)?",
      "(?:大幅)?値引き?(?:率高いです|あり)?",
      "[^、。！!]{0,12}?[０-９0-9]{1,3}\\s*[％%]\\s*オフと値引き率高いです",
      "[^、。！!]{0,10}?(?:も|は)まだあり",
      "[０-９0-9]{1,3}\\s*[％%]\\s*オフ(?:で|あり)?",
      "(?:販売|予約)(?:受付)?(?:再開|開始|中)(?:です|中)?",
      "オンライン(?:品薄|即完売|完売)(?:多数)?(?:だった)?の?",
      "他店(?:も|は)?(?:即)?完売(?:多数)?(?:の人気)?の?",
      "[０-９0-9]{1,3}\\s*個まで(?:いけます|購入可)?",
      "[^、。！!]{0,12}?(?:なので|ので)?(?:お|ご)(?:早|はや)めに?",
      STORE_NAME.source + "[^、。！!]{0,8}?(?:完売中|品薄|即完売)の",
      // 店舗名を辞書に持たない販売告知（「播州セレクト楽天で販売再開」「ガチャガチャ侍楽天も予約再開」）。
      // 「〜で/にて/も/は」＋受付動作 で始まる先頭節は、店舗名を知らなくても告知と判定できる。
      "[^、。！!]{0,12}?(?:で|にて|も|は)(?:の)?(?:再販)?(?:販売|予約|受注)(?:受付)?(?:再開|開始|中)(?:きたー|来たー|です|中)?",
      // 店名が長い告知（「漫画全巻ドットコム楽天やヨドバシなどで予約開始まだあり」）。
      // 窓を広げる代わりに、店らしい語（楽天/ストア/など…）を必ず含むことを条件にして
      // 商品名を巻き込まないようにする。
      "[^、。！!]{0,20}?(?:楽天|ドットコム|ストア|ショップ|など)[^、。！!]{0,8}?(?:で|にて|も|は)(?:の)?(?:販売|予約|受注)(?:受付)?(?:再開|開始|中)(?:きたー|来たー|です|中)?",
      // 「アイロボット楽天で57％オフセール開催中」型の値引き告知。
      "[^、。！!]{0,12}?(?:で|にて)\\s*[０-９0-9]{1,3}\\s*[％%]\\s*オフ[^、。！!]{0,12}",
      STORE_NAME.source + "[^、。！!]{0,10}?(?:で|にて|は|より|なら)",
      // ※ 短い接頭辞（「他店」単体）は長い方の後に置く。正規表現の選択は先に書いた方が
      //   優先されるため、先頭に置くと「他店完売多数」から「他店」だけを削って
      //   「完売多数」が商品名の前に残る（実測）。
      "他店[もは]?",
    ].join("|") +
    ")[\\s　]*"
);

/** 節から前後の実況断片（店舗告知・締め文句）を落とす。
 *  節まるごとが告知なら空文字を返してよい（＝その節は捨てる）。商品名側は削らない
 *  （4字未満の中途半端な残りは採らず、直前の状態に戻す）。 */
function trimSegNoise(seg: string): string {
  let s = seg.trim();
  for (let i = 0; i < 4; i++) {
    const before = s;
    const h = s.replace(SEG_HEAD_NOISE, "").trim();
    if (h.length >= 4 || h.length === 0) s = h;
    const t = s.replace(SEG_TAIL_NOISE, "").trim();
    if (t.length >= 4 || t.length === 0) s = t;
    if (s === before || s === "") break;
  }
  return s;
}

// 商品名には決して現れない実況語（相場・在庫の実況）。商品らしさに関係なく捨ててよい。
const ALWAYS_COMMENT =
  /(?:高騰|ヤフオク|メルカリ|転売|せどり|まだあり|まだいけ|品薄|即完|人気(?:です|かと|順|高|沸騰|爆発)|お(?:早|はや)めに|ご注意|完売(?:へ|中|多数|だった|です|しました))/;
// 商品名にも現れうる語（「（再販）」「限定販売」等）。**その節に商品名が含まれない時だけ**実況とみなす。
const CONTEXT_COMMENT = /(?:完売|再開|再販|復活|値引|[％%]オフ|特価)/;

/** 節が「実況コメント」か（＝捨ててよいか）。
 *  商品タグ【】『』を含む節、および商品名を含む節は残す（＝コメント語が同居していても捨てない）。
 *  過去に「あみあみ箱破損特価で販売再開S.H.Figuarts…」のような**店舗告知と商品名が同じ節に
 *  同居する**投稿を丸ごと捨ててしまい、実在商品が一覧から消えたため、この優先順にする。 */
function isCommentSeg(seg: string): boolean {
  const s = seg.trim();
  if (!s) return true;
  if (/[【『「]/.test(s)) return false;
  // 「（再販）」「(再販版)」等の仕様括弧は商品名の一部なので、実況語の判定から外す。
  const core = s.replace(/[（(][^）)]{0,10}[）)]/g, "");
  // 価格・数量だけの断片（「6パックで2380円」）。英数を含むので商品名判定を通ってしまうが、
  // 商品名らしい語（英字3字以上・カタカナ4字以上）が無いなら値段の実況にすぎない。
  if (core.length <= 24 && /[０-９0-9]\s*円/.test(core) && !/[A-Za-z]{3,}|[ァ-ヶー・]{4,}/.test(core.replace(STORE_NAME_G, "")))
    return true;
  // 日付・時刻の告知だけの断片（「7月24日11時より30日まで」）。数字を含むので商品名判定を
  // 通ってしまうが、日付語を取り除いて商品名らしい語が残らないなら告知にすぎない。
  // 実測: これが残ると「7月24日11時より30日まで！ガンダムカードゲーム…」が
  // /premium の先頭（最も目立つ場所）に出ていた。
  if (/[０-９0-9]\s*[月日時]|[０-９0-9]{1,2}\s*\/\s*[０-９0-9]{1,2}/.test(core)) {
    const rest = core
      .replace(/[０-９0-9]{1,4}\s*[年月日時分/:：]/g, "")
      .replace(/(?:本日|明日|昨日|より|から|まで|以降|頃|ごろ|開始|終了|受付|予約|抽選|[（(][日月火水木金土][）)])/g, "")
      .trim();
    if (!/[A-Za-z]{2,}|[ァ-ヶー・]{4,}|[【『「]/.test(rest)) return true;
  }
  if (ALWAYS_COMMENT.test(core)) return true;
  if (STRONG_COMMENT_END.test(core)) return true;
  if (PROMO_NOISE.test(core)) return true;
  // ここから先は「商品名が無い節だけ」実況とみなす。
  if (isProductSeg(core)) return false;
  if (CONTEXT_COMMENT.test(core)) return true;
  if (STORE_NAME.test(core) && STOCK_ACTION.test(core)) return true;
  if (COMMENTARY.test(core)) return true;
  return false;
}

/** 節が「商品名」として通用するか（英数・型番・4字以上カタカナ・商品タグのいずれか＋長さ）。
 *  店舗名（アキバソフマップ等）は4字以上のカタカナなので、除いてから判定する。
 *  除かないと「あみあみやアキバソフマップなど大幅値引きでまだあり」が商品名扱いになる。 */
function isProductSeg(seg: string): boolean {
  const s = seg.replace(STORE_NAME_G, "").trim();
  if (s.length < 4) return false;
  return looksProduct(s);
}

type Seg = { text: string; sep: string };

/** 「！」「。」「全角スペース」で節に割る（区切り文字は復元用に保持）。 */
function splitSegments(s: string): Seg[] {
  const out: Seg[] = [];
  const re = /([！!。]+|[　]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const text = s.slice(last, m.index);
    if (text.trim() === "" && out.length) out[out.length - 1].sep += m[1];
    else out.push({ text, sep: m[1] });
    last = m.index + m[1].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), sep: "" });
  return out.filter((x) => x.text.trim() !== "");
}

/** 商品名として採れる節が1つでもあるか（＝商品として成立している投稿か）。 */
export function hasProductSegment(source: string, title: string): boolean {
  if (!CLEANABLE_SOURCES.has(source)) return true;
  if (NON_PRODUCT_POST.test(title)) return false;
  const base = stripDateNoticeTail(stripSourceLabel(title));
  if (source === "rarecheck" && firstBracketed(base)) return true;
  return pickProductBlock(base) !== null;
}

/** 開発用: 節分解と判定結果を可視化する（表示には使わない）。 */
export function __debugSegments(title: string) {
  const base = stripDateNoticeTail(stripSourceLabel(title));
  return splitSegments(base).map((s) => {
    const trimmed = trimSegNoise(s.text);
    return {
      orig: s.text,
      trimmed,
      product: isProductSeg(trimmed),
      keep: trimmed.trim() !== "" && isProductSeg(trimmed) && !isCommentSeg(trimmed),
    };
  });
}

/** 節に割り、コメント節を捨て、残った隣接ブロックのうち最長を返す（無ければ null）。 */
function pickProductBlock(raw: string): string | null {
  const segs = splitSegments(raw);
  if (!segs.length) return null;
  const cleaned = segs.map((s) => ({ ...s, text: trimSegNoise(s.text) }));
  // 残すのは「商品名として通用する節」だけ。単に実況語が無いだけの断片（告知を削った残りの
  // 「店の早期」等）を残すと、商品名の前後にゴミが付いたまま表示される。
  const keep = cleaned.map((s) => s.text.trim() !== "" && isProductSeg(s.text) && !isCommentSeg(s.text));

  // 隣接する keep 節をブロックにまとめ、商品節を含む最長ブロックを選ぶ。
  let best: { text: string; len: number } | null = null;
  let i = 0;
  while (i < cleaned.length) {
    if (!keep[i]) {
      i++;
      continue;
    }
    let j = i;
    let text = "";
    let hasProduct = false;
    while (j < cleaned.length && keep[j]) {
      // 元の区切り文字で結合し直す（商品名内の「！」を割ってしまっても復元される。
      // 例:「ウルトラマン カードゲーム ブースターパック09 きたぞ！われらの 24パック入りBOX」）
      if (text) text += cleaned[j - 1].sep;
      text += cleaned[j].text;
      if (isProductSeg(cleaned[j].text)) hasProduct = true;
      j++;
    }
    text = text.trim();
    if (hasProduct && text.length >= 6 && (!best || text.length > best.len)) {
      best = { text, len: text.length };
    }
    i = j;
  }
  return best ? best.text : null;
}

/** 『...』で囲まれた最初の商品名（長さ4以上）を取り出す。
 *  ※ rarecheck 専用。レアチェックの記事タイトルは『商品名』がビックカメラにて販売開始。という
 *    定型なので、『』の中＝商品名で確実。
 *  ※ 「...」（一重）は対象にしない。channeltono では作品名の囲みに使われるため、
 *    「【特典】ヴァイスシュヴァルツ ブースターパック「Re：ゼロから始める異世界生活」Vol.4
 *    10パック入りBOX」が丸ごと「Re：ゼロから始める異世界生活」に化け、実際の商品（BOX）が
 *    消えていた（実測66件が過剰に短縮）。 */
function firstBracketed(title: string): string | null {
  const m = title.match(/『([^』]{4,})』/);
  return m ? m[1].trim() : null;
}

// 商品ではない実況投稿（店の在庫「復活更新」の予告など）。商品名が存在しないので掲載しない。
// 読み手への呼びかけだけで、商品を1つも名指ししていない投稿。
// 「事前エントリー」はカタカナを含むので looksProduct を通ってしまうが、商品名ではない
// （実測: 「事前エントリーお忘れなくどうぞ」が1件そのまま掲載されていた）。
// 先頭がこれで始まる＝投稿全体が呼びかけ、とみなす。
const NON_PRODUCT_POST = /復活更新|^\s*事前エントリー/;

// 明確に実況コメントと断定できる節の兆候。これに該当する節は、カタカナを含んで
// looksProduct が真になっても（例:「ヤフオクめちゃ高騰の復刻です」の"ヤフオク"）実況と見なして剥がす。
// ・コメント文の終止（です/ます/でした/かと/そうです/ください/お早めに/ご注意を/注意を）
// ・転売相場・在庫状況の語（高騰/ヤフオク/メルカリ/転売/完売/再開/再販/値引/％オフ/品薄/即完/まだあり/人気…）
// ※商品タグ『「【 を含む節は商品名なので strongComment 扱いにしない（呼び出し側でガード）。
const STRONG_COMMENT_END =
  /(?:です|ます|ました|でした|かと|そうです?|ください|お(?:早|はや)めに?|ご注意を?|注意を?)[！!。]?$/;

/** 末尾のアクション告知（「〜が抽選受付開始！」）と、！で終わるコメント節を剥がす。 */
function stripTrailingActions(title: string): string {
  let s = title.trim();
  for (let i = 0; i < 4; i++) {
    const before = s;
    // (a) 「〜が抽選受付開始！」等の定型アクション句
    const a = s.replace(TRAILING_ACTION, "").trim();
    if (a.length >= 6) s = a;
    // (b) 末尾の！で終わるコメント節（コメント語を含み、商品らしさ無し）
    const m = s.match(/^(.*?)([^！!。]{2,30}[！!])\s*$/);
    if (m && COMMENTARY.test(m[2]) && !looksProduct(m[2]) && m[1].trim().length >= 6) {
      s = m[1].trim();
    }
    if (s === before) break;
  }
  return s;
}

// 末尾のアクション句（「予約開始！」等）を剥がすと、その手前の販売チャネル節だけが
// 助詞で宙ぶらりんに残る:「…完成品フィギュア【が】あみあみやDMMなど【で】」。
// 文が途中で切れて見えるのは、人間なら一瞬で気付く粗（実測21件が表示スコープに露出）。
// 「が」＋20字以内＋「で/へ」で終わる末尾＝販売店の告知節なので、まとめて落として商品名で終える。
// 商品名側は落とさない（切るのは必ず「が」以降で、残りが6字未満なら諦めて原文のまま）。
const DANGLING_CHANNEL_TAIL = /\s*が[^\s　]{0,20}[でへ]$/;

function stripDanglingChannelTail(title: string): string {
  const t = title.replace(DANGLING_CHANNEL_TAIL, "").trim();
  return t.length >= 6 ? t : title;
}

/** 末尾側の実況コメント（全角スペース以降がコメント語主体）を剥がす */
function stripTrailingCommentary(title: string): string {
  const parts = title.split("　");
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    const looksProduct = /[A-Za-z0-9]/.test(last) || /[ァ-ヶ]{4,}/.test(last);
    if (COMMENTARY.test(last) && !looksProduct) {
      parts.pop();
    } else {
      break;
    }
  }
  return parts.join("　");
}

/** 一覧カード表示用にタイトルを整形（非破壊・失敗時は原文）。 */
export function cleanListTitle(source: string, title: string): string {
  // まず全ソース共通で情報元由来の定型ラベル（snkrdunkの「｜…」）と、末尾の日付告知
  // （コラボ記事の「〜8月6日よりコラボ開催!」等）を剥がす。後者は eventDate/eventType
  // バッジと重複するノイズで、告知型でないタイトルには誤爆しないことを検証済み。
  const base = stripDateNoticeTail(stripSourceLabel(title));
  if (!CLEANABLE_SOURCES.has(source)) return base;
  const raw = base.trim();

  // 1) rarecheck は『商品名』が定型なので、『』の中を最も信頼できる商品名として採用。
  if (source === "rarecheck") {
    const bracketed = firstBracketed(raw);
    if (bracketed) return bracketed;
  }

  // 2) 節に割って商品名の節だけを選ぶ（実況本文のどこに商品名があっても採れる）。
  //    ※ 以前はここに「【特典】等の商品タグ以降を丸ごと採る」近道があったが、タグ以降に
  //      続く感想文（「B2タペストリーがついてない分かなり価格が抑えられてるほうです！」）まで
  //      連れてきてしまい、節判定が正しくても表示が汚れていた。節選択に一本化する。
  const picked = pickProductBlock(raw);
  let t = picked ?? raw;

  // 3) 選んだブロックの端に残る告知（「〜が抽選受付開始！」「…があみあみやDMMなどで」）を落とす。
  t = stripTrailingCommentary(t);
  t = stripTrailingActions(t);
  t = stripDanglingChannelTail(t);
  t = trimSegNoise(t);
  t = t.trim();

  // 5) 削りすぎ・空は原文に戻す（安全側）。
  return t.length >= 6 ? t : raw;
}
