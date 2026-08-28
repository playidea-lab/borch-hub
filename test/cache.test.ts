/**
 * **통(Cache API)에 관한 규칙**을 본다 — 무엇을 넣고, 언제 빼고, 꺼낸 것도 재는가.
 *
 * ## 노드에는 통이 없다
 *
 * `caches` 는 브라우저의 것이라 이 길은 지금까지 자동 검사가 닿은 적이 없다. 그런데
 * 여기서 지키려는 규칙은 저장소 구현이 아니라 **순서**다 — 재고 나서 넣는가, 틀린
 * 것을 빼는가. 순서는 통이 진짜가 아니어도 그대로 드러나므로, 아주 작은 가짜 통
 * 하나면 전부 볼 수 있다.
 *
 * ## 왜 이 규칙들인가
 *
 * 통은 **한 번 잘못 들어가면 영원히 산다.** 검사 전에 넣으면 틀린 바이트가 자리를
 * 잡고, 그다음부터는 받지도 않으면서 매번 같은 실패를 낸다 — 그리고 이 API 로는
 * 통을 비울 방법이 없다.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { fetchWeights } from "../src/load.js";
import { BorchHubError, parseManifest } from "../src/manifest.js";

import { broken } from "./fixture.js";

const MANIFEST_URL = "https://registry.example/models/x/1.0.0/manifest.json";

/** 열쇠 하나에 바이트 한 벌. 진짜 Cache API 에서 우리가 쓰는 넷만 흉내 낸다. */
class FakeBox {
  readonly kept = new Map<string, Uint8Array>();

  async match(url: string): Promise<Response | undefined> {
    const hit = this.kept.get(url);
    return hit === undefined ? undefined : new Response(hit as unknown as BodyInit);
  }

  async put(url: string, res: Response): Promise<void> {
    this.kept.set(url, new Uint8Array(await res.arrayBuffer()));
  }

  async delete(url: string): Promise<boolean> {
    return this.kept.delete(url);
  }
}

/**
 * **넣기를 거부하는 통.** 진짜 Cache API 가 그렇게 한다 — 한 항목의 크기에 제 나름의
 * 한계가 있고, 넘으면 `Failed to execute 'put' on 'Cache'` 로 던진다. 346MB 짜리
 * 화물에서 실측으로 걸렸다.
 */
class FullBox extends FakeBox {
  override async put(): Promise<void> {
    throw new Error("Failed to execute 'put' on 'Cache': Unexpected internal error.");
  }
}

/** 검사 하나 동안만 전역에 통을 놓는다. 끝나면 걷는다. */
function withBox(box: FakeBox): () => void {
  const holder = globalThis as { caches?: unknown };
  const before = holder.caches;
  holder.caches = { open: async (): Promise<FakeBox> => box };
  return () => { holder.caches = before; };
}

function cargo(): { bytes: Uint8Array; doc: Record<string, unknown> } {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 251;
  const doc = broken((d) => {
    const w = d["weights"] as Record<string, unknown>;
    w["bytes"] = bytes.length;
    w["sha256"] = createHash("sha256").update(bytes).digest("hex");
  });
  return { bytes, doc };
}

function serve(url: string, body: Uint8Array): { fetch: typeof fetch; calls: () => number } {
  let calls = 0;
  const f = (async (asked: RequestInfo | URL): Promise<Response> => {
    calls += 1;
    return String(asked) === url
      ? new Response(body as unknown as BodyInit, { status: 200 })
      : new Response("없음", { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls: () => calls };
}

test("검사를 지난 뒤에 통에 들어간다", async () => {
  const { bytes, doc } = cargo();
  const manifest = parseManifest(doc);
  const box = new FakeBox();
  const undo = withBox(box);
  try {
    await fetchWeights(manifest, MANIFEST_URL, {
      fetch: serve(manifest.weights.url, bytes).fetch,
    });
    assert.equal(box.kept.size, 1);
  } finally { undo(); }
});

test("틀린 바이트는 통에 자리를 못 잡는다", async () => {
  // 검사보다 먼저 넣으면 **틀린 것이 통에 들어가고**, 그다음부터는 받지도 않으면서
  // 매번 같은 실패를 낸다. 이 API 로는 통을 비울 방법이 없으므로 영구적이다.
  const { bytes, doc } = cargo();
  const manifest = parseManifest(doc);
  const wrong = new Uint8Array(bytes);
  wrong[7] = (wrong[7] ?? 0) ^ 1;
  const box = new FakeBox();
  const undo = withBox(box);
  try {
    await assert.rejects(
      () => fetchWeights(manifest, MANIFEST_URL, { fetch: serve(manifest.weights.url, wrong).fetch }),
      (err: unknown) => err instanceof BorchHubError,
    );
    assert.equal(box.kept.size, 0, "거절한 바이트가 통에 남으면 안 됩니다");
  } finally { undo(); }
});

test("통에 든 것도 다시 잰다 — 그리고 틀렸으면 빼낸다", async () => {
  // 통에 든 것을 믿으면, 한 번 잘못 들어간 바이트가 영원히 산다. 재기만 하고 안 빼도
  // 마찬가지다 — 다음 시도가 회복할 길이 없다.
  const { bytes, doc } = cargo();
  const manifest = parseManifest(doc);
  const box = new FakeBox();
  const rotten = new Uint8Array(bytes);
  rotten[3] = (rotten[3] ?? 0) ^ 0xff;
  box.kept.set(manifest.weights.url, rotten);

  const undo = withBox(box);
  try {
    const server = serve(manifest.weights.url, bytes);
    await assert.rejects(
      () => fetchWeights(manifest, MANIFEST_URL, { fetch: server.fetch }),
      (err: unknown) => {
        assert.ok(err instanceof BorchHubError);
        assert.match(err.message, /해시가 다릅니다/);
        return true;
      },
    );
    assert.equal(server.calls(), 0, "통에 있었으므로 받으러 가지 않습니다");
    assert.equal(box.kept.size, 0, "썩은 것은 빠져야 다음 시도가 회복합니다");

    // 빠졌으므로 이번에는 받아 오고, 통에는 옳은 것이 들어간다.
    const again = serve(manifest.weights.url, bytes);
    const got = await fetchWeights(manifest, MANIFEST_URL, { fetch: again.fetch });
    assert.deepEqual([...got], [...bytes]);
    assert.equal(again.calls(), 1);
    assert.equal(box.kept.size, 1);
  } finally { undo(); }
});

test("통에서 꺼낼 때도 진행률이 울린다", async () => {
  // 안 울리면 **캐시가 있는 사람에게만** 진행 막대가 0 에 멈춘 채 모델이 튀어나온다.
  const { bytes, doc } = cargo();
  const manifest = parseManifest(doc);
  const box = new FakeBox();
  box.kept.set(manifest.weights.url, bytes);

  const undo = withBox(box);
  try {
    const seen: Array<[number, number]> = [];
    const server = serve(manifest.weights.url, bytes);
    await fetchWeights(manifest, MANIFEST_URL, {
      fetch: server.fetch,
      onProgress: (received, total) => { seen.push([received, total]); },
    });
    assert.equal(server.calls(), 0);
    assert.deepEqual(seen, [[bytes.length, bytes.length]]);
  } finally { undo(); }
});

test("cache:false 면 통을 아예 안 쓴다", async () => {
  const { bytes, doc } = cargo();
  const manifest = parseManifest(doc);
  const box = new FakeBox();
  const undo = withBox(box);
  try {
    await fetchWeights(manifest, MANIFEST_URL, {
      fetch: serve(manifest.weights.url, bytes).fetch,
      cache: false,
    });
    assert.equal(box.kept.size, 0);
  } finally { undo(); }
});

test("진행률 콜백이 던져도 내려받기는 끝난다", async () => {
  // 진행 막대 하나가 45MB 를 버리면 안 된다. 받는 쪽은 자기가 무엇을 깨뜨렸는지도
  // 모른 채 "받다 실패" 만 본다.
  const { bytes, doc } = cargo();
  const manifest = parseManifest(doc);
  const got = await fetchWeights(manifest, MANIFEST_URL, {
    fetch: serve(manifest.weights.url, bytes).fetch,
    cache: false,
    onProgress: () => { throw new Error("받는 쪽 코드가 던졌다"); },
  });
  assert.deepEqual([...got], [...bytes]);
});

test("통에 못 넣어도 실린다", async () => {
  // **다 받고 길이도 해시도 맞았다.** 그 뒤에 통이 거부한 것은 받는 사람의 결과를
  // 바꾸지 않는다 — 다음 방문에 한 번 더 받을 뿐이다. 여기서 던지면 통과한 모델이
  // 실패로 끝나고, 그 실패 문구는 캐시를 가리키므로 아무도 원인을 안 믿는다.
  //
  // 그리고 이 실패는 **큰 화물에서만** 난다. 캐시가 가장 필요한 쪽에서만 죽는다.
  const { bytes, doc } = cargo();
  const manifest = parseManifest(doc);
  const box = new FullBox();
  const put = withBox(box);
  try {
    const got = await fetchWeights(manifest, MANIFEST_URL, {
      fetch: serve(manifest.weights.url, bytes).fetch,
    });
    assert.deepEqual([...got], [...bytes], "받은 바이트를 그대로 돌려줘야 합니다");
    assert.equal(box.kept.size, 0, "못 넣었으므로 통은 비어 있어야 합니다");
  } finally {
    put();
  }
});
