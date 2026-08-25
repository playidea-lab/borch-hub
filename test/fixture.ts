/**
 * 검사들이 함께 쓰는 **온전한 매니페스트 하나.**
 *
 * 각 검사는 여기서 시작해 한 군데만 망가뜨린다. 파일마다 따로 지으면 어느 날
 * 두 벌이 갈리고, 그때 갈린 쪽을 고치는 대신 검사를 고치게 된다.
 */

/** 온전한 매니페스트(판 2). */
export function whole(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    name: "cifar10-resnet18",
    version: "1.0.0",
    task: "image-classification",
    dataset: "cifar-10",
    tags: ["vision", "resnet"],
    arch: { library: "borchvision", factory: "resnet18_cifar", args: { numClasses: 10 } },
    preprocess: {
      inputSize: [3, 32, 32],
      valueRange: "unit",
      mean: [0.4914, 0.4822, 0.4465],
      std: [0.2470, 0.2435, 0.2616],
      resize: null,
      centerCrop: null,
    },
    outputs: { kind: "logits", classes: ["airplane", "automobile", "bird"] },
    weights: {
      url: "https://cdn.example/cifar10-resnet18/1.0.0/model.safetensors",
      sha256: "a".repeat(64),
      bytes: 44_700_000,
      format: "safetensors",
    },
    runtime: {
      ts: ">=0.1.0",
      py: null,
      webgpu: { required: true, limits: { maxStorageBufferBindingSize: 134_217_728 } },
    },
    sample: {
      inputUrl: "sample.in.safetensors",
      outputUrl: "sample.out.safetensors",
      rtol: 1e-4,
      atol: 1e-6,
    },
    metrics: {
      values: { top1: 0.912 },
      measuredBy: "borch.ts 0.1.0 / Chrome 141",
      measuredAt: "2026-08-19",
    },
    origin: "trained-by-borch",
    license: { weights: "Apache-2.0", data: "CIFAR-10 (research use)" },
  };
}

/** 판 1 — 첫 화물이 나간 모양. 전처리도 이름공간도 없다. */
export function v1(): Record<string, unknown> {
  const doc = whole();
  doc["schemaVersion"] = 1;
  delete doc["preprocess"];
  delete doc["outputs"];
  const arch = doc["arch"] as Record<string, unknown>;
  delete arch["library"];
  // 판 1 이 실제로 쓴 이름이다. 지금 이름을 넣으면 별칭을 안 지나므로 검사가
  // 확인하려는 것(옛 이름이 아직 실리는가)을 안 확인하게 된다.
  arch["factory"] = "resnet18";
  return doc;
}

/** 한 군데를 망가뜨린 매니페스트를 만든다. */
export function broken(mutate: (doc: Record<string, unknown>) => void): Record<string, unknown> {
  const doc = whole();
  mutate(doc);
  return doc;
}
