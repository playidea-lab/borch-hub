/**
 * 매니페스트의 `arch` 를 카탈로그 호출로 옮긴다.
 *
 * **이것이 카탈로그와 함께 `bimm` 으로 가지 않은 이유**는 이름이 아니라 방향이다.
 * `Arch` 는 매니페스트의 형이고, 카탈로그가 그것을 알면 모델 하나 만들려는 사람이
 * 매니페스트 파서를 끌고 오게 된다. 의존은 한 방향으로만 흐른다 — 허브는 카탈로그를
 * 알고, 카탈로그는 허브를 모른다.
 */

import { createModel, listModels, type FactoryName } from "bimm-ts";
import type { nn } from "borch-ts";

import { BorchHubError, type Arch } from "./manifest.js";

/**
 * 판 1 매니페스트가 쓰던 이름공간 없는 이름.
 *
 * **지울 수 없다.** 그 이름을 적은 매니페스트가 이미 나가 있고, 우리가 나중에
 * 이름을 정리했다는 것은 그쪽 사정이 아니다. 여기 한 줄이 그 약속을 지킨다.
 *
 * 이 표가 **허브 쪽에 있는 것도 방향 때문이다** — 판 1 은 매니페스트의 판이지
 * 카탈로그의 판이 아니다.
 */
const V1_NAMES: Readonly<Record<string, FactoryName>> = {
  resnet18: { library: "borchvision", factory: "resnet18_cifar" },
};

function shown(): string {
  return listModels().map((f) => `${f.library}/${f.factory}`).join(", ");
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
