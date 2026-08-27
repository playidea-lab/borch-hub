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

/** 매니페스트가 적은 이름을 카탈로그의 이름으로. 판 1 이름이 표에 없으면 `null`. */
function resolveName(arch: Arch): FactoryName | null {
  if (arch.library !== null) return { library: arch.library, factory: arch.factory };
  return V1_NAMES[arch.factory] ?? null;
}

function v1Unknown(arch: Arch): string {
  return `unknown factory: ${arch.factory} (a manifest with no library)\n`
    + `  catalogue: ${shown()}`;
}

function absent(name: FactoryName): string | null {
  const has = listModels().some(
    (f) => f.library === name.library && f.factory === name.factory,
  );
  if (has) return null;
  return `이 카탈로그에 ${name.library}/${name.factory} 가 없습니다 — `
    + "`bimm-ts` 가 낡았을 수 있습니다\n"
    + `  지금 있는 것: ${shown()}`;
}

/**
 * **이 카탈로그가 이 모델을 만들 수 있는가** — 받기 전에 물을 수 있는 형태로.
 *
 * 없으면 `createModelFor` 도 알려 준다. 다만 그때는 이미 가중치를 다 받고 해시까지
 * 맞춘 뒤다. 22MB 를 쓰고 나서 "그 이름이 없다" 를 듣는 것과 쓰기 전에 듣는 것은
 * 같은 사실이 아니다.
 *
 * **peer 범위가 참이 되는 자리이기도 하다.** `bimm-ts` 하한을 올려 막는 대신 여기서
 * 거절하면, 낡은 카탈로그로도 그것이 만들 수 있는 모델은 그대로 돈다. 우리가 아는
 * 것은 "이 카탈로그에 그 이름이 있는가" 이지 "몇 판부터 생겼는가" 가 아니다 —
 * 뒤엣것은 매니페스트에 적어야 알고, 적어도 새 이름이 생기면 다시 낡는다.
 */
export function cannotBuild(arch: Arch): string | null {
  const name = resolveName(arch);
  return name === null ? v1Unknown(arch) : absent(name);
}

/**
 * 매니페스트의 `arch` 를 그대로 받아서.
 *
 * 판 1 에는 `library` 가 없다. 그때 쓰던 이름을 지금 이름으로 이어 준다 — 그것이
 * 없으면 첫 화물의 매니페스트가 오늘부터 안 실린다.
 */
export function createModelFor(arch: Arch): nn.Module {
  const name = resolveName(arch);
  if (name === null) throw new BorchHubError(v1Unknown(arch));
  const gone = absent(name);
  if (gone !== null) throw new BorchHubError(gone);
  return createModel(name.library, name.factory, arch.args);
}
