/**
 * 이름 하나로 모델 구조를 되살린다.
 *
 * 매니페스트의 `arch` 가 여기 적힌 이름이고, 가중치만으로는 복원되지 않는 나머지
 * 절반이 이 표다. **이름을 지우거나 뜻을 바꾸면 그 이름을 적어둔 매니페스트가 전부
 * 죽는다** — 늘리는 것은 되지만 줄이는 것은 안 된다.
 *
 * ## 왜 이름이 둘로 나뉘어 있나
 *
 * `library` 없이 `factory` 만 두면 그 이름은 언젠가 거짓말이 된다. 실제 생태계에서
 * torchvision 의 `resnet18` 과 timm 의 `resnet18` 은 **다른 모델이고 가중치가 안
 * 호환된다.** `borchvision` 과 `bimm` 이 둘 다 생기면 우리도 같은 자리에 서고,
 * 그때는 이미 배포된 매니페스트들이 이름공간 없는 이름을 박고 있다.
 *
 * 카탈로그 코드가 지금 어디 있는지(이 패키지 안이다)와 `library` 이름은 별개다.
 * 저 이름은 **규약**을 가리키므로, 나중에 코드가 `borchvision` 패키지로 떠나도
 * 매니페스트는 안 깨진다.
 */

import { nn } from "borch";

import { BorchHubError, type Arch } from "../manifest.js";
import { checkArgs, type FactoryArgs } from "./args.js";
import { ResNet18Cifar } from "./resnet.js";

interface Factory {
  readonly spec: FactoryArgs;
  readonly build: (args: Readonly<Record<string, number>>) => nn.Module;
}

/** 열쇠는 `library/factory` 다 — 표를 찾는 데만 쓰고 밖으로는 안 내보낸다. */
const FACTORIES: Readonly<Record<string, Factory>> = {
  "borchvision/resnet18_cifar": {
    spec: { numClasses: { kind: "int", min: 1 } },
    // `?? 1` 은 도달하지 않는다 — checkArgs 가 없는 인자를 이미 거절했다.
    // noUncheckedIndexedAccess 를 켠 값이 이런 자리를 눈에 보이게 하는 것이다.
    build: (args) => new ResNet18Cifar(args["numClasses"] ?? 1),
  },
};

/**
 * 판 1 매니페스트가 쓰던 이름공간 없는 이름.
 *
 * **지울 수 없다.** 그 이름을 적은 매니페스트가 이미 나가 있고, 우리가 나중에
 * 이름을 정리했다는 것은 그쪽 사정이 아니다. 여기 한 줄이 그 약속을 지킨다.
 */
const V1_NAMES: Readonly<Record<string, { library: string; factory: string }>> = {
  resnet18: { library: "borchvision", factory: "resnet18_cifar" },
};

export interface FactoryName {
  readonly library: string;
  readonly factory: string;
}

/** 카탈로그에 있는 것들. 발견 레이어와 오류 문구가 같은 표를 본다. */
export function factories(): readonly FactoryName[] {
  return Object.keys(FACTORIES).sort().map((key) => {
    const cut = key.indexOf("/");
    return { library: key.slice(0, cut), factory: key.slice(cut + 1) };
  });
}

function shown(): string {
  return factories().map((f) => `${f.library}/${f.factory}`).join(", ");
}

function find(library: string, factory: string): Factory {
  const found = FACTORIES[`${library}/${factory}`];
  if (found === undefined) {
    throw new BorchHubError(
      `unknown factory: ${library}/${factory}\n  catalogue: ${shown()}`,
    );
  }
  return found;
}

/** 이 팩토리가 받는 인자 규격. 매니페스트를 쓰는 쪽이 물어볼 수 있어야 한다. */
export function factorySpec(library: string, factory: string): FactoryArgs {
  return find(library, factory).spec;
}

/**
 * 이름과 인자로 실제 모델을.
 *
 * **`await init()` 이 먼저다.** 층이 곧 텐서이고 텐서는 WebGPU 어댑터 위에 선다.
 * 안 부르고 여기 오면 코어가 그 자리에서 멈춘다 — 그 진단을 가로채 우리 말로
 * 바꾸지 않는다. 원인은 코어 쪽이고, 코어의 문구가 더 정확하다.
 */
export function createModel(
  library: string,
  factory: string,
  args: Readonly<Record<string, unknown>> = {},
): nn.Module {
  const found = find(library, factory);
  return found.build(checkArgs(`${library}/${factory}`, found.spec, args));
}

/**
 * 매니페스트의 `arch` 를 그대로 받아서.
 *
 * 판 1 에는 `library` 가 없다. 그때 쓰던 이름을 지금 이름으로 이어 준다 — 그것이
 * 없으면 첫 화물의 매니페스트가 오늘부터 안 실린다.
 */
export function createModelFor(arch: Arch): nn.Module {
  if (arch.library !== null) return createModel(arch.library, arch.factory, arch.args);
  const old = V1_NAMES[arch.factory];
  if (old === undefined) {
    throw new BorchHubError(
      `unknown factory: ${arch.factory} (a manifest with no library)\n`
      + `  catalogue: ${shown()}`,
    );
  }
  return createModel(old.library, old.factory, arch.args);
}
