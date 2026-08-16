/**
 * Pinned on-device models.
 * Community Forensics is bundled. SigLIP2 vision is a one-time public download.
 */
export const MODELS = {
  commfor: {
    id: "commfor-vit-s-384",
    filename: "commfor-vit-s-384.onnx",
    sha256: "67a3770d39d07403a65628544eb99d0c4c444285d3ca2fcdec80972a1237436f",
    bytes: 87388775,
    inputName: "pixel_values",
    outputName: "logits",
    inputShape: [1, 3, 384, 384],
    sourceRepo: "OwensLab/commfor-model-384",
    license: "MIT",
  },
  siglip2: {
    id: "siglip2-vision-base-224",
    filename: "siglip2-vision.onnx",
    sha256: "c0573e3f4140c3a7c4e9cc5912bd6b26a033b46a6a8e8af26cbea262b163bcad",
    bytes: 371807752,
    inputName: "pixel_values",
    outputName: "pooler_output",
    inputShape: [1, 3, 224, 224],
    url: "https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/resolve/main/onnx/vision_model.onnx",
    sourceRepo: "onnx-community/siglip2-base-patch16-224-ONNX",
    license: "Apache-2.0",
  },
};

/** @deprecated use MODELS.commfor */
export const MODEL = MODELS.commfor;

export const EVAL_THRESHOLD = 0.65;
