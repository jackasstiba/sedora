import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const W = 1500, H = 500;
const FONT = "Yu Gothic UI,Meiryo,Noto Sans JP,sans-serif";
const SPARK = 'M16 3.5c1 7.6 3.9 10.5 11.5 11.5C19.9 16 17 18.9 16 26.5 15 18.9 12.1 16 4.5 15 12.1 14 15 11.1 16 3.5Z';

// Xのアイコンはヘッダー左下に重なる。1500x500換算での実測相当値
const AV = { cx: 133, cy: 497, r: 103 };

const spark = (x, y, size, fill, op) =>
  `<g transform="translate(${x - size / 2},${y - size / 2}) scale(${size / 32})" opacity="${op}"><path d="${SPARK}" fill="${fill}"/></g>`;

// 文言: 更新頻度は約束しない（更新は手動のため「自動で最新」と言ってはいけない）
const TITLE = 'ハツコレ';
const TAGLINE = 'レア・限定品の 予約 / 抽選 / 発売 を一画面に。';
const GENRES = 'フィギュア・トレカ・スニーカー・一番くじ・コラボグッズ';
const URL = 'hatsukore.com';

function header(theme) {
  const dark = theme === 'dark';
  const accent = dark ? 'url(#ac)' : '#fff';
  const ring = dark ? '#ff8a5c' : '#fff';
  const titleFill = '#fff';
  const tagFill = dark ? '#ece2dc' : '#fff';
  const genreFill = dark ? '#b9a89e' : '#ffe3d6';
  const urlFill = dark ? '#ff8a5c' : '#fff';

  const bg = dark
    ? `<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>`
    : `<rect width="${W}" height="${H}" fill="url(#ac)"/>`;

  const rings = [200, 310, 430, 560]
    .map((r, i) => `<circle cx="${AV.cx}" cy="${AV.cy}" r="${r}" fill="none" stroke="${ring}" stroke-width="${2.5 - i * 0.3}" opacity="${(dark ? 0.26 : 0.30) - i * 0.05}"/>`)
    .join('');

  const sparks =
    spark(1188, 118, 50, ring, dark ? 0.28 : 0.34) +
    spark(1348, 322, 30, ring, dark ? 0.22 : 0.28) +
    spark(1066, 392, 21, ring, dark ? 0.18 : 0.24) +
    spark(880, 96, 24, ring, dark ? 0.16 : 0.22);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="ac" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff8a5c"/><stop offset="1" stop-color="#ef5322"/>
    </linearGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#241c19"/><stop offset="1" stop-color="#14100e"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.09" cy="1" r="0.8">
      <stop offset="0" stop-color="#ef5322" stop-opacity="0.40"/>
      <stop offset="1" stop-color="#ef5322" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${bg}
  ${rings}
  ${sparks}
  <rect x="330" y="140" width="8" height="210" rx="4" fill="${accent}"/>
  <text x="360" y="217" font-family="${FONT}" font-size="92" font-weight="bold" fill="${titleFill}" letter-spacing="2">${TITLE}</text>
  <text x="362" y="286" font-family="${FONT}" font-size="34" fill="${tagFill}">${TAGLINE}</text>
  <text x="362" y="336" font-family="${FONT}" font-size="26" letter-spacing="1.2" fill="${genreFill}">${GENRES}</text>
  <text x="1450" y="428" font-family="${FONT}" font-size="30" font-weight="bold" fill="${urlFill}" text-anchor="end" opacity="0.92">${URL}</text>
</svg>`;
}

// アイコンを実位置に重ねたプレビュー（本番の見え方を確認するため。アップロードするのは header 単体）
function preview(theme) {
  const avaDark = theme === 'light'; // ダークヘッダー→オレンジicon A / オレンジヘッダー→ダークicon C
  const inner = avaDark
    ? `<rect x="0" y="0" width="32" height="32" fill="#1c1917"/><path d="${SPARK}" fill="url(#ac)"/>`
    : `<rect x="0" y="0" width="32" height="32" fill="url(#ac)"/><path d="${SPARK}" fill="#fff"/>`;
  return header(theme).replace('</svg>', `
  <circle cx="${AV.cx}" cy="${AV.cy}" r="${AV.r + 7}" fill="${theme === 'dark' ? '#14100e' : '#fff'}"/>
  <clipPath id="avc"><circle cx="${AV.cx}" cy="${AV.cy}" r="${AV.r}"/></clipPath>
  <g clip-path="url(#avc)"><g transform="translate(${AV.cx - AV.r},${AV.cy - AV.r}) scale(${(AV.r * 2) / 32})">${inner}</g></g>
</svg>`);
}

for (const theme of ['dark', 'light']) {
  const name = theme === 'dark' ? 'dark' : 'orange';
  writeFileSync(`brand/x/hatsukore-header-${name}.svg`, header(theme));
  await sharp(Buffer.from(header(theme)), { density: 300 }).resize(W, H).png().toFile(`brand/x/hatsukore-header-${name}.png`);
  await sharp(Buffer.from(preview(theme)), { density: 300 }).resize(W, H).png().toFile(`brand/x/_header-preview-${name}.png`);
}
console.log('headers done');
