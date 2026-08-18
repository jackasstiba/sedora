import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

// リンクカード用のOG画像（1200x630）。Next の file convention に合わせて
// src/app/opengraph-image.png に出力すると、og:image が全ルートに自動で付く。
// 絵作りはXのヘッダー（brand/x/build-header.mjs）と揃える＝どこで見ても同じ顔にする。

const W = 1200, H = 630;
const FONT = "Yu Gothic UI,Meiryo,Noto Sans JP,sans-serif";
const SPARK = 'M16 3.5c1 7.6 3.9 10.5 11.5 11.5C19.9 16 17 18.9 16 26.5 15 18.9 12.1 16 4.5 15 12.1 14 15 11.1 16 3.5Z';

const spark = (x, y, size, fill, op) =>
  `<g transform="translate(${x - size / 2},${y - size / 2}) scale(${size / 32})" opacity="${op}"><path d="${SPARK}" fill="${fill}"/></g>`;

// 文言は「逃すと買えない」側だけ。相場・利益は出さない（ハツコレの立ち位置）。
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="ac" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff8a5c"/><stop offset="1" stop-color="#ef5322"/>
    </linearGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#241c19"/><stop offset="1" stop-color="#14100e"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.05" cy="1" r="0.85">
      <stop offset="0" stop-color="#ef5322" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#ef5322" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  ${[260, 400, 560, 720].map((r, i) =>
    `<circle cx="60" cy="${H}" r="${r}" fill="none" stroke="#ff8a5c" stroke-width="${2.6 - i * 0.3}" opacity="${0.24 - i * 0.045}"/>`).join('')}

  ${spark(1035, 118, 58, '#ff8a5c', 0.26)}
  ${spark(1120, 330, 32, '#ff8a5c', 0.20)}
  ${spark(950, 452, 22, '#ff8a5c', 0.16)}

  <g transform="translate(90,255)"><g transform="scale(${120 / 32})"><path d="${SPARK}" fill="url(#ac)"/></g></g>

  <text x="258" y="336" font-family="${FONT}" font-size="100" font-weight="bold" fill="#fff" letter-spacing="2">ハツコレ</text>
  <text x="260" y="404" font-family="${FONT}" font-size="38" fill="#ece2dc">レア・限定品の 予約 / 抽選 / 発売 を一画面に。</text>
  <text x="260" y="458" font-family="${FONT}" font-size="27" letter-spacing="1.2" fill="#b9a89e">フィギュア・トレカ・スニーカー・一番くじ・コラボグッズ</text>
  <text x="260" y="548" font-family="${FONT}" font-size="32" font-weight="bold" fill="#ff8a5c" opacity="0.95">hatsukore.com</text>
</svg>`;

writeFileSync('brand/opengraph-image.svg', svg);
await sharp(Buffer.from(svg), { density: 300 }).resize(W, H).png().toFile('src/app/opengraph-image.png');
console.log('og image written to src/app/opengraph-image.png');
