/**
 * 매니페스트가 말한 전처리를 **실제로 도는 것**으로 바꾸고, 나온 수를 이름으로 읽는다.
 *
 * ## 왜 이 파일이 있는가
 *
 * 첫 화물은 실리는데 쓸 수가 없었다. 가중치가 맞고 샘플 대조도 통과했지만, 받는
 * 쪽이 **자기 이미지를 어떤 텐서로 만들어야 하는지 몰랐다.** 샘플 검증이 통과한
 * 것은 샘플이 이미 정규화된 텐서였기 때문이고, 그래서 배지는 초록인데 사용자는
 * 못 썼다.
 *
 * ## 왜 borch-hub 에 있나, borchvision 이 아니라
 *
 * 하는 일이 **매니페스트를 읽는 것**이다. 그리고 이쪽은 이미 `borch` 를 peer 로
 * 잡고 있으므로 그 안의 `vision` 원시연산을 그대로 쓴다. 반대로 유통(borch-hub)이
 * 모델 라이브러리(borchvision)를 의존하면 방향이 꼬인다 — 나중에 `bimm` 이 생기면
 * 그쪽도 의존해야 하고, 그러면 유통이 카탈로그마다 하나씩 늘어난다.
 */

import { Tensor, vision } from "borch";

import { BorchHubError, type Manifest, type Preprocess } from "./manifest.js";

/**
 * 이 런타임이 그 전처리를 **할 수 있는가**. 못 하는 이유를 목록으로 준다.
 *
 * 받기 전에 물어야 하는 질문이다. 45MB 를 받고 나서 "그 크기 조정은 못 합니다" 는
 * 배지가 아니라 사과다.
 */
export function preprocessGaps(pre: Preprocess): readonly string[] {
  const gaps: string[] = [];
  // **borch 에 Resize 가 없다**(실측: vision.ts 는 ToTensor·Normalize·RandomCrop·
  // RandomHorizontalFlip 뿐이다). 스펙은 적을 수 있게 두되, 못 하는 것을 할 수
  // 있는 척하지 않는다.
  if (pre.resize !== null) {
    gaps.push(`resize (shortSide ${pre.resize.shortSide}) — borch has no Resize yet`);
  }
  if (pre.centerCrop !== null) {
    gaps.push(`centerCrop [${pre.centerCrop.join(", ")}] — borch has no CenterCrop yet`);
  }
  if (pre.mean.length !== pre.inputSize[0] || pre.std.length !== pre.inputSize[0]) {
    gaps.push(
      `mean/std have ${pre.mean.length}/${pre.std.length} entries `
      + `but the input has ${pre.inputSize[0]} channels`,
    );
  }
  return gaps;
}

/**
 * 이미지 한 장 → 이 모델이 받는 텐서.
 *
 * `image` 는 `(H, W, C)` 다 — torchvision 에서 그 자리에 오는 것이 PIL 이미지이고,
 * 우리에게 PIL 이 없어서 배열이 그 자리를 대신한다(코어의 `vision` 과 같은 규칙).
 */
export function transformFor(manifest: Manifest): (img: vision.Image) => Tensor {
  const pre = manifest.preprocess;
  if (pre === null) {
    throw new BorchHubError(
      `${manifest.name} ${manifest.version} does not say how to preprocess an image `
      + "(schema version 1 had no such field).\n"
      + "  Without it the weights load but nothing can be fed to them — ask for a "
      + "manifest at version 2 or later.",
    );
  }
  const gaps = preprocessGaps(pre);
  if (gaps.length > 0) {
    throw new BorchHubError(
      `this runtime cannot perform the preprocessing ${manifest.name} asks for:\n`
      + gaps.map((g) => `  ${g}`).join("\n"),
    );
  }

  const steps = new vision.Compose([
    new vision.ToTensor(),
    new vision.Normalize([...pre.mean], [...pre.std]),
  ]);
  const [channels, height, width] = pre.inputSize;

  return (img: vision.Image): Tensor => {
    if (img.height !== height || img.width !== width || img.channels !== channels) {
      // 크기를 말없이 맞추지 않는다 — 맞추는 방법이 없고(Resize 가 없다),
      // 있더라도 어느 방법인지는 매니페스트가 정할 일이다.
      throw new BorchHubError(
        `${manifest.name} takes ${channels}x${height}x${width}, `
        + `but the image is ${img.channels}x${img.height}x${img.width}. `
        + "This runtime cannot resize.",
      );
    }
    const out = steps.apply(img);
    if (!(out instanceof Tensor)) throw new BorchHubError("the transform did not make a tensor");
    // (C,H,W) → (1,C,H,W). 층들이 배치 축을 기대한다.
    return out.reshape([1, channels, height, width]);
  };
}

export interface Reading {
  readonly index: number;
  /** 이름을 모르면 `null` — 그때는 자리 번호까지가 아는 전부다. */
  readonly label: string | null;
  readonly scores: readonly number[];
}

/**
 * 나온 수를 읽는다. **이름이 없으면 없다고 답한다** — 자리 번호를 이름인 척하지 않는다.
 */
export function readOutput(manifest: Manifest, scores: readonly number[]): Reading {
  if (scores.length === 0) throw new BorchHubError("the model returned nothing");
  let best = 0;
  for (let i = 1; i < scores.length; i++) {
    if ((scores[i] ?? 0) > (scores[best] ?? 0)) best = i;
  }
  const classes = manifest.outputs?.classes ?? null;
  if (classes !== null && classes.length !== scores.length) {
    throw new BorchHubError(
      `${manifest.name} lists ${classes.length} class names but the model returned `
      + `${scores.length} scores — the manifest is not describing this model.`,
    );
  }
  return { index: best, label: classes?.[best] ?? null, scores: [...scores] };
}
