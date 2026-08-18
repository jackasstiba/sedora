/** 一時: 「応募先ページから借りた画像」が表示中に何件あるかを数える。 */
import { loadDisplayedItems } from "../src/lib/pages";
import { parseStoresJson } from "../src/lib/stores";
import { productUrlKey } from "../src/lib/itemFilter";

const host = (u: string | null | undefined) => {
  try { return u ? new URL(u).hostname.replace(/^www\./, "") : null; } catch { return null; }
};

async function main() {
  const rows = await loadDisplayedItems();
  let withStores = 0, fromStoreHost = 0, fromNonProductStore = 0;
  const samples: string[] = [];
  for (const r of rows) {
    const stores = r.stores ? parseStoresJson(r.stores) : null;
    if (!stores || !r.imageUrl) continue;
    withStores++;
    const ih = host(r.imageUrl);
    const hit = stores.find((s) => s.url && host(s.url) === ih);
    if (!hit) continue;
    fromStoreHost++;
    const isProductPage = !!productUrlKey(hit.url);
    if (isProductPage) continue;
    fromNonProductStore++;
    if (samples.length < 12)
      samples.push(`#${r.id} [${r.source}] ${r.title.slice(0, 42)}\n     img=${r.imageUrl}\n     店=${hit.name} ${hit.url}`);
  }
  console.log(`表示中で stores と画像を持つ行: ${withStores}件`);
  console.log(`うち画像の出どころが応募先と同じホスト: ${fromStoreHost}件`);
  console.log(`うち応募先が商品ページでない（＝店の告知バナー疑い）: ${fromNonProductStore}件`);
  console.log(samples.join("\n"));
}
main();
