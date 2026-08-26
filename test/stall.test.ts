/**
 * **멎은 연결이 거절로 바뀌는지** 본다.
 *
 * ## 왜 총 시간이 아니라 정체 시간인가
 *
 * 45MB 에 총 시간 제한을 걸면 느린 연결을 끊게 된다 — 그리고 끊긴 사람은 우리가 왜
 * 끊었는지 모른다. 여기서 재는 것은 **아무것도 안 오는 시간**이고, 그래야 느린 것과
 * 멎은 것이 갈린다. 아래 세 번째 검사가 정확히 그 차이를 지킨다: 조각이 계속 오기만
 * 하면 **총 시간이 제한을 넘어도 안 끊긴다.**
 *
 * ## 이것이 없으면 무슨 일이 나는가
 *
 * `fetch` 도 `reader.read()` 도 연결이 멎으면 그냥 기다린다. 그러면 `load()` 는 끝나지도
 * 거절하지도 않는다. **받는 쪽에는 그것이 가장 나쁜 결과다** — 예외는 다룰 수 있지만
 * 영원히 안 끝나는 약속은 다룰 수가 없다.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { fetchManifest, fetchWeights } from "../src/load.js";
import { BorchHubError, parseManifest } from "../src/manifest.js";

import { broken } from "./fixture.js";

const MANIFEST_URL = "https://registry.example/models/x/1.0.0/manifest.json";
/** 검사가 실제로 기다리는 시간이다. 짧게 둔다 — 재는 것은 길이가 아니라 동작이다. */
const SOON = 60;

function cargo(): { bytes: Uint8Array; doc: Record<string, unknown> } {
  const bytes = new Uint8Array(512);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 251;
  const doc = broken((d) => {
    const w = d["weights"] as Record<string, unknown>;
    w["bytes"] = bytes.length;
    w["sha256"] = createHash("sha256").update(bytes).digest("hex");
  });
  return { bytes, doc };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * **이벤트 루프를 붙잡아 두는 손잡이.**
 *
 * 진짜 내려받기는 소켓이 열려 있어서 노드가 "할 일이 남았다" 고 안다. 가짜 서버에는
 * 그것이 없어서, 기다리는 것이 우리 약속 하나뿐이면 루프가 비어 버리고 노드는
 * **아직 안 끝난 약속을 끝난 것으로 친다**(`Promise resolution is still pending but the
 * event loop has already resolved`).
 *
 * 게다가 `AbortSignal.timeout()` 의 시계는 루프를 안 붙잡는다(unref). 그래서 붙잡는
 * 일은 여기서 한다 — 검사가 코드가 아니라 하네스 때문에 갈리면 안 된다.
 */
function holdLoop(): () => void {
  const handle = setInterval(() => undefined, 1_000);
  return () => clearInterval(handle);
}

/** 영원히 답하지 않는 서버. 부른 쪽이 준 signal 을 지킨다. */
const silent = (async (_url: string, init?: RequestInit): Promise<Response> => {
  const release = holdLoop();
  try {
    await new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  } finally {
    release();
  }
  throw new Error("여기 오면 안 된다");
}) as unknown as typeof fetch;

/** 조각을 `gap` 간격으로 `count` 개 보내고, 그 뒤로는 조용해지는 서버. */
function trickle(
  bytes: Uint8Array, count: number, gap: number, thenSilent: boolean, send = count,
): typeof fetch {
  return (async (): Promise<Response> => new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller): Promise<void> {
        for (let i = 0; i < send; i++) {
          await sleep(gap);
          const size = Math.ceil(bytes.length / count);
          controller.enqueue(bytes.slice(i * size, (i + 1) * size));
        }
        // 조용해진다 — 다만 **끝은 있다.** 영원히 기다리면 그 약속은 풀리지 않고,
        // 루프를 붙잡아 둔 시계도 영영 안 꺼져서 검사 프로세스가 안 끝난다.
        // 제한(수십 ms)보다 한참 길기만 하면 재려는 것은 그대로 재어진다.
        if (thenSilent) await sleep(2_000);
        controller.close();
      },
    }),
    { status: 200 },
  )) as unknown as typeof fetch;
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

test("답 없는 서버에서 매니페스트를 기다리지 않는다", async () => {
  await rejects(
    () => fetchManifest(MANIFEST_URL, { fetch: silent, timeoutMs: SOON }),
    "아무것도 오지 않았습니다",
  );
});

test("가중치도 응답이 시작되지 않으면 거절한다", async () => {
  const { doc } = cargo();
  await rejects(
    () => fetchWeights(parseManifest(doc), MANIFEST_URL, {
      fetch: silent, cache: false, timeoutMs: SOON,
    }),
    "아무것도 오지 않았습니다",
  );
});

test("받다가 멎으면 어디까지 받았는지를 들고 거절한다", async () => {
  // 절반쯤 오다 조용해지는 연결. 이것이 이 검사의 요점이다 — 응답은 시작됐으므로
  // 시작만 재는 시계로는 안 잡힌다.
  const { bytes, doc } = cargo();
  const manifest = parseManifest(doc);
  await rejects(
    () => fetchWeights(manifest, MANIFEST_URL, {
      // 절반만 보내고 조용해진다. 다 받고 안 닫히는 것과 갈라야 하므로 **덜 온 채로**
      // 멎어야 한다.
      fetch: trickle(bytes, 4, 5, true, 2),
      cache: false,
      timeoutMs: SOON,
      onProgress: () => undefined,
    }),
    "받다 멈췄습니다",
  );
});

test("다 받았는데 안 닫히는 것은 다른 말로 말한다", async () => {
  // 받는 쪽이 할 일이 다르다 — 이쪽은 그냥 다시 부르면 된다.
  const { bytes, doc } = cargo();
  await rejects(
    () => fetchWeights(parseManifest(doc), MANIFEST_URL, {
      fetch: trickle(bytes, 2, 5, true),
      cache: false,
      timeoutMs: SOON,
      onProgress: () => undefined,
    }),
    "연결이 닫히지 않았습니다",
  );
});

test("느린 것은 안 끊는다 — 조각이 계속 오면 총 시간이 넘어도 된다", async () => {
  // 조각 8 개를 40ms 간격으로 = 총 320ms 이고, 제한은 60ms 다. **총 시간으로 쟀다면
  // 끊긴다.** 조각 사이가 40ms 라 안 끊기는 것이 이 설계의 전부다.
  const { bytes, doc } = cargo();
  const manifest = parseManifest(doc);
  const seen: number[] = [];
  const got = await fetchWeights(manifest, MANIFEST_URL, {
    fetch: trickle(bytes, 8, 40, false),
    cache: false,
    timeoutMs: SOON,
    onProgress: (received) => { seen.push(received); },
  });
  assert.deepEqual([...got], [...bytes]);
  assert.ok(seen.length > 1, "조각마다 진행률이 울려야 합니다");
});

test("메시지가 느린 것이 아니라 멎은 것이라고 말한다", async () => {
  // 받는 쪽이 다음에 무엇을 할지가 이 한 문장에서 갈린다 — 기다릴 것인가, 다시
  // 부를 것인가. "느립니다" 라고 하면 사람은 기다린다.
  await assert.rejects(
    () => fetchManifest(MANIFEST_URL, { fetch: silent, timeoutMs: SOON }),
    (err: unknown) => {
      assert.ok(err instanceof BorchHubError);
      assert.match(err.message, /멎은 것/);
      assert.match(err.message, /0\.06초/);
      return true;
    },
  );
});
