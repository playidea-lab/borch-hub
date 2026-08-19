/**
 * 파서가 **거절해야 할 것을 거절하는지** 본다.
 *
 * 통과하는 매니페스트 하나만 확인하는 것은 검사가 아니다. 파서의 값은 틀린 것을
 * 로더 안쪽까지 들여보내지 않는 데 있고, 그건 어긋난 입력을 줘봐야만 드러난다.
 *
 * 메시지에 **어느 필드인지**가 들어 있는지도 같이 본다. 그것이 없으면 받는 쪽이
 * 42개 필드 중 어디가 틀렸는지 알 수 없어 우리에게 물어보게 된다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { BorchHubError, parseManifest, type Manifest } from "../src/manifest.js";

/** 온전한 매니페스트. 각 검사는 여기서 한 군데만 망가뜨린다. */
function whole(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "cifar10-resnet18",
    version: "1.0.0",
    task: "image-classification",
    dataset: "cifar-10",
    tags: ["vision", "resnet"],
    arch: { factory: "resnet18", args: { numClasses: 10 } },
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
    sample: { inputUrl: "sample.in.safetensors", outputUrl: "sample.out.safetensors", rtol: 1e-4, atol: 1e-6 },
    metrics: { values: { top1: 0.912 }, measuredBy: "borch.ts 0.1.0 / Chrome 141", measuredAt: "2026-08-19" },
    origin: "trained-by-borch",
    license: { weights: "Apache-2.0", data: "CIFAR-10 (research use)" },
  };
}

/** 한 군데를 망가뜨린 매니페스트를 만든다. */
function broken(mutate: (doc: Record<string, unknown>) => void): Record<string, unknown> {
  const doc = whole();
  mutate(doc);
  return doc;
}

function rejects(doc: unknown, mentions: string): void {
  assert.throws(
    () => parseManifest(doc),
    (err: unknown) => {
      assert.ok(err instanceof BorchHubError, `BorchHubError 여야 합니다 — ${String(err)}`);
      assert.ok(
        err.message.includes(mentions),
        `메시지가 '${mentions}' 를 짚어야 합니다 — 받은 것: ${err.message}`,
      );
      return true;
    },
  );
}

test("온전한 매니페스트를 읽으면 값이 그대로 나온다", () => {
  const m: Manifest = parseManifest(whole());
  assert.equal(m.name, "cifar10-resnet18");
  assert.equal(m.arch.factory, "resnet18");
  assert.equal(m.weights.bytes, 44_700_000);
  assert.equal(m.runtime.ts, ">=0.1.0");
  assert.equal(m.runtime.webgpu?.limits["maxStorageBufferBindingSize"], 134_217_728);
  assert.equal(m.metrics?.values["top1"], 0.912);
  assert.equal(m.origin, "trained-by-borch");
});

test("빠진 선택 필드는 undefined 가 아니라 null 로 돌아온다", () => {
  const m = parseManifest(broken((d) => {
    delete d["description"];
    delete d["metrics"];
  }));
  assert.equal(m.description, null);
  assert.equal(m.metrics, null);
  // 없는 것을 표현하는 방법이 둘이면 비교하는 자리마다 둘 다 다뤄야 한다.
  assert.ok(!Object.values(m).includes(undefined));
});

test("attestation 은 아직 아무도 안 채우므로 null 이다", () => {
  assert.equal(parseManifest(whole()).attestation, null);
});

test("모르는 schemaVersion 은 추측하지 않고 거절한다", () => {
  rejects(broken((d) => { d["schemaVersion"] = 2; }), "schemaVersion");
});

test("ts 와 py 가 둘 다 비면 거절한다 — 어디서도 못 도는 모델이다", () => {
  rejects(broken((d) => { d["runtime"] = { ts: null, py: null }; }), "runtime");
});

test("safetensors 가 아닌 형식은 거절한다", () => {
  rejects(broken((d) => {
    (d["weights"] as Record<string, unknown>)["format"] = "pickle";
  }), "weights.format");
});

test("모르는 origin 은 거절한다 — 우리 수와 남의 수가 섞이는 자리다", () => {
  rejects(broken((d) => { d["origin"] = "vibes"; }), "origin");
});

test("어긋난 필드를 경로로 짚는다", () => {
  rejects(broken((d) => {
    (d["weights"] as Record<string, unknown>)["bytes"] = "44MB";
  }), ".weights.bytes");
  rejects(broken((d) => {
    (d["sample"] as Record<string, unknown>)["rtol"] = "loose";
  }), ".sample.rtol");
});

test("객체가 아닌 것을 주면 그 자리에서 멈춘다", () => {
  rejects("{}", "뿌리");
  rejects([], "뿌리");
  rejects(null, "뿌리");
});
