/**
 * 楽天アフィリンクが**本当に楽天の検索結果に着地するか**を実際に叩いて確かめる
 * （`npm run rakuten:verify`）。
 *
 * なぜ要るか: 楽天はアフィリリンクのURL仕様を公式に公開していない。手元にあるのは
 * 古い個人ブログの記述だけで、**形式が変わっていても画面上は何も壊れない**
 * （リンクは楽天のどこかに飛ぶので、押した人は気づかない＝成果だけが静かに落ちる）。
 * 目視で確認できない型なので、機械で着地まで追う。
 *
 * 確かめること:
 *   1. IDが未設定/形違いのとき、素の検索URLに落ちる（＝リンクは必ず生きている）
 *   2. IDがあるとき、アフィリのドメインが 3xx を返して転送する
 *   3. 転送の行き先が search.rakuten.co.jp で、**検索語が保たれている**
 *      （キーワードが落ちると「関係ない商品一覧」に着地する＝成果に繋がらない）
 */
import { isRakutenAffiliateId, rakutenSearchRawUrl, rakutenSearchUrl } from "../src/lib/outbound";

const SAMPLE = "ONE PIECE カードゲーム ブースターパック";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

let failed = false;
function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function ng(msg: string) {
  failed = true;
  console.log(`  ✗ ${msg}`);
}

/** リダイレクトを手で辿る（最大5回）。途中経過を全部返す。 */
async function follow(url: string, max = 5): Promise<string[]> {
  const chain = [url];
  let current = url;
  for (let i = 0; i < max; i++) {
    const res = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": UA },
    });
    const loc = res.headers.get("location");
    console.log(`     ${res.status} ${current.slice(0, 110)}`);
    if (!loc) break;
    current = new URL(loc, current).toString();
    chain.push(current);
  }
  return chain;
}

async function main() {
  const id = (process.env.RAKUTEN_AFFILIATE_ID ?? "").trim();
  console.log("=== 楽天アフィリンク検証 ===");

  // 1. 未設定/形違いは素のURLに落ちること（IDが無くても必ず通る検査）
  if (rakutenSearchUrl(SAMPLE, "") === rakutenSearchRawUrl(SAMPLE)) {
    ok("IDが無いときは素の検索URLに落ちる");
  } else {
    ng("IDが無いのにアフィリURLを作っている");
  }
  if (rakutenSearchUrl(SAMPLE, "こわれたID") === rakutenSearchRawUrl(SAMPLE)) {
    ok("形が違うIDは使わずに素の検索URLへ落ちる");
  } else {
    ng("形が違うIDでアフィリURLを作っている（成果が付かないリンクになる）");
  }

  if (!id) {
    console.log(
      "\n  RAKUTEN_AFFILIATE_ID が未設定なので、ここで止める。" +
        "\n  取得したら .env に入れて再実行すること（本番反映は Vercel の環境変数）。"
    );
    process.exit(failed ? 1 : 0);
  }

  if (isRakutenAffiliateId(id)) ok(`IDの形は妥当: ${id.slice(0, 4)}…（伏せて表示）`);
  else {
    ng(`IDの形が想定外: ${id.slice(0, 4)}… ／ ドット区切りの英数4ブロックを想定`);
    process.exit(1);
  }

  // 2〜3. 実際に叩いて着地を見る
  console.log("\n  アフィリ経由の着地を追う:");
  const chain = await follow(rakutenSearchUrl(SAMPLE, id));
  const last = chain[chain.length - 1];
  if (chain.length > 1) ok(`転送された（${chain.length - 1}回）`);
  else ng("転送されなかった（アフィリのURL形式が今の仕様と違う可能性）");

  const host = new URL(last).hostname;
  if (host.endsWith("rakuten.co.jp")) ok(`着地は楽天ドメイン: ${host}`);
  else ng(`着地が楽天ではない: ${host}`);

  // 検索語が保たれているか。エンコードされたままの場合もあるので両方で見る。
  const decoded = decodeURIComponent(last);
  const keyword = SAMPLE.split(" ")[0];
  if (decoded.includes(keyword)) ok(`検索語が保たれている（"${keyword}" を含む）`);
  else ng(`着地URLから検索語が消えている → 関係ない一覧に飛んでいる: ${last.slice(0, 140)}`);

  console.log(failed ? "\n結果: NG（本番に出さないこと）" : "\n結果: OK");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
