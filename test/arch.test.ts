/**
 * 매니페스트의 `arch` 가 **카탈로그의 어느 이름으로 가는지** 본다.
 *
 * ## 모델을 실제로 만들지는 않는다
 *
 * 만들려면 WebGPU 어댑터가 든다. 그래서 여기서 보는 것은 만들기 **전까지** — 이름을
 * 옮기고, 모르면 거절하는 데까지다. 층이 실제로 서는지는 브라우저 하네스가 본다.
 *
 * 그 경계 때문에 "이름이 넘어갔다" 를 확인하는 방법이 조금 돈다: 카탈로그가 이름을
 * 알아들으면 **장치가 없다**고 멈추고, 못 알아들으면 **그런 이름이 없다**고 멈춘다.
 * 두 멈춤이 다르다는 것이 곧 이름이 넘어갔다는 증거다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createModelFor } from "../src/arch.js";
import { BorchHubError, parseManifest } from "../src/manifest.js";

import { broken, v1 } from "./fixture.js";

/** 던진 것을 잡아 돌려준다. 안 던지면 그것도 결과다. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (err) {
    return err;
  }
}

test("판 1 의 이름 없는 `resnet18` 이 지금 이름으로 이어진다", () => {
  // 이 별칭이 없으면 **첫 화물의 매니페스트가 오늘부터 안 실린다.** 그 URL 은 이미
  // 남의 페이지에 박혀 있어서 우리가 이름을 정리했다는 것은 그쪽 사정이 아니다.
  const manifest = parseManifest(v1());
  assert.equal(manifest.arch.library, null);
  assert.equal(manifest.arch.factory, "resnet18");

  const err = thrownBy(() => createModelFor(manifest.arch));
  assert.ok(err instanceof Error, "장치가 없으므로 무언가 던져야 합니다");
  assert.ok(
    !(err instanceof BorchHubError),
    `이름은 넘어갔어야 합니다 — 받은 것: ${err.message}`,
  );
  assert.match(err.message, /device|init/i);
});

test("이름공간이 있는 매니페스트는 그대로 카탈로그에 넘긴다", () => {
  const manifest = parseManifest(broken(() => {}));
  const err = thrownBy(() => createModelFor(manifest.arch));
  assert.ok(err instanceof Error);
  assert.ok(!(err instanceof BorchHubError), `카탈로그까지 갔어야 합니다 — ${err.message}`);
});

test("판 1 인데 모르는 이름이면 카탈로그를 보여주며 거절한다", () => {
  const manifest = parseManifest(broken((d) => {
    d["schemaVersion"] = 1;
    delete d["preprocess"];
    delete d["outputs"];
    const arch = d["arch"] as Record<string, unknown>;
    delete arch["library"];
    arch["factory"] = "resnet50";
  }));
  const err = thrownBy(() => createModelFor(manifest.arch));
  assert.ok(err instanceof BorchHubError, `우리 에러여야 합니다 — ${String(err)}`);
  assert.match(err.message, /unknown factory: resnet50/);
  // 무엇이 있는지 같이 말한다. 없는 이름만 말하면 받는 쪽이 우리에게 물어보게 된다.
  assert.match(err.message, /catalogue: .*resnet18_cifar/);
});
