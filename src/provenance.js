/**
 * Byte-level provenance scan. High-precision short-circuit only —
 * never a substitute for the visual model, and never a hash lookup.
 */

const AI_ASCII = [
  "c2pa",
  "c2pa.org",
  "claim.sig",
  "jumbf",
  "trainedalgorithmicmedia",
  "compositewithtrainedalgorithmicmedia",
  "stable diffusion",
  "stablediffusion",
  "stable-diffusion",
  "comfyui",
  "automatic1111",
  "automatic 1111",
  "novelai",
  "midjourney",
  "dall-e",
  "dall·e",
  "adobe firefly",
  "dreamstudio",
  "leonardo.ai",
  "leonardoai",
  "ideogram",
  "flux.1",
  "flux1",
  "black forest labs",
  "runwayml",
  "invokeai",
  "fooocus",
  "sdxl",
  "this image was generated",
  "ai generated",
  "ai-generated",
  "synthetic media",
  "digital source type",
];

const CAMERA_MAKES = [
  "canon",
  "nikon",
  "sony",
  "fujifilm",
  "panasonic",
  "leica",
  "olympus",
  "om digital",
  "hasselblad",
  "pentax",
  "ricoh",
  "kodak",
  "phase one",
  "apple",
  "samsung",
  "google",
  "huawei",
  "xiaomi",
  "oneplus",
  "dji",
];

function bytesToAsciiHaystack(bytes) {
  const max = Math.min(bytes.length, 2_000_000);
  let out = "";
  for (let i = 0; i < max; i += 1) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) {
      out += String.fromCharCode(b);
    } else {
      out += " ";
    }
  }
  return out.toLowerCase();
}

/**
 * JPEG APP0–APP15 + COM only. Compressed entropy after SOS is not
 * provenance — short tokens like "sdxl" collide there on real photos.
 */
function jpegMetadataBytes(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const chunks = [];
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x00 || marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      i += 2;
      continue;
    }
    if (i + 4 > bytes.length) break;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const start = i + 4;
    const end = Math.min(bytes.length, start + Math.max(0, len - 2));
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      chunks.push(bytes.subarray(start, end));
    }
    i = start + Math.max(0, len - 2);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function hasPngTextChunk(bytes, needle) {
  // PNG: 8-byte signature, then chunks: len(4) type(4) data len crc(4)
  if (bytes.length < 16) return false;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== sig[i]) return false;
  }
  let offset = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    if (type === "tEXt" || type === "iTXt" || type === "zTXt" || type === "eXIf") {
      let chunk = "";
      for (let i = dataStart; i < dataEnd; i += 1) {
        const b = bytes[i];
        if (b >= 32 && b <= 126) chunk += String.fromCharCode(b);
        else chunk += " ";
      }
      if (chunk.toLowerCase().includes(needle)) return true;
    }
    offset = dataEnd + 4;
  }
  return false;
}

export function scanProvenance(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const jpegMeta = jpegMetadataBytes(bytes);
  const scanBytes = jpegMeta || bytes;
  const haystack = bytesToAsciiHaystack(scanBytes);
  const signals = [];

  for (const marker of AI_ASCII) {
    if (haystack.includes(marker) || hasPngTextChunk(bytes, marker)) {
      signals.push(marker);
    }
  }

  // C2PA / JUMBF box type often appears as binary "jumb" / "c2pa"
  const c2paBinary = indexOfBytes(scanBytes, [0x63, 0x32, 0x70, 0x61]); // c2pa
  const jumbBinary = indexOfBytes(scanBytes, [0x6a, 0x75, 0x6d, 0x62]); // jumb
  if (c2paBinary >= 0) signals.push("c2pa-box");
  if (jumbBinary >= 0) signals.push("jumbf-box");

  const ai = signals.length > 0;
  let camera = false;
  const hasExifContext = haystack.includes("exif") || hasPngTextChunk(bytes, "exif");
  if (!ai && hasExifContext) {
    for (const make of CAMERA_MAKES) {
      if (haystack.includes(make)) {
        camera = true;
        signals.push(`camera:${make}`);
        break;
      }
    }
  }

  return {
    ai,
    camera,
    signals,
    confidence: ai ? 0.95 : camera ? 0.2 : 0,
  };
}

function indexOfBytes(haystack, needle) {
  const limit = Math.min(haystack.length, 4_000_000) - needle.length;
  for (let i = 0; i <= limit; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}
