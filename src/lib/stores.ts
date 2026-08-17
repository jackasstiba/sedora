// 家電・ゲーム機など「複数の小売が同時に抽選/予約応募を実施する」商品の、
// 現在“受付中”の公式ストア一覧（Item.stores JSON列）を安全にパースする純関数。
// 各エントリは一次ソース（各小売の抽選ページ）へ直リンクし、アグリゲーターは表に出さない。

export type StoreEntry = {
  name: string; // 小売名（例: "Amazon"）／コラボの会場名（例: "【東京/原宿】原宿店"）
  // その小売の公式・抽選/応募ページ、またはコラボ会場の地図。**無いことがある**:
  // 23店舗同時開催のように会場が複数あると、収集元の地図リンクは1つしか無く
  // どの店のものか特定できない。持っていないURLを紐づけない（誤った場所へ案内しない）。
  url: string | null;
  form: string | null; // 販売形式（"抽選販売" 等）／コラボは都道府県（書いてある時だけ）
  // 受付・開始・締切の表示用テキスト（例: "9/5 17:00〜", "〜8/10"）。
  // **必ず絶対表記で保存する**（「〜明日 23:59」のような相対表記を保存しない）。
  // 理由は下の storeWhenLabel を参照＝保存した瞬間から日ごとに嘘になるため。
  when: string | null;
  note: string | null; // 応募条件（購入履歴・会員登録など＝当落を左右する“せどりの肝”）
  /** when が指す暦日（"YYYY-MM-DD"）。分かっているときだけ。表示側の「本日/明日」はここから作る。 */
  at?: string | null;
  /** at が締切なのか受付開始なのか。開始日が未来なら「受付前」と正直に書くために要る。 */
  kind?: "締切" | "開始" | null;
};

/**
 * 表示用のラベル（店名＋形式＋受付時刻）でまとめる。
 *
 * 同じ小売が**別々の応募ページを複数開く**ことがある（実測: お宝創庫が同時刻に2口、
 * サントリー公式が山崎と白州で別ページ）。データとしては別物だが、そのまま並べると
 * 「お宝創庫・プレイズ（8/6 12:00〜）、お宝創庫・プレイズ（8/6 12:00〜）」と
 * **同じ文字列が2回並ぶだけ**で、読む側には区別がつかない（人間なら一瞬で気付く粗）。
 * ラベルが同じものは1つにまとめ、口数を添えて事実として区別できるようにする。
 */
export type StoreGroup = { label: string; entries: StoreEntry[] };

/**
 * stores 節の文言。何の一覧なのかはソースで決まる:
 *  ・nyuka_now  … 家電/ゲーム機の抽選・予約を受け付けている**小売の応募ページ**
 *  ・collabo_cafe … コラボ/ポップアップ/カフェの**開催店舗**（会場限定なので行く場所が本体）
 * 同じ見出し「抽選・予約 受付中ストア」をコラボに出すと、応募すれば買えるように読める。
 * ラベルは中身に合わせる（[[UIラベルは裏取り済みのみ約束]]）。
 */
export function storeSectionCopy(source: string): {
  heading: string;
  note: string;
  button: string;
} {
  if (source === "collabo_cafe")
    return {
      heading: "📍 開催店舗",
      note: "会場限定の販売です。営業時間・混雑・取り置きの可否は各店舗/公式ページでご確認ください。",
      button: "地図 →",
    };
  return {
    heading: "🎯 抽選・予約 受付中ストア",
    note: "現在応募・予約を受付中のストアです。応募条件（購入履歴・会員登録など）・在庫・締切は各公式ページでご確認ください。",
    button: "応募ページ →",
  };
}

export function groupStoresByLabel(stores: StoreEntry[]): StoreGroup[] {
  const groups = new Map<string, StoreGroup>();
  for (const s of stores) {
    const label = `${s.name}|${s.form ?? ""}|${s.when ?? ""}`;
    const g = groups.get(label) ?? { label, entries: [] };
    g.entries.push(s);
    groups.set(label, g);
  }
  return [...groups.values()];
}

/**
 * 受付時刻の表示ラベル。**相対表記（本日/明日）はここでしか作らない。**
 *
 * 2026-08-16 実測の事故: 収集元の「締切 明日 22:00」をそのまま `when` に保存していたため、
 * 巡回した日から1日でも経つと画面の「〜明日 22:00」が丸ごと1日ズレた。しかもハツコレは
 * 手動更新なので、更新しない限りズレは増え続ける。同じ商品ページの上部が「抽選日 8/16 🔥本日」、
 * 下の店舗行が「〜明日 22:00」と**1画面の中で食い違って**いた。締切は「今から間に合うか」を
 * 決める値で、1日ズレたら応募を逃す＝サイトの存在意義に直結する。
 *
 * 対策の形: **保存する文字列は常に絶対表記**（"〜8/17 23:59"）にし、`at`（暦日）を併せて持つ。
 * 「本日/明日」は読んだ瞬間の today から作る＝保存物が古くなっても嘘にならない。
 * at を持たない行（他ソース・旧データ）は保存文字列をそのまま出す。
 */
export function storeWhenLabel(s: StoreEntry, today: Date): string | null {
  if (!s.when) return null;
  if (!s.at) return s.when;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.at);
  if (!m) return s.when;
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const days = Math.round((at - today.getTime()) / 86_400_000);
  const rel = days === 0 ? "本日" : days === 1 ? "明日" : null;
  let label = rel ? s.when.replace(/\d{1,2}\/\d{1,2}/, rel) : s.when;
  // 「受付中ストア」の一覧に、まだ始まっていない店が同じ顔で並んでいた（実測 2026-08-16:
  // 「おもちゃのペリカン（抽選・8/20 00:00〜）」が受付中として並ぶ）。事実で区別する。
  if (s.kind === "開始" && days > 0) label += "（受付前）";
  return label;
}

/** カード/一覧に出す短い要約（先頭 max 件＋「他N店」）。同一ラベルは「・N口」にまとめる。
 *  today を渡すとその日基準の相対表記（本日/明日）にする。**保存用に作るときは渡さない**
 *  （保存した相対表記は翌日から嘘になる＝storeWhenLabel のコメント参照）。 */
export function summarizeStores(stores: StoreEntry[], max = 3, today?: Date): string {
  const groups = groupStoresByLabel(stores);
  const head = groups
    .slice(0, max)
    .map((g) => {
      const s = g.entries[0];
      const parts = [s.form, today ? storeWhenLabel(s, today) : s.when].filter(Boolean);
      if (g.entries.length > 1) parts.push(`${g.entries.length}口`);
      return `${s.name}${parts.length ? `（${parts.join("・")}）` : ""}`;
    })
    .join("、");
  const rest = groups.length - Math.min(groups.length, max);
  return `${head}${rest > 0 ? ` 他${rest}店` : ""}`;
}

/**
 * 締切の暦日を持つ枠だけを取り出す。`at` を持たない枠（締切時刻が「調査中」・開催店舗など）は
 * 締切を知らないので判断材料にしない（知らないことを「終わった」と言わないため）。
 */
function datedDeadlines(stores: StoreEntry[]): { at: string }[] {
  return stores.filter((s): s is StoreEntry & { at: string } => s.kind === "締切" && !!s.at);
}

/**
 * 受付が生きている枠と、締切が過ぎた枠に分ける。
 *
 * 2026-08-18 実測（観点B＝せどらーとして実際に応募しようとして発見）: 商品詳細の
 * 「🎯 抽選・予約 受付中ストア（126店・応募ページ 126件）／現在応募・予約を受付中の
 * ストアです」の一覧に、**締切が昨日で終わった店が30店（絶対日付表記58件中30件）**
 * 混ざっていた。しかも並びは締切の昇順なので、**先頭30店がすべて死んでいる**状態で、
 * いちばん上から順に応募ページを開くという普通の使い方をすると全部空振りする。
 *
 * 2026-08-16 に直したのは *カードの要約*（liveStoreSummary）と *上部の抽選日*
 * （withLiveStoreDeadline）だけで、**詳細ページの一覧そのものは素通りしていた**
 * ＝同じ事故の「まだ直していなかった半分」。audit も audit:page も audit:facts も
 * ERROR 0 のまま黙っていた（どれも「受付中」という**見出しの約束**と、その下に並ぶ
 * 締切の**値**を突き合わせていなかった）。
 *
 * 判定の原則は datedDeadlines と同じ＝**締切の暦日を知っている枠だけを「終わった」と言う**。
 * 締切時刻が「調査中」の枠、受付開始待ちの枠（kind="開始"）、開催店舗（kind なし）は、
 * 知らないことを根拠に落とさない。
 */
export function splitStoresByDeadline(
  stores: StoreEntry[],
  today: Date
): { open: StoreEntry[]; closed: StoreEntry[] } {
  const open: StoreEntry[] = [];
  const closed: StoreEntry[] = [];
  for (const s of stores) {
    const past =
      s.kind === "締切" &&
      !!s.at &&
      new Date(`${s.at}T00:00:00.000Z`).getTime() < today.getTime();
    (past ? closed : open).push(s);
  }
  return { open, closed };
}

/**
 * **まだ締切前の枠のうち、いちばん早い締切**（＝この商品で今いちばん急ぐ日）。
 * 締切付きの枠が1つも無い／全部過ぎている場合は null。
 *
 * これが要る理由（2026-08-16 実測 = ミス23と同型の3例目）:
 * card_chusen は「店×商品」を1商品にまとめるので、1行が **143店・締切8/15〜8/26** のような
 * *幅* を持つ。ところが eventDate には巡回した日の「今日以降で最も近い締切」を**焼き付けて**
 * いたため、翌日にはその日付が過去になり `eventDate >= today` の表示スコープから商品ごと落ちた。
 * 実測: #75417（ONE PIECE OP-17）は **今日まだ締切前の店が102店**あるのに、トップ・/lottery・
 * /genre/トレカ・/tcg/ワンピースカード のどこにも出ていなかった（本番HTMLで確認）。
 * しかも症状は**更新直後だけ消える**ので、更新直後に走る audit では永久に見えなかった。
 *
 * 対策の形は storeWhenLabel と同じ＝**"今日"に依存する値をDBに凍結せず、読んだ瞬間に作る**。
 * DBの eventDate は「最後の締切（＝この商品がまだ有効な期限）」を持ち、画面に出す日付は
 * ここで today から作り直す。
 */
export function soonestOpenDeadline(stores: StoreEntry[], today: Date): Date | null {
  const open = datedDeadlines(stores)
    .map((s) => new Date(`${s.at}T00:00:00.000Z`))
    .filter((d) => d.getTime() >= today.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  return open[0] ?? null;
}

/** **最後の締切**（＝全店が締め切る日＝この商品を載せ続けてよい期限）。無ければ null。 */
export function lastDeadline(stores: StoreEntry[]): Date | null {
  const all = datedDeadlines(stores)
    .map((s) => new Date(`${s.at}T00:00:00.000Z`))
    .sort((a, b) => b.getTime() - a.getTime());
  return all[0] ?? null;
}

/** Item.stores（JSON配列文字列）を安全にパースする。壊れていれば null。 */
export function parseStoresJson(json: string | null | undefined): StoreEntry[] | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const rows = arr
      // url は任意（会場が複数のコラボは店舗名だけ）。name が無い行だけ捨てる。
      .filter((s) => s && typeof s.name === "string" && s.name.trim())
      .map(
        (s): StoreEntry => ({
          name: s.name,
          url: typeof s.url === "string" && s.url ? s.url : null,
          form: typeof s.form === "string" && s.form ? s.form : null,
          when: typeof s.when === "string" && s.when ? s.when : null,
          note: typeof s.note === "string" && s.note ? s.note : null,
          at: /^\d{4}-\d{2}-\d{2}$/.test(s.at) ? s.at : null,
          kind: s.kind === "締切" || s.kind === "開始" ? s.kind : null,
        })
      );
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}
