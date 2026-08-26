/**
 * **끊긴 자리부터 이어받는지** 본다.
 *
 * ## 왜 이것이 기능인가
 *
 * 45MB 를 90% 에서 놓치고 처음부터 받는 것은, 받는 쪽에게는 실패와 같다. 이미 받은
 * 바이트는 손에 있으므로 버릴 이유가 없다.
 *
 * ## 안전한 이유는 해시다
 *
 * 이어 붙이는 것은 위험해 보이지만, 붙인 결과는 **싣기 전에 매니페스트의 해시와**
 * 대조된다. 그 사이 서버의 파일이 바뀌었다면 이어 붙인 것이 어긋나고 그 자리에서
 * 걸린다. 그래서 이어받기가 새로 만드는 위험이 없다 — 이미 있던 관문을 그대로 지난다.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { fetchWeights } from "../src/load.js";
import { BorchHubError, parseManifest } from "../src/manifest.js";

import { broken } from "./fixture.js";

const MANIFEST_URL = "https://registry.example/models/x/1.0.0/manifest.json";

function cargo(): { bytes: Uint8Array; doc: Record<string, unknown> } {
  const bytes = new Uint8Array(600);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13) % 251;
  const doc = broken((d) => {
    const w = d["weights"] as Record<string, unknown>;
    w["bytes"] = bytes.length;
    w["sha256"] = createHash("sha256").update(bytes).digest("hex");
  });
  return { bytes, doc };
}

function rangeStart(init?: RequestInit): number {
  const asked = (init?.headers as Record<string, string> | undefined)?.["Range"];
  if (asked === undefined) return 0;
  return Number(/bytes=(\d+)-/.exec(asked)?.[1] ?? 0);
}

/** 조각을 흘리다 `dieAt` 바이트에서 조용해지는 몸통. */
function partial(slice: Uint8Array, dieAt: number | null): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      let sent = 0;
      while (sent < slice.length) {
        if (dieAt !== null && sent >= dieAt) {
          // 조용해진다 — 다만 끝은 있다(검사 프로세스가 안 끝나면 안 된다).
          await new Promise((r) => setTimeout(r, 2_000));
          break;
        }
        const next = slice.slice(sent, sent + 100);
        controller.enqueue(next);
        sent += next.length;
      }
      controller.close();
    },
  });
}

/**
 * 첫 연결은 `dieAt` 에서 멎고, 그다음부터는 청한 자리부터 끝까지 준다.
 *
 * `honourRange` 를 끄면 **Range 를 무시하고 전체를 200 으로** 준다 — 실제로 그러는
 * 서버가 있고, 그때 붙이면 앞부분이 두 번 들어간다.
 */
function flaky(bytes: Uint8Array, dieAt: number, honourRange = true): {
  fetch: typeof fetch; asked: () => number[];
} {
  const asked: number[] = [];
  const f = (async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const from = rangeStart(init);
    asked.push(from);
    if (from === 0) {
      return new Response(partial(bytes, dieAt), { status: 200 });
    }
    if (!honourRange) {
      return new Response(partial(bytes, null), { status: 200 });
    }
    return new Response(partial(bytes.slice(from), null), { status: 206 });
  }) as typeof fetch;
  return { fetch: f, asked: () => asked };
}

test("끊긴 자리부터 이어받아 온전한 바이트를 만든다", async () => {
  const { bytes, doc } = cargo();
  const manifest = parseManifest(doc);
  const server = flaky(bytes, 300);

  const got = await fetchWeights(manifest, MANIFEST_URL, {
    fetch: server.fetch, cache: false, timeoutMs: 60,
    onProgress: () => undefined,
  });

  assert.deepEqual([...got], [...bytes]);
  // 두 번 불렀고, 두 번째는 **멎은 자리**를 청했다.
  const calls = server.asked();
  assert.equal(calls.length, 2);
  assert.equal(calls[0], 0);
  assert.equal(calls[1], 300);
});

test("진행률이 이어받는 동안 뒤로 가지 않는다", async () => {
  // 이어받기가 0 부터 다시 세면 받는 쪽 막대가 뒤로 튄다. 손에 든 것을 세어야 한다.
  const { bytes, doc } = cargo();
  const seen: number[] = [];
  await fetchWeights(parseManifest(doc), MANIFEST_URL, {
    fetch: flaky(bytes, 300).fetch, cache: false, timeoutMs: 60,
    onProgress: (received) => { seen.push(received); },
  });
  for (let i = 1; i < seen.length; i++) {
    assert.ok((seen[i] ?? 0) > (seen[i - 1] ?? 0), `뒤로 갔습니다: ${seen.join(",")}`);
  }
  assert.equal(seen.at(-1), bytes.length);
});

test("서버가 Range 를 무시하면 붙이지 않고 처음부터 받는다", async () => {
  // 206 이 아니라 200 과 전체가 오는데 그것을 손에 든 것 뒤에 붙이면, 앞부분이 두 번
  // 들어간 바이트가 되고 **해시는 그것을 '변조' 라고 말한다** — 사실은 우리 잘못인데.
  const { bytes, doc } = cargo();
  const got = await fetchWeights(parseManifest(doc), MANIFEST_URL, {
    fetch: flaky(bytes, 300, false).fetch, cache: false, timeoutMs: 60,
    onProgress: () => undefined,
  });
  assert.deepEqual([...got], [...bytes]);
});

test("한 바이트도 못 받았으면 이어받지 않는다", async () => {
  // 이어받을 것이 없다. 다시 부르는 것과 같으므로, 거절을 그대로 올려 받는 쪽이
  // 판단하게 둔다.
  const { doc } = cargo();
  const asked: number[] = [];
  const dead = (async (_u: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    asked.push(rangeStart(init));
    return new Response("없음", { status: 503 });
  }) as typeof fetch;

  await assert.rejects(
    () => fetchWeights(parseManifest(doc), MANIFEST_URL, {
      fetch: dead, cache: false, timeoutMs: 60, onProgress: () => undefined,
    }),
    (err: unknown) => err instanceof BorchHubError && err.message.includes("503"),
  );
  assert.deepEqual(asked, [0], "한 번만 부릅니다");
});

test("이어받기 횟수를 다 쓰면 거절한다", async () => {
  // 매번 같은 자리에서 멎는 서버. 무한히 매달리지 않는다.
  const { bytes, doc } = cargo();
  const asked: number[] = [];
  const always = (async (_u: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const from = rangeStart(init);
    asked.push(from);
    return new Response(partial(bytes.slice(from), 100), { status: from > 0 ? 206 : 200 });
  }) as typeof fetch;

  await assert.rejects(
    () => fetchWeights(parseManifest(doc), MANIFEST_URL, {
      fetch: always, cache: false, timeoutMs: 60, resumes: 2,
      onProgress: () => undefined,
    }),
    (err: unknown) => err instanceof BorchHubError,
  );
  assert.equal(asked.length, 3, "처음 한 번 + 이어받기 두 번");
});

test("resumes:0 이면 이어받지 않는다", async () => {
  const { bytes, doc } = cargo();
  const server = flaky(bytes, 300);
  await assert.rejects(
    () => fetchWeights(parseManifest(doc), MANIFEST_URL, {
      fetch: server.fetch, cache: false, timeoutMs: 60, resumes: 0,
      onProgress: () => undefined,
    }),
    (err: unknown) => err instanceof BorchHubError,
  );
  assert.equal(server.asked().length, 1);
});
