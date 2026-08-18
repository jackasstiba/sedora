import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const GRAD = (id) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ff8a5c"/><stop offset="1" stop-color="#ef5322"/>
  </linearGradient>`;

// favicon と同じキラリ（32x32座標系）
const SPARK = 'M16 3.5c1 7.6 3.9 10.5 11.5 11.5C19.9 16 17 18.9 16 26.5 15 18.9 12.1 16 4.5 15 12.1 14 15 11.1 16 3.5Z';

// 各案の中身（0..32 座標系・背景込み）。id接尾辞でグラデを一意化する
const variants = {
  a: (s) => `<defs>${GRAD('g'+s)}</defs>
    <rect width="32" height="32" fill="url(#g${s})"/>
    <path d="${SPARK}" fill="#fff"/>`,

  b: (s) => `<defs>${GRAD('g'+s)}</defs>
    <rect width="32" height="32" fill="url(#g${s})"/>
    <circle cx="16" cy="16" r="10.8" fill="none" stroke="#fff" stroke-width="0.55" opacity="0.30"/>
    <circle cx="16" cy="16" r="13.6" fill="none" stroke="#fff" stroke-width="0.45" opacity="0.17"/>
    <g transform="translate(16,16) scale(0.72) translate(-16,-16)"><path d="${SPARK}" fill="#fff"/></g>`,

  c: (s) => `<defs>${GRAD('g'+s)}</defs>
    <rect width="32" height="32" fill="#1c1917"/>
    <circle cx="16" cy="16" r="13.2" fill="none" stroke="url(#g${s})" stroke-width="0.5" opacity="0.45"/>
    <path d="${SPARK}" fill="url(#g${s})"/>`,
};

const svg = (key) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="400" height="400">${variants[key](key)}</svg>`;

for (const key of Object.keys(variants)) {
  const src = svg(key);
  writeFileSync(`brand/x/hatsukore-x-${key}.svg`, src);
  await sharp(Buffer.from(src), { density: 600 })
    .resize(400, 400)
    .png()
    .toFile(`brand/x/hatsukore-x-${key}.png`);
}
console.log('variants done');

// ---- 比較シート（円クロップ＋タイムライン実寸）----
const place = (key, x, y, size, sfx) =>
  `<g clip-path="url(#clip-${sfx})"><g transform="translate(${x},${y}) scale(${size / 32})">${variants[key](sfx)}</g></g>`;
const clip = (x, y, size, sfx) =>
  `<clipPath id="clip-${sfx}"><circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}"/></clipPath>`;

const keys = ['a', 'b', 'c'];
const bigX = [90, 420, 750], bigY = 60, bigS = 240;
let defs = '', body = '';
keys.forEach((k, i) => {
  const sfx = `L${k}`;
  defs += clip(bigX[i], bigY, bigS, sfx);
  body += place(k, bigX[i], bigY, bigS, sfx);
  body += `<text x="${bigX[i] + bigS / 2}" y="${bigY + bigS + 42}" font-family="Arial,sans-serif" font-size="30" font-weight="bold" fill="#1c1917" text-anchor="middle">${k.toUpperCase()}</text>`;
});

// 小サイズ帯：白背景（ライトモード）と #15202b（ダークモード）
const bands = [
  { y: 400, bg: '#ffffff', fg: '#57534e', label: 'timeline / light' },
  { y: 520, bg: '#15202b', fg: '#8b98a5', label: 'timeline / dark' },
];
for (const band of bands) {
  body += `<rect x="0" y="${band.y}" width="1080" height="120" fill="${band.bg}"/>`;
  body += `<text x="40" y="${band.y + 30}" font-family="Arial,sans-serif" font-size="17" fill="${band.fg}">${band.label}</text>`;
  keys.forEach((k, i) => {
    [48, 32].forEach((sz, j) => {
      const x = bigX[i] + 40 + j * 90, y = band.y + 34;
      const sfx = `${k}${band.y}${sz}`;
      defs += clip(x, y, sz, sfx);
      body += place(k, x, y, sz, sfx);
      body += `<text x="${x + sz / 2}" y="${y + sz + 20}" font-family="Arial,sans-serif" font-size="13" fill="${band.fg}" text-anchor="middle">${sz}px</text>`;
    });
  });
}

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 640" width="1080" height="640">
  <defs>${defs}</defs>
  <rect width="1080" height="640" fill="#ffffff"/>
  ${body}
</svg>`;
writeFileSync('brand/x/_compare.svg', sheet);
await sharp(Buffer.from(sheet), { density: 300 }).png().toFile('brand/x/_compare.png');
console.log('sheet done');
