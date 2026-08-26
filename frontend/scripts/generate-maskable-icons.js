const sharp = require("sharp");
const path = require("path");

(async () => {
  const mark = path.join("public", "branding", "icon-mark.png");
  for (const size of [192, 512]) {
    const pad = Math.round(size * 0.12);
    const inner = size - pad * 2;
    const innerBuf = await sharp(mark).resize(inner, inner).png().toBuffer();
    const out = path.join("public", "branding", `icon-maskable-${size}.png`);
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([{ input: innerBuf, left: pad, top: pad }])
      .png()
      .toFile(out);
    console.log("wrote", out);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
