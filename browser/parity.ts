/**
 * 카탈로그의 ResNet-18 이 **코어의 벤치에 있는 것과 같은 모델인지** 대조한다.
 *
 * ## 왜 이 검사가 있어야 하나
 *
 * 정의가 두 벌이다. 합칠 수가 없다 — 코어가 이 패키지를 의존하면 순환이 된다.
 * 두 벌은 반드시 갈리므로, 갈리는 것을 막는 대신 **갈린 것을 잡는다.**
 *
 * ## 무엇을 보는가
 *
 * `stateDict` 의 **열쇠와 모양**이다. 값이 아니다 — 둘은 각자 무작위로 초기화되므로
 * 값이 같을 이유가 없다. 열쇠가 갈리면 배포된 가중치가 안 실리고, 모양이 갈리면
 * 실렸는데 틀린다. 뒤엣것이 더 나쁘다.
 *
 * 열쇠 이름은 필드 이름에서 나온다. 그래서 이 검사는 **필드 이름을 바꾸는 것**을
 * 붙잡는다 — 코드로는 아무 문제 없어 보이고 검사도 다 통과하는데, 이미 배포된
 * 체크포인트만 조용히 안 실리는 종류다.
 */

import { Device, init, type Tensor } from "borch";
import { ResNet18 as CoreResNet18 } from "@core/bench";

import { createModel } from "bimm";

const NUM_CLASSES = 10;

interface Entry {
  readonly key: string;
  readonly shape: readonly number[];
}

function entries(state: Readonly<Record<string, Tensor>>): Entry[] {
  return Object.keys(state)
    .sort()
    .map((key) => ({ key, shape: [...(state[key]?.shape ?? [])] }));
}

function shapeOf(list: readonly Entry[], key: string): string | null {
  const found = list.find((e) => e.key === key);
  return found ? `[${found.shape.join(", ")}]` : null;
}

export interface ParityReport {
  readonly ok: boolean;
  readonly text: string;
  readonly adapter: string;
}

export async function report(): Promise<ParityReport> {
  await init();

  const mine = entries(createModel("borchvision", "resnet18_cifar", { numClasses: NUM_CLASSES }).stateDict());
  const theirs = entries(new CoreResNet18(NUM_CLASSES).stateDict());

  const mineKeys = new Set(mine.map((e) => e.key));
  const theirKeys = new Set(theirs.map((e) => e.key));

  const lines: string[] = [];

  for (const e of mine) {
    if (!theirKeys.has(e.key)) lines.push(`  카탈로그에만 있다: ${e.key} [${e.shape.join(", ")}]`);
  }
  for (const e of theirs) {
    if (!mineKeys.has(e.key)) lines.push(`  코어 벤치에만 있다: ${e.key} [${e.shape.join(", ")}]`);
  }
  for (const e of mine) {
    if (!theirKeys.has(e.key)) continue;
    const theirShape = shapeOf(theirs, e.key);
    const myShape = `[${e.shape.join(", ")}]`;
    if (theirShape !== myShape) {
      // 열쇠는 같은데 모양이 다른 것이 제일 나쁘다 — 가중치가 실리고 나서 틀린다.
      lines.push(`  모양이 다르다: ${e.key} — 카탈로그 ${myShape} · 코어 ${theirShape}`);
    }
  }

  const ok = lines.length === 0;
  const head = ok
    ? `카탈로그 borchvision/resnet18_cifar == 코어 벤치 ResNet18 · 텐서 ${mine.length}개, 열쇠와 모양이 모두 같다`
    : `**갈렸다** — 카탈로그 ${mine.length}개 · 코어 ${theirs.length}개`;

  return {
    ok,
    text: [head, ...lines].join("\n"),
    adapter: Device.adapterInfo,
  };
}
