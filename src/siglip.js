import probe from "./siglip-probe.js";
import { visualProbabilityFromLogit } from "./preprocess.js";

export const SIGLIP = {
  size: 224,
  mean: [0.5, 0.5, 0.5],
  std: [0.5, 0.5, 0.5],
};

export function imageDataToSiglipTensor(
  data,
  width,
  height,
  { mean = SIGLIP.mean, std = SIGLIP.std } = {},
) {
  if (width !== SIGLIP.size || height !== SIGLIP.size) {
    throw new Error(`expected ${SIGLIP.size}x${SIGLIP.size}, got ${width}x${height}`);
  }
  const plane = width * height;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    tensor[i] = (data[i * 4] / 255 - mean[0]) / std[0];
    tensor[plane + i] = (data[i * 4 + 1] / 255 - mean[1]) / std[1];
    tensor[2 * plane + i] = (data[i * 4 + 2] / 255 - mean[2]) / std[2];
  }
  return tensor;
}

export function l2Normalize(vector) {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) sum += vector[i] * vector[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) out[i] = vector[i] / norm;
  return out;
}

export function probeLogit(pooler) {
  const x = l2Normalize(pooler);
  if (x.length !== probe.weight.length) {
    throw new Error(`probe dim ${probe.weight.length} != pooler ${x.length}`);
  }
  let z = probe.bias;
  for (let i = 0; i < x.length; i += 1) z += probe.weight[i] * x[i];
  return z;
}

export function siglipProbability(pooler) {
  return visualProbabilityFromLogit(probeLogit(pooler));
}

/** Soft-OR: independent heads both vote AI. */
export function blendVisual(siglip, commfor) {
  const a = Number.isFinite(siglip) ? siglip : 0;
  const b = Number.isFinite(commfor) ? commfor : 0;
  return a + b - a * b;
}
