/**
 * **이 카탈로그가 이 모델을 만들 수 있는지 받기 전에 묻는지** 본다.
 *
 * ## 이 검사가 생긴 이유
 *
 * `peerDependencies` 는 `bimm-ts >=0.2.1` 이라고 적혀 있는데, 0.2.1 의 카탈로그에는
 * `resnet` 과 `mobilenet` 뿐이다. 그때 나가 있던 모델 열 중 일곱은 그 뒤에 생긴
 * 이름을 쓴다 — efficientnet 과 mobilenetv3 는 0.4.0, vit 는 0.6.0 이다.
 *
 * 그래도 **그 범위는 거짓이 아니다.** 낡은 카탈로그로도 그것이 아는 모델은 돈다.
 * 거짓이 되는 것은 못 만드는 것을 **다 받고 나서** 알려 줄 때다. 그때 받는 쪽이
 * 듣는 말은 "네 카탈로그가 낡았다" 가 아니라 "그런 이름이 없다" 이고, 그 사람은
 * 자기 설치가 아니라 매니페스트를 의심한다.
 *
 * ## 판을 안 묻고 이름을 묻는 이유
 *
 * 매니페스트에 `bimm` 하한을 적을 수도 있었다. 그러려면 카탈로그가 자기 판을
 * 내보내야 하고, 스키마가 바뀌어야 하고, 이미 나가 있는 매니페스트 열 장을 다시
 * 올려야 한다. 그러고도 **카탈로그에 새 이름이 생길 때마다 그 숫자는 낡는다.**
 * 있는지 없는지는 카탈로그가 이미 안다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { cannotBuild, createModelFor } from "../src/arch.js";
import { checkEnvironment, load } from "../src/load.js";
import { BorchHubError, parseManifest } from "../src/manifest.js";

import { broken } from "./fixture.js";

const MANIFEST_URL = "https://cdn.example/m/1.0.0/manifest.json";

/** `arch` 만 갈아 끼운다. WebGPU 는 이 검사의 관심이 아니라 꺼 둔다. */
function asking(library: string, factory: string) {
  return parseManifest(broken((d) => {
    d["arch"] = { library, factory, args: {} };
    (d["runtime"] as Record<string, unknown>)["webgpu"] = null;
  }));
}

test("카탈로그에 있는 이름이면 아무 말도 안 한다", () => {
  const manifest = asking("borchvision", "resnet18_cifar");
  assert.equal(cannotBuild(manifest.arch), null);
});

test("없는 이름이면 그 이름과 지금 있는 것을 같이 말한다", () => {
  // 없는 이름만 말하면 받는 쪽이 우리에게 물어보게 된다. 무엇이 있는지 같이 줘야
  // 그 자리에서 자기 설치가 낡았다는 것을 안다.
  const why = cannotBuild(asking("timm", "vit_tiny_patch16_224").arch);
  assert.ok(why !== null, "없는 이름은 걸려야 합니다");
  assert.match(why, /timm\/vit_tiny_patch16_224/);
  assert.match(why, /bimm-ts/);
  assert.match(why, /resnet18_cifar/, "지금 있는 것을 같이 말해야 합니다");
});

test("`createModelFor` 와 같은 것을 본다 — 두 자리가 갈리지 않게", () => {
  // 두 벌로 두면 하나가 통과시키고 하나가 거절하는 날이 온다. 그때 받는 쪽은
  // 환경 검사를 지난 뒤 `createModelFor` 에서 막힌다 — 지금 고치려는 그 모양이다.
  const arch = asking("timm", "vit_tiny_patch16_224").arch;
  const why = cannotBuild(arch);
  let thrown: unknown = null;
  try {
    createModelFor(arch);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof BorchHubError, `우리 에러여야 합니다 — ${String(thrown)}`);
  assert.equal(thrown.message, why, "같은 사실을 두 문구로 말하면 안 됩니다");
});

test("환경 검사가 받기 전에 막는다", async () => {
  const report = await checkEnvironment(asking("timm", "vit_tiny_patch16_224"));
  assert.equal(report.ok, false);
  assert.match(report.reasons.join("\n"), /timm\/vit_tiny_patch16_224/);
});

test("가중치를 **한 바이트도 안 받고** 막는다", async () => {
  // 이 검사가 이 파일의 이유다. 문구만 고쳤다면 여전히 45MB 를 쓰고 나서 듣는다.
  const doc = broken((d) => {
    d["arch"] = { library: "timm", factory: "vit_tiny_patch16_224", args: {} };
    (d["runtime"] as Record<string, unknown>)["webgpu"] = null;
  });
  const asked: string[] = [];
  const fetchStub = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    asked.push(url);
    if (url === MANIFEST_URL) return new Response(JSON.stringify(doc), { status: 200 });
    return new Response(new Uint8Array(64) as unknown as BodyInit, { status: 200 });
  }) as typeof fetch;

  await assert.rejects(
    () => load(MANIFEST_URL, { fetch: fetchStub, cache: false }),
    (err: unknown) => err instanceof BorchHubError
      && /vit_tiny_patch16_224/.test((err as Error).message),
  );

  const weights = asked.filter((u) => u !== MANIFEST_URL);
  assert.deepEqual(weights, [], `가중치를 받으면 안 됩니다 — 받은 것: ${weights.join(", ")}`);
});

test("판 1 의 모르는 이름도 같은 자리에서 걸린다", () => {
  const manifest = parseManifest(broken((d) => {
    d["schemaVersion"] = 1;
    delete d["preprocess"];
    delete d["outputs"];
    d["arch"] = { factory: "resnet50", args: {} };
  }));
  const why = cannotBuild(manifest.arch);
  assert.ok(why !== null);
  assert.match(why, /unknown factory: resnet50/);
});
