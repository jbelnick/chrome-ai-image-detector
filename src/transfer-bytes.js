/**
 * JSON-safe image payloads for chrome.runtime.sendMessage.
 * MV3 still JSON-serializes messages unless Chrome 148+ structured clone
 * is declared, and JSON.stringify({ buffer: new ArrayBuffer(n) }) is "{}".
 */

const TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  let i = 0;
  for (; i + 2 < u8.length; i += 3) {
    const n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
    out += TABLE[(n >> 18) & 63] + TABLE[(n >> 12) & 63] + TABLE[(n >> 6) & 63] + TABLE[n & 63];
  }
  const rem = u8.length - i;
  if (rem === 1) {
    const n = u8[i] << 16;
    out += TABLE[(n >> 18) & 63] + TABLE[(n >> 12) & 63] + "==";
  } else if (rem === 2) {
    const n = (u8[i] << 16) | (u8[i + 1] << 8);
    out += TABLE[(n >> 18) & 63] + TABLE[(n >> 12) & 63] + TABLE[(n >> 6) & 63] + "=";
  }
  return out;
}

export function base64ToBytes(b64) {
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new Error("missing image bytes");
  }
  const clean = b64.replace(/\s+/g, "");
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const len = Math.floor((clean.length * 3) / 4) - pad;
  const out = new Uint8Array(len);
  const lut = new Uint8Array(256);
  for (let i = 0; i < TABLE.length; i += 1) lut[TABLE.charCodeAt(i)] = i;
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (lut[clean.charCodeAt(i)] << 18) |
      (lut[clean.charCodeAt(i + 1)] << 12) |
      (lut[clean.charCodeAt(i + 2)] << 6) |
      lut[clean.charCodeAt(i + 3)];
    if (o < len) out[o++] = (n >> 16) & 255;
    if (o < len) out[o++] = (n >> 8) & 255;
    if (o < len) out[o++] = n & 255;
  }
  return out;
}
