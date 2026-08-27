/**
 * **목차를 읽는 자리**를 본다.
 *
 * 이 클라이언트의 입구는 오래 `load(주소)` 하나였다 — 쓰는 사람이 주소를 **이미 알고
 * 있어야** 했다는 뜻이다. 모델이 스물이 되고 나서야 그 구멍이 보였다.
 *
 * ## 무엇을 보는가
 *
 * 목차에는 스키마가 없다. 만드는 쪽(`build_index.py`)이 유일한 정의이므로, 여기서
 * 보는 것은 "정본과 같은가" 가 아니라 **"모양이 틀렸을 때 조용히 지나가지 않는가"** 다.
 * 필드 하나가 사라지면 `undefined` 를 들고 한참 안쪽까지 갔다가 엉뚱한 자리에서
 * 터지는 것이 기본 동작이고, 그것을 막는 것이 파서의 일이다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { BorchHubError } from "../src/manifest.js";
import { fetchIndex, newest, parseListing } from "../src/listing.js";

/** CDN 에 실제로 서 있는 모양 그대로. 줄이면 검사가 다른 것을 보게 된다. */
function whole(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    models: [
      {
        name: "cifar10-resnet18", version: "1.0.0", task: "image-classification",
        dataset: "cifar-10", tags: ["vision", "resnet"], origin: "trained-by-borch",
        bytes: 44_745_240,
        manifestUrl: "https://cdn.example/cifar10-resnet18/1.0.0/manifest.json",
        path: "models/cifar10-resnet18/1.0.0",
      },
      {
        name: "cifar10-resnet18", version: "1.0.1", task: "image-classification",
        dataset: "cifar-10", tags: ["vision", "resnet"], origin: "trained-by-borch",
        bytes: 44_745_240,
        manifestUrl: "https://cdn.example/cifar10-resnet18/1.0.1/manifest.json",
        path: "models/cifar10-resnet18/1.0.1",
      },
      {
        name: "imagenet-resnet50", version: "1.0.0", task: "image-classification",
        dataset: "imagenet-1k", tags: ["vision"], origin: "converted-from-torch",
        bytes: 102_000_000,
        manifestUrl: "https://cdn.example/imagenet-resnet50/1.0.0/manifest.json",
        path: "models/imagenet-resnet50/1.0.0",
      },
    ],
  };
}

function broken(mutate: (doc: Record<string, unknown>) => void): Record<string, unknown> {
  const doc = whole();
  mutate(doc);
  return doc;
}

test("온전한 목차를 읽는다", () => {
  const listing = parseListing(whole());
  assert.equal(listing.models.length, 3);
  const first = listing.models[0];
  assert.equal(first?.name, "cifar10-resnet18");
  assert.equal(first?.bytes, 44_745_240);
  assert.deepEqual([...(first?.tags ?? [])], ["vision", "resnet"]);
});

test("`path` 는 안 옮긴다", () => {
  // 레지스트리 저장소 안의 자리이지 받는 쪽이 쓸 주소가 아니다. 옮겨 두면 누군가
  // 그것으로 URL 을 짓고, **가중치 주소에서 매니페스트 주소를 유도하던 그 버그**가
  // 다시 생긴다.
  const first = parseListing(whole()).models[0] as unknown as Record<string, unknown>;
  assert.equal(first["path"], undefined);
});

test("필드가 빠지면 어디가 빠졌는지 말하고 멈춘다", () => {
  for (const key of ["name", "version", "manifestUrl"]) {
    const err = ((): unknown => {
      try {
        parseListing(broken((d) => {
          delete (d["models"] as Record<string, unknown>[])[0]?.[key];
        }));
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    assert.ok(err instanceof BorchHubError, `${key}: 우리 에러여야 합니다 — ${String(err)}`);
    assert.match(err.message, new RegExp(`models\\[0\\]\\.${key}`),
      `${key}: 어느 줄의 어느 칸인지 말해야 합니다 — ${err.message}`);
  }
});

test("`bytes` 가 수가 아니면 거절한다", () => {
  // 이것이 글로 들어오면 "45MB 를 받는다" 를 보여주는 화면이 `NaN MB` 를 그린다.
  assert.throws(
    () => parseListing(broken((d) => {
      (d["models"] as Record<string, unknown>[])[0]!["bytes"] = "44745240";
    })),
    BorchHubError,
  );
});

test("목차가 표가 아니면 거절한다", () => {
  assert.throws(() => parseListing([]), BorchHubError);
  assert.throws(() => parseListing(null), BorchHubError);
  assert.throws(() => parseListing({ schemaVersion: 1 }), BorchHubError);
});

test("이름마다 가장 높은 판만 남긴다", () => {
  const only = newest(parseListing(whole()));
  assert.equal(only.length, 2, "같은 모델이 두 번 보이면 안 됩니다");
  const cifar = only.find((m) => m.name === "cifar10-resnet18");
  assert.equal(cifar?.version, "1.0.1");
});

test("판을 수로 견준다 — 글로 견주면 1.0.10 이 1.0.9 보다 뒤진다", () => {
  const listing = parseListing(broken((d) => {
    const rows = d["models"] as Record<string, unknown>[];
    rows[0]!["version"] = "1.0.9";
    rows[1]!["version"] = "1.0.10";
  }));
  assert.equal(newest(listing).find((m) => m.name === "cifar10-resnet18")?.version, "1.0.10");
});

test("받다 실패하면 상태와 주소를 말한다", async () => {
  const url = "https://cdn.example/index.json";
  const missing = (async () => new Response("없음", { status: 404 })) as typeof fetch;
  await assert.rejects(
    () => fetchIndex(url, { fetch: missing }),
    (err: unknown) => err instanceof BorchHubError
      && err.message.includes("404") && err.message.includes(url),
  );
});

test("받아서 읽는다", async () => {
  const serve = (async () => new Response(JSON.stringify(whole()), { status: 200 })) as typeof fetch;
  const listing = await fetchIndex("https://cdn.example/index.json", { fetch: serve });
  assert.equal(listing.models.length, 3);
  assert.equal(newest(listing).length, 2);
});
