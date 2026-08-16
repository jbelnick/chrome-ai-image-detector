import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { scanJpegSocial, SOCIAL_JPEG } from "../src/jpeg-social.js";

async function jpegBytes({ width, height, quality }) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 92, g: 104, b: 118 },
    },
  })
    .jpeg({ quality, chromaSubsampling: "4:2:0" })
    .toBuffer();
}

describe("jpeg-social", () => {
  it("flags q=65 max-side-720 as social recompress and misses q=88 large JPEGs", async () => {
    const social = scanJpegSocial(await jpegBytes({ width: 720, height: 480, quality: 65 }));
    assert.equal(social.jpeg, true);
    assert.equal(social.socialRecompress, true);
    assert.ok(social.quality >= SOCIAL_JPEG.qualityMin);
    assert.ok(social.quality <= SOCIAL_JPEG.qualityMax);

    const official = scanJpegSocial(await jpegBytes({ width: 1024, height: 768, quality: 88 }));
    assert.equal(official.socialRecompress, false);

    const redditQ = scanJpegSocial(await jpegBytes({ width: 640, height: 480, quality: 82 }));
    assert.equal(redditQ.socialRecompress, false);
  });

  it("does not treat a non-JPEG buffer as social recompress", () => {
    const png = scanJpegSocial(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.socialRecompress, false);
  });
});
