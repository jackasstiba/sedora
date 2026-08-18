const url = "https://www.c-labo.jp/wordpress/wp-content/uploads/2026/08/psjuMo39.png";
const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
const buf = Buffer.from(await res.arrayBuffer());
console.log("status", res.status, "bytes", buf.length, "type", res.headers.get("content-type"));
// PNG: 8バイトsig + IHDR(幅/高さ)
if (buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
  console.log("PNG", buf.readUInt32BE(16), "x", buf.readUInt32BE(20));
} else if (buf[0] === 0xff && buf[1] === 0xd8) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      console.log("JPEG", buf.readUInt16BE(i + 7), "x", buf.readUInt16BE(i + 5));
      break;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
}
