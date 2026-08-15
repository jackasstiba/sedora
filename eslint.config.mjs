import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // 時計を読む行は src/lib/date.ts だけ（2026-08-16 ミス24の再発防止）。
  //
  // 同じ規約は `npm run audit` の clock_discipline でも見ているが、audit はデータ更新の
  // 関門にしか入っていない。**push の関門（.githooks/pre-push → npm run verify → lint）**にも
  // 置いて、コードだけ直して push する経路でも落ちるようにする。
  // 「1箇所でしか見ていない検査」は、その経路を通らない日に素通りする。
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    ignores: ["src/lib/date.ts", "src/lib/clockLint.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            "壁時計を直接読まない。日本時間の暦日は todayJst()、瞬間は nowInstant()（src/lib/date.ts）を使う。2026-08-16 の日付事故（締切が1日早い／商品が全一覧から消える）はこれが原因。",
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            "壁時計を直接読まない。日本時間の暦日は todayJst()、瞬間は nowInstant()（src/lib/date.ts）を使う。",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds)$/]",
          message:
            "ローカル時刻のゲッターは実行環境のTZで日付が変わる。暦日は UTC 0時で保存する規約なので getUTC*() を使う。",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(setFullYear|setMonth|setDate|setHours|setMinutes|setSeconds)$/]",
          message: "ローカル時刻のセッターは使わない。暦日の加減算は Date.UTC / ミリ秒で行う。",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length>1]",
          message:
            "new Date(年, 月, 日) はローカル0時を作る（UTCで動く本番と1日ズレる）。暦日は new Date(Date.UTC(...)) で作る。",
        },
        {
          selector: "CallExpression[callee.property.name=/^(toLocaleDateString|toLocaleTimeString)$/]",
          message:
            "TZを指定しない日時整形は実行環境のTZで日付が変わる。date.ts の formatShort/formatLong/formatDateTimeJst を使う。",
        },
      ],
    },
  },
]);

export default eslintConfig;
