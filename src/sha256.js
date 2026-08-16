/**
 * SHA-256 of an ArrayBuffer using Web Crypto (browser / recent Node).
 */
export async function sha256Hex(buffer) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto subtle.digest is required for SHA-256");
  }
  const digest = await subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function assertSha256(actual, expected, label = "model") {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `${label} SHA-256 mismatch: got ${actual}, expected ${expected}`,
    );
  }
}
