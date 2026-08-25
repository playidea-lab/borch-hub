/**
 * **받는 길을 본다** — 주소를 풀고, 매니페스트를 읽고, 바이트를 재는 데까지.
 *
 * ## 왜 이 파일이 늦게 생겼나
 *
 * 여기까지는 브라우저에서만 확인되고 있었다. `browser/roundtrip.ts` 가 진짜 CDN 에서
 * 45MB 를 받아 해시를 대조한다 — 진짜 근거이지만 **GPU 가 있는 기계에서 사람이 손으로
 * 돌려야** 하고, 그래서 CI 는 이 패키지가 하는 일의 핵심을 한 번도 본 적이 없었다.
 *
 * 그런데 이 길은 GPU 를 안 탄다. 받고, 길이를 세고, 해시를 재는 것뿐이다. `fetch` 를
 * 주입할 수 있게 열어둔 훅이 이미 있으므로 **가짜 서버 하나면 노드에서 전부 돈다** —
 * 설계는 되어 있었고 쓰지 않았을 뿐이다.
 *
 * ## 무엇을 확인하는가
 *
 * 통과하는 경우가 아니라 **거절하는 경우**다. 이 패키지의 값은 틀린 바이트를 모델까지
 * 들여보내지 않는 데 있고, 그건 틀린 바이트를 줘봐야만 드러난다.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { checkEnvironment, fetchManifest, fetchWeights, resolve } from "../src/load.js";
import { BorchHubError, parseManifest } from "../src/manifest.js";

import { broken, whole } from "./fixture.js";

const MANIFEST_URL = "https://registry.example/models/cifar10-resnet18/1.0.0/manifest.json";

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 정해둔 응답만 돌려주는 가짜 서버. 없는 주소는 404 다. */
function server(routes: Record<string, string | Uint8Array>): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const body = routes[url];
    if (body === undefined) return new Response("없음", { status: 404 });
    if (typeof body === "string") return new Response(body, { status: 200 });
    return new Response(body as unknown as BodyInit, { status: 200 });
  }) as typeof fetch;
}

/** 매니페스트가 말하는 것과 **정확히 일치하는** 가중치 한 벌. */
function cargo(): { bytes: Uint8Array; doc: Record<string, unknown> } {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 251;
  const doc = broken((d) => {
    const w = d["weights"] as Record<string, unknown>;
    w["bytes"] = bytes.length;
    w["sha256"] = sha256Of(bytes);
  });
  return { bytes, doc };
}

function rejects(run: () => Promise<unknown>, mentions: string): Promise<void> {
  return assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof BorchHubError, `BorchHubError 여야 합니다 — ${String(err)}`);
    assert.ok(
      err.message.includes(mentions),
      `메시지가 '${mentions}' 를 짚어야 합니다 — 받은 것: ${err.message}`,
    );
    return true;
  });
}

test("상대 주소는 매니페스트 자신을 기준으로 풀린다", () => {
  assert.equal(
    resolve(MANIFEST_URL, "sample.in.safetensors"),
    "https://registry.example/models/cifar10-resnet18/1.0.0/sample.in.safetensors",
  );
});

test("절대 주소는 그대로 둔다 — 가중치는 다른 집(CDN)에 산다", () => {
  const cdn = "https://models.example/a/model.safetensors";
  assert.equal(resolve(MANIFEST_URL, cdn), cdn);
});

test("매니페스트를 받아 그대로 읽는다", async () => {
  const doc = whole();
  const fetchStub = server({ [MANIFEST_URL]: JSON.stringify(doc) });
  const manifest = await fetchManifest(MANIFEST_URL, { fetch: fetchStub });
  assert.equal(manifest.name, "cifar10-resnet18");
  assert.equal(manifest.weights.bytes, 44_700_000);
});

test("매니페스트가 404 면 상태와 주소를 들고 멈춘다", async () => {
  await rejects(
    () => fetchManifest(MANIFEST_URL, { fetch: server({}) }),
    "404",
  );
});

test("받아온 매니페스트도 파서를 지난다 — 서버가 준 것이라고 봐주지 않는다", async () => {
  const bad = JSON.stringify(broken((d) => { d["origin"] = "누가-학습했는지-모름"; }));
  await rejects(
    () => fetchManifest(MANIFEST_URL, { fetch: server({ [MANIFEST_URL]: bad }) }),
    ".origin",
  );
});

test("길이와 해시가 맞으면 바이트가 나온다", async () => {
  const { bytes, doc } = cargo();
  const manifest = parseManifest(doc);
  const got = await fetchWeights(manifest, MANIFEST_URL, {
    fetch: server({ [manifest.weights.url]: bytes }),
    cache: false,
  });
  assert.deepEqual([...got], [...bytes]);
});

test("한 바이트만 달라도 해시에서 멈춘다 — 이 패키지가 있는 이유다", async () => {
  const { bytes, doc } = cargo();
  const manifest = parseManifest(doc);
  const tampered = new Uint8Array(bytes);
  tampered[100] = (tampered[100] ?? 0) ^ 1;
  await rejects(
    () => fetchWeights(manifest, MANIFEST_URL, {
      fetch: server({ [manifest.weights.url]: tampered }),
      cache: false,
    }),
    "해시가 다릅니다",
  );
});

test("길이가 다르면 해시를 재기 전에 멈춘다", async () => {
  const { bytes, doc } = cargo();
  const manifest = parseManifest(doc);
  await rejects(
    () => fetchWeights(manifest, MANIFEST_URL, {
      fetch: server({ [manifest.weights.url]: bytes.slice(0, 200) }),
      cache: false,
    }),
    "길이가 다릅니다",
  );
});

test("가중치가 404 면 그 주소를 말한다", async () => {
  const { doc } = cargo();
  const manifest = parseManifest(doc);
  await rejects(
    () => fetchWeights(manifest, MANIFEST_URL, { fetch: server({}), cache: false }),
    "404",
  );
});

test("가중치 주소가 상대면 매니페스트 옆에서 찾는다", async () => {
  const { bytes, doc } = cargo();
  (doc["weights"] as Record<string, unknown>)["url"] = "model.safetensors";
  const manifest = parseManifest(doc);
  const beside = "https://registry.example/models/cifar10-resnet18/1.0.0/model.safetensors";
  const got = await fetchWeights(manifest, MANIFEST_URL, {
    fetch: server({ [beside]: bytes }),
    cache: false,
  });
  assert.equal(got.length, bytes.length);
});

test("WebGPU 를 안 쓰는 모델은 어댑터 없이도 통과한다", async () => {
  const manifest = parseManifest(broken((d) => {
    (d["runtime"] as Record<string, unknown>)["webgpu"] = null;
  }));
  const report = await checkEnvironment(manifest);
  assert.equal(report.ok, true);
  assert.deepEqual(report.reasons, []);
});

test("required 가 거짓이면 요구하지 않는 것으로 읽는다", async () => {
  const manifest = parseManifest(broken((d) => {
    (d["runtime"] as Record<string, unknown>)["webgpu"] = { required: false, limits: {} };
  }));
  assert.equal((await checkEnvironment(manifest)).ok, true);
});

test("WebGPU 가 필요한데 없는 환경이면 이유를 들고 거절한다", async () => {
  // 노드에는 `navigator.gpu` 가 없다 — 이것이 WebGPU 없는 브라우저와 같은 자리다.
  const manifest = parseManifest(whole());
  const report = await checkEnvironment(manifest);
  assert.equal(report.ok, false);
  assert.ok(
    report.reasons.some((r) => r.includes("WebGPU")),
    `이유가 WebGPU 를 짚어야 합니다 — ${report.reasons.join(" / ")}`,
  );
});
