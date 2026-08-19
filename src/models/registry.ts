/**
 * 이름 하나로 모델 구조를 되살린다.
 *
 * 매니페스트의 `arch.factory` 가 여기 적힌 이름이고, 가중치만으로는 복원되지 않는
 * 나머지 절반이 이 표다. **이름을 지우거나 뜻을 바꾸면 그 이름을 적어둔 매니페스트가
 * 전부 죽는다** — 늘리는 것은 되지만 줄이는 것은 안 된다.
 */

import { nn } from "borch";

import { BorchHubError } from "../manifest.js";
import { checkArgs, type FactoryArgs } from "./args.js";
import { ResNet18 } from "./resnet.js";

interface Factory {
  readonly spec: FactoryArgs;
  readonly build: (args: Readonly<Record<string, number>>) => nn.Module;
}

const FACTORIES: Readonly<Record<string, Factory>> = {
  resnet18: {
    spec: { numClasses: { kind: "int", min: 1 } },
    // `?? 1` 은 도달하지 않는다 — checkArgs 가 없는 인자를 이미 거절했다.
    // noUncheckedIndexedAccess 를 켠 값이 이런 자리를 눈에 보이게 하는 것이다.
    build: (args) => new ResNet18(args["numClasses"] ?? 1),
  },
};

/** 카탈로그에 있는 이름들. 발견 레이어와 오류 메시지가 같은 표를 본다. */
export function factories(): readonly string[] {
  return Object.keys(FACTORIES).sort();
}

/** 이 팩토리가 받는 인자 규격. 매니페스트를 쓰는 쪽이 물어볼 수 있어야 한다. */
export function factorySpec(factory: string): FactoryArgs {
  const found = FACTORIES[factory];
  if (found === undefined) {
    throw new BorchHubError(
      `모르는 팩토리입니다: ${factory}\n  카탈로그: ${factories().join(", ")}`,
    );
  }
  return found.spec;
}

/**
 * 매니페스트의 `arch` 를 실제 모델로.
 *
 * **`await init()` 이 먼저다.** 층이 곧 텐서이고 텐서는 WebGPU 어댑터 위에 선다.
 * 안 부르고 여기 오면 코어가 그 자리에서 문구와 함께 멈춘다 — 그 진단을 가로채
 * 우리 말로 바꾸지 않는다. 원인은 코어 쪽이고, 코어의 문구가 더 정확하다.
 */
export function createModel(
  factory: string,
  args: Readonly<Record<string, unknown>> = {},
): nn.Module {
  const found = FACTORIES[factory];
  if (found === undefined) {
    throw new BorchHubError(
      `모르는 팩토리입니다: ${factory}\n  카탈로그: ${factories().join(", ")}`,
    );
  }
  return found.build(checkArgs(factory, found.spec, args));
}
