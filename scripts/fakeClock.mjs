// 壁時計を固定するための preload（`npm run audit:clock` 専用）。
//
// なぜ要るか: 2026-08-16 の日付事故は「日本時間 09:00 より前に巡回した回だけ」出る型だった。
// 昼に手で動かしても再現しないので、テストで**時刻そのものを動かす**しかない。
// Date.now() と 引数なし new Date() を差し替え、同じ日本時間の日を色々な時刻・TZで再現する。
//
// 本番・通常のスクリプトでは読み込まれない（package.json の audit:clock からだけ）。
const RealDate = Date;
let fakeNow = Date.parse(process.env.HATSUKORE_FAKE_NOW ?? "");
if (Number.isNaN(fakeNow)) {
  throw new Error("HATSUKORE_FAKE_NOW に ISO8601 の時刻を渡すこと（例 2026-08-15T21:39:06Z）");
}

class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(fakeNow);
    else super(...args);
  }
  static now() {
    return fakeNow;
  }
}
globalThis.Date = FakeDate;
globalThis.__setFakeNow = (ms) => {
  fakeNow = ms;
};
globalThis.__getFakeNow = () => fakeNow;
