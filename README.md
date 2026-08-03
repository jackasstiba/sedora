# ハツコレ

**🌐 公開サイト: https://sedora-three.vercel.app/**

レア・限定品の**予約・発売・抽選スケジュール**を各所から自動収集してまとめる情報サイトです。フィギュア・トレカ・スニーカー・一番くじ・コラボグッズなどのコレクター向けアイテムを、発売日・予約開始・抽選応募の締切とあわせて一覧できます。

## 主な機能

- **予約／発売／抽選カレンダー**: 複数ソースから自動収集した最新の発売・予約・抽選情報を日付順に表示
- **ジャンル別ページ**: [フィギュア](https://sedora-three.vercel.app/genre/%E3%83%95%E3%82%A3%E3%82%AE%E3%83%A5%E3%82%A2) / [トレカ](https://sedora-three.vercel.app/genre/%E3%83%88%E3%83%AC%E3%82%AB) / [スニーカー](https://sedora-three.vercel.app/genre/%E3%82%B9%E3%83%8B%E3%83%BC%E3%82%AB%E3%83%BC) / 一番くじ / コラボ / ポケモン
- **カードゲーム別ページ**: [ポケカ](https://sedora-three.vercel.app/tcg/%E3%83%9D%E3%82%B1%E3%82%AB)・ワンピースカード・遊戯王 などタイトル別に絞り込み
- **相場（中古）表示**・**速報（いま買える）ビュー**・**RSS配信**（`/feed.xml`）

## 技術構成

- Next.js (App Router, TypeScript) + Tailwind CSS
- Prisma + Turso (libSQL) / Cheerio によるスクレイピング
- Vercel でホスティング（`main` への push で自動デプロイ）

## 開発

```bash
npm install
npm run dev      # 開発サーバー (http://localhost:3000)
npm run scrape   # 全ソースを収集して DB に upsert
npm run build    # 本番ビルド
```
