/**
 * Pinned Community Forensics ViT-S/384 export.
 * Official weights: OwensLab/commfor-model-384 (MIT).
 * We export a single-logit ONNX (sigmoid = P(AI)).
 */
export const MODEL = {
  id: "commfor-vit-s-384",
  filename: "commfor-vit-s-384.onnx",
  sha256: "67a3770d39d07403a65628544eb99d0c4c444285d3ca2fcdec80972a1237436f",
  bytes: 87388775,
  inputName: "pixel_values",
  outputName: "logits",
  inputShape: [1, 3, 384, 384],
  sourceRepo: "OwensLab/commfor-model-384",
  paper: "https://arxiv.org/abs/2411.04125",
  license: "MIT",
};

export const EVAL_THRESHOLD = 0.65;
