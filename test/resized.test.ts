/**
 * **크기를 맞춰야 하는 매니페스트**를 허브가 소화하는지 본다.
 *
 * ## 왜 지금 이것을 보나
 *
 * 레지스트리에 있는 모델은 CIFAR 하나뿐이고, 그것은 32×32 로 이미 맞아서 들어온다 —
 * `resize` 도 `centerCrop` 도 `null` 이다. 그래서 **그 두 필드는 스키마에 적혀 있고
 * 코드에 쓰여 있을 뿐, 값이 든 채로 지나가 본 적이 없다.**
 *
 * 카탈로그에 ImageNet 쪽 모델이 들어오면 그날 처음 밟힌다(224×224 · 1000 클래스 ·
 * 짧은 변 256 으로 맞추고 가운데를 자른다). 처음 밟는 자리는 그때가 아니라 **지금**
 * 밟아 보는 편이 낫다 — 그때는 카탈로그·가중치·CDN 이 한꺼번에 새것이라 무엇이
 * 틀렸는지 갈라내기 어렵다.
 *
 * 조립까지가 GPU 없이 되는 자리다. 실제로 이미지를 넣어 돌리는 것은 브라우저 하네스가 본다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { parseManifest } from "../src/manifest.js";
import { preprocessGaps, readOutput, transformFor } from "../src/preprocess.js";

import { broken } from "./fixture.js";

/** ImageNet 쪽 모델의 모양. 지금 레지스트리에 없는 값들만 골라 넣었다. */
function imagenet(): Record<string, unknown> {
  return broken((d) => {
    d["name"] = "mobilenetv2_100";
    d["dataset"] = "imagenet-1k";
    d["arch"] = { library: "timm", factory: "mobilenetv2_100", args: { numClasses: 1000 } };
    d["origin"] = "converted-from-torch";
    d["preprocess"] = {
      inputSize: [3, 224, 224],
      valueRange: "unit",
      mean: [0.485, 0.456, 0.406],
      std: [0.229, 0.224, 0.225],
      resize: { shortSide: 256, interpolation: "bilinear" },
      centerCrop: [224, 224],
    };
    d["outputs"] = {
      kind: "logits",
      classes: Array.from({ length: 1000 }, (_, i) => `class-${i}`),
    };
  });
}

test("크기를 맞추라는 전처리가 그대로 읽힌다", () => {
  const manifest = parseManifest(imagenet());
  const pre = manifest.preprocess;
  assert.deepEqual(pre?.inputSize, [3, 224, 224]);
  assert.deepEqual(pre?.resize, { shortSide: 256, interpolation: "bilinear" });
  assert.deepEqual(pre?.centerCrop, [224, 224]);
});

test("이 런타임이 그 전처리를 할 수 있다고 답한다", () => {
  // `manifest.ts` 의 `resize` 주석은 **아직 아무 런타임도 못 한다**고 말하고 있었다.
  // 그 문장은 코어에 `Resize` 가 없던 시절의 것이고, 지금은 있다. 여기서 그것을
  // 사실로 고정한다 — 주석이 다시 낡으면 이 검사가 아니라 사람이 먼저 알아채도록.
  const manifest = parseManifest(imagenet());
  assert.deepEqual(preprocessGaps(manifest.preprocess!), []);
});

test("맞추고 자르는 파이프라인이 조립된다", () => {
  const manifest = parseManifest(imagenet());
  const transform = transformFor(manifest);
  assert.equal(typeof transform, "function");
});

test("맞추는 단계가 있으면 크기가 다른 이미지도 거절하지 않는다", () => {
  // 크기를 맞추는 단계가 하나도 없을 때만 들어온 것이 이미 맞아야 한다. `resize` 가
  // 있으면 그 검사를 지나가야 하고, 안 그러면 **ImageNet 모델에 사진을 못 넣는다.**
  const manifest = parseManifest(imagenet());
  const transform = transformFor(manifest);
  const wrongSize = { channels: 3, height: 480, width: 640, data: new Float32Array(0) };
  // 실제 변환은 장치가 들어 크기 검사 뒤에서 멈춘다. 여기서 보는 것은 **크기 때문에
  // 멈추지는 않는다**는 것이다.
  assert.throws(
    () => transform(wrongSize as never),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(
        !message.includes("asks for no resize or crop"),
        `크기로 거절하면 안 됩니다 — ${message}`,
      );
      // **어디까지 갔는지도 못 박는다.** 다른 이유로 일찍 멈춰도 위 검사는 통과하므로,
      // 그것만 두면 이 검사가 조용히 아무것도 안 보게 된다.
      assert.match(message, /device|init/i, "실제 변환까지 갔어야 합니다");
      return true;
    },
  );
});

test("채널 수가 다르면 여전히 거절한다", () => {
  const manifest = parseManifest(imagenet());
  const transform = transformFor(manifest);
  const gray = { channels: 1, height: 480, width: 640, data: new Float32Array(0) };
  assert.throws(() => transform(gray as never), /takes 3 channels/);
});

test("클래스 1000 개짜리 출력도 읽는다", () => {
  const manifest = parseManifest(imagenet());
  const scores = new Array(1000).fill(0);
  scores[812] = 9.5;
  const reading = readOutput(manifest, scores);
  assert.equal(reading.index, 812);
  assert.equal(reading.label, "class-812");
});

test("남이 변환해 온 모델이라는 표시가 그대로 남는다", () => {
  // 우리가 잰 수와 남이 발표한 수를 섞지 않으려고 있는 칸이다. 여기까지 오면서
  // 조용히 지워지면 그 구분이 사라진다.
  assert.equal(parseManifest(imagenet()).origin, "converted-from-torch");
});
