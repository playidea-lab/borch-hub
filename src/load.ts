/**
 * 매니페스트를 읽고, 가중치를 받아, 카탈로그의 모델에 싣는다.
 *
 * ## 순서가 요점이다
 *
 * 환경 판정 → 받기 → 해시 대조 → 싣기. 앞의 둘이 뒤바뀌면 **45MB 를 받은 뒤에**
 * "이 브라우저에서는 안 됩니다" 라고 말하게 되고, 그건 배지가 아니라 사과다.
 * 해시를 싣기 전에 보는 것도 같은 이유다 — 모양이 맞는 틀린 바이트는 예외 없이
 * 실린다.
 *
 * ## fetch 를 받는 이유
 *
 * 프라이빗 모델·조직 계정·서명 URL 이 전부 이 훅 하나를 탄다. 지금 쓰는 데가
 * 없어도 시그니처에 자리를 비워 둔다 — 나중에 넣으면 이미 쓰고 있는 쪽이 깨진다.
 */

import { nn, VERSION } from "borch-ts";

import { sha256Hex } from "./hash.js";
import { BorchHubError, parseManifest, type Manifest } from "./manifest.js";
import { cannotBuild, createModelFor } from "./arch.js";

/** 받은 것을 다시 안 받으려고 쓰는 통. 판을 이름에 박아 규칙이 바뀌면 갈린다. */
const CACHE_NAME = "borch-hub-v1";

export interface LoadOptions {
  /** 인증이 필요한 자리를 위한 훅. 안 주면 전역 `fetch`. */
  readonly fetch?: typeof fetch;
  /** Cache API 로 재사용할지. 기본은 쓴다 — 45MB 를 새로고침마다 받을 이유가 없다. */
  readonly cache?: boolean;
  readonly onProgress?: (received: number, total: number) => void;
  /**
   * **정체로 보기까지의 시간(ms).** 전체 시간이 아니다.
   *
   * 45MB 에 총 시간 제한을 걸면 느린 연결을 끊게 된다 — 그리고 그 사람은 우리가
   * 왜 끊었는지 모른다. 재는 것은 **아무것도 안 오는 시간**이다: 응답이 시작되기까지,
   * 그리고 받는 도중 조각과 조각 사이. 그래야 느린 것과 멈춘 것이 갈린다.
   */
  readonly timeoutMs?: number;
  /**
   * 받다 끊겼을 때 **이어받기를 몇 번까지 시도할지.** 기본 2.
   *
   * 45MB 를 90% 에서 놓치고 처음부터 받는 것은 사용자에게 실패와 같다. 이미 받은
   * 바이트는 손에 있으므로, 끊긴 자리부터 `Range` 로 이어 붙인다.
   *
   * 이어 붙인 것이 옳은지는 **해시가 답한다** — 그 사이 서버의 파일이 바뀌었다면
   * 이어 붙인 결과가 어긋나고, 그것은 싣기 전에 걸린다.
   */
  readonly resumes?: number;
}

/** 기본 정체 시간. 30 초 동안 한 바이트도 안 오면 그 연결은 멈춘 것이다. */
export const STALL_MS = 30_000;

/**
 * 멈춘 연결을 **거절로 바꾼다.**
 *
 * 이것이 없으면 `load()` 는 끝나지도 거절하지도 않는다. 받는 쪽에는 그것이 가장 나쁜
 * 결과다 — 예외는 다룰 수 있지만 영원히 안 끝나는 약속은 다룰 수가 없다.
 */
function stalled(what: string, ms: number): BorchHubError {
  return new BorchHubError(
    `${what} — ${ms / 1000}초 동안 아무것도 오지 않았습니다.\n`
    + "  연결이 멈췄거나 서버가 답하지 않습니다. 느린 것이 아니라 **멎은 것**입니다.",
  );
}

/** 응답이 시작되기까지를 잰다. 몸통을 다 받는 시간은 여기서 안 센다. */
export async function begin(
  get: typeof fetch, url: string, what: string, ms: number,
  headers?: Record<string, string>,
): Promise<Response> {
  try {
    return await get(url, {
      signal: AbortSignal.timeout(ms),
      ...(headers === undefined ? {} : { headers }),
    });
  } catch (err) {
    // 가짜 fetch 는 두 번째 인자를 무시하기도 한다. 그때는 여기로 안 온다.
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw stalled(`${what} 을 받지 못했습니다`, ms);
    }
    throw err;
  }
}

/** 매니페스트 안의 상대 주소는 **매니페스트 자신을 기준**으로 푼다. */
export function resolve(base: string, ref: string): string {
  return new URL(ref, base).toString();
}

export async function fetchManifest(url: string, opts: LoadOptions = {}): Promise<Manifest> {
  const ms = opts.timeoutMs ?? STALL_MS;
  const res = await begin(opts.fetch ?? fetch, url, "매니페스트", ms);
  if (!res.ok) throw new BorchHubError(`매니페스트를 받지 못했습니다: ${res.status} ${url}`);
  return parseManifest(await res.json());
}

/**
 * 매니페스트가 요구하는 판을 **이 판이 만족하는지.** 만족하면 `null`, 아니면 이유.
 *
 * ## 아는 형식 하나만 안다
 *
 * 레지스트리에 실제로 쓰이는 것은 `>=X.Y.Z` 하나다. semver 의 나머지 문법(`^`·`~`·
 * `||`·범위 두 개)은 여기 없고, **모르는 형식은 추측하지 않고 거절한다.**
 *
 * 통과시키는 쪽으로 기울이지 않는 이유: 이 검사가 있는 자리는 **45MB 를 받기 전**이다.
 * 모르는 것을 통과시키면 못 돌 모델을 받게 하고, 그 실패는 훨씬 안쪽에서 난다. 반대로
 * 잘못 막으면 받는 쪽이 그 자리에서 무엇이 문제인지 읽는다 — 두 실수의 값이 다르다.
 *
 * 새 문법이 매니페스트에 필요해지는 날 여기 더한다. 그날까지 없는 것이 틀린 답보다 낫다.
 */
function tooOld(range: string, running: string): string | null {
  const asked = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  if (asked === null) {
    return `${range} 는 이 로더가 읽을 줄 아는 형식이 아닙니다 — '>=X.Y.Z' 만 압니다.\n`
      + "  추측해서 통과시키지 않습니다. 매니페스트를 그 형식으로 적어 주십시오.";
  }
  const have = /^(\d+)\.(\d+)\.(\d+)/.exec(running);
  if (have === null) return null; // 우리 판을 못 읽으면 대조할 수 없다 — 막지는 않는다

  for (let i = 1; i <= 3; i++) {
    const want = Number(asked[i]);
    const got = Number(have[i]);
    if (got > want) return null;
    if (got < want) {
      return `${range} 가 필요한데 이 borch-ts 는 ${running} 입니다.\n`
        + "  받기 전에 멈춥니다 — 실으면 더 안쪽에서 다른 말로 실패합니다.";
    }
  }
  return null;
}

export interface EnvironmentReport {
  readonly ok: boolean;
  /** 왜 안 되는지. 비어 있으면 된다. */
  readonly reasons: readonly string[];
  readonly adapter: string;
}

/**
 * **받기 전에** 이 브라우저에서 돌 수 있는지 본다.
 *
 * borch 의 `Device` 는 어댑터 한계를 밖으로 안 내놓는다(비공개 필드다). 그래서
 * `navigator.gpu` 에 직접 묻는다 — 우리가 보는 것은 borch 의 속사정이 아니라
 * **환경**이고, 그건 브라우저가 답할 자리다.
 */
export async function checkEnvironment(manifest: Manifest): Promise<EnvironmentReport> {
  // **이 런타임을 지원한다고 적혀 있는지 먼저 본다.** `ts` 가 비어 있으면 그 모델은
  // 파이썬 쪽만 두고 나간 것이다 — 가중치는 실리지만 이 라이브러리가 만들 층이 없다.
  // 판정을 받기 전에 하는 이유가 여기서도 같다: 45MB 를 받고 나서 알 일이 아니다.
  //
  if (manifest.runtime.ts === null) {
    return {
      ok: false,
      adapter: "(안 봄)",
      reasons: [
        `${manifest.name} 은 이 런타임(borch-ts)을 지원한다고 적혀 있지 않습니다`
        + (manifest.runtime.py !== null ? " — 파이썬 쪽만 있습니다" : ""),
      ],
    };
  }

  // **이제 범위를 본다.** 오래 못 봤다 — 코어가 자기 판을 안 내놓아서 대조할 것이
  // 없었고, 그동안 이 필드는 적히기만 하고 읽히지 않았다. `borch-ts` 0.2.3 이
  // `VERSION` 을 내보내면서 그 조건이 끝났다.
  const short = tooOld(manifest.runtime.ts, VERSION);
  if (short !== null) {
    return {
      ok: false,
      adapter: "(안 봄)",
      reasons: [short],
    };
  }

  // **카탈로그가 이 이름을 아는지도 여기서 본다.** 몰라도 `createModelFor` 가 알려
  // 주기는 한다 — 다만 그 자리는 가중치를 다 받고 해시까지 맞춘 뒤다. 45MB 를 쓰고
  // 나서 들을 일이 아니라는 것이 위 두 검사와 같은 이유다.
  //
  // 판을 묻지 않고 이름을 묻는다. 매니페스트에는 `bimm` 하한이 없고, 있다 해도
  // 카탈로그에 새 이름이 생길 때마다 낡는다. **있는지 없는지는 카탈로그가 안다.**
  const unbuildable = cannotBuild(manifest.arch);
  if (unbuildable !== null) {
    return { ok: false, adapter: "(안 봄)", reasons: [unbuildable] };
  }

  const need = manifest.runtime.webgpu;
  if (need === null || !need.required) {
    return { ok: true, reasons: [], adapter: "(WebGPU 를 요구하지 않음)" };
  }

  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (gpu === undefined) {
    return { ok: false, adapter: "(없음)", reasons: ["이 브라우저에 WebGPU 가 없습니다"] };
  }
  const adapter = await gpu.requestAdapter();
  if (adapter === null) {
    return {
      ok: false,
      adapter: "(어댑터 없음)",
      reasons: ["WebGPU 어댑터를 못 잡았습니다 — 드라이버가 막혔거나 헤드리스입니다"],
    };
  }

  const reasons: string[] = [];
  for (const [key, wanted] of Object.entries(need.limits)) {
    const got = (adapter.limits as unknown as Record<string, number | undefined>)[key];
    if (got === undefined) {
      reasons.push(`어댑터가 ${key} 를 안 알려줍니다`);
    } else if (got < wanted) {
      reasons.push(`${key}: ${wanted} 가 필요한데 이 어댑터는 ${got} 입니다`);
    }
  }
  const info = adapter.info as GPUAdapterInfo | undefined;
  const name = info ? `${info.vendor} / ${info.architecture || info.device}` : "(이름 없음)";
  return { ok: reasons.length === 0, reasons, adapter: name };
}

/**
 * 진행률을 알린다 — **부르는 쪽 코드가 던져도 내려받기는 계속한다.**
 *
 * 이 훅은 화면을 갱신하라는 뜻이지 내려받기의 일부가 아니다. 진행 막대 하나가 던졌다고
 * 45MB 를 버리면, 받는 쪽은 자기가 무엇을 깨뜨렸는지도 모른 채 "받다 실패" 만 본다.
 *
 * 삼키는 것이 이 저장소의 기본은 아니다. 여기서 삼키는 이유는 **이것이 알림이지
 * 결과가 아니기 때문**이고, 그 판단을 여기 적어 둔다.
 */
function tell(opts: LoadOptions, received: number, total: number): void {
  try {
    opts.onProgress?.(received, total);
  } catch {
    // 알림이 실패한 것과 내려받기가 실패한 것은 다른 일이다.
  }
}

/**
 * 가중치 바이트. **해시가 안 맞으면 던진다.**
 *
 * 캐시에 든 것도 해시를 다시 잰다. 통에 들어간 뒤에 바뀔 일이 없다고 믿는 것과
 * 재는 것은 비용 차이가 크지 않고, 안 재면 한 번 잘못 들어간 바이트가 영원히 산다.
 */
export async function fetchWeights(
  manifest: Manifest, manifestUrl: string, opts: LoadOptions = {},
): Promise<Uint8Array> {
  const url = resolve(manifestUrl, manifest.weights.url);
  const useCache = (opts.cache ?? true) && typeof caches !== "undefined";
  const box = useCache ? await caches.open(CACHE_NAME) : null;

  let bytes: Uint8Array | null = null;
  let fromCache = false;
  if (box) {
    const hit = await box.match(url);
    if (hit) {
      bytes = new Uint8Array(await hit.arrayBuffer());
      fromCache = true;
      // **통에서 꺼낸 것도 알린다.** 안 알리면 받는 쪽의 진행 막대가 0 에 멈춘 채로
      // 모델이 튀어나온다 — 캐시가 있는 사람에게만 화면이 고장 난 것처럼 보인다.
      tell(opts, bytes.length, manifest.weights.bytes);
    }
  }
  if (bytes === null) bytes = await download(url, manifest.weights.bytes, opts);

  try {
    await measure(bytes, manifest);
  } catch (err) {
    // **틀린 것이 통에 들어 있었으면 빼낸다.** 안 그러면 그 통이 같은 실패를 영원히
    // 내놓고, 받는 쪽에는 통을 비울 방법이 없다 — 재는 것만으로는 부족하다.
    if (fromCache && box) await box.delete(url);
    throw err;
  }

  // **검사를 지난 뒤에 넣는다.** 전에는 받자마자 넣었는데, 그러면 틀린 바이트가 먼저
  // 통에 들어가고 검사는 그 다음에 실패했다.
  if (box && !fromCache) await box.put(url, new Response(bytes as unknown as BodyInit));
  return bytes;
}

/** 길이와 해시. 둘 다 **싣기 전에** 본다. */
async function measure(bytes: Uint8Array, manifest: Manifest): Promise<void> {
  if (bytes.length !== manifest.weights.bytes) {
    throw new BorchHubError(
      `가중치 길이가 다릅니다: 매니페스트 ${manifest.weights.bytes} · 받은 것 ${bytes.length}`,
    );
  }
  const got = await sha256Hex(bytes);
  if (got !== manifest.weights.sha256) {
    throw new BorchHubError(
      "가중치 해시가 다릅니다 — 이 바이트는 매니페스트가 말하는 것이 아닙니다.\n"
      + `  매니페스트 ${manifest.weights.sha256}\n  받은 것   ${got}`,
    );
  }
}

/**
 * 다음 조각, 아니면 거절.
 *
 * `reader.read()` 는 연결이 멎어도 그냥 기다린다. 여기서 시계를 붙여 **기다림을
 * 거절로 바꾼다**, 그리고 어디까지 받았는지를 함께 말한다 — 몇 바이트에서 멎었는지가
 * 없으면 받는 쪽은 자기 연결이 문제인지 우리 서버가 문제인지 가릴 수 없다.
 */
async function nextChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  received: number, expected: number, ms: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // **거절이 먼저다.** `cancel()` 이 앞서면 기다리던 `read()` 가 `{done:true}` 로
      // 풀리면서 경주에서 이기고, 그러면 멎은 내려받기가 **정상 종료로 읽힌다** —
      // 받은 바이트가 우연히 다 차 있으면 그대로 통과한다(실측으로 걸렸다).
      // 다 받았는데 안 끝나는 것과, 오다 만 것은 **받는 쪽이 할 일이 다르다.**
      // 앞은 다시 부르면 되고, 뒤는 연결이나 서버를 봐야 한다. 한 문장으로 뭉뚱그리면
      // "512/512 바이트인데 아무것도 오지 않았습니다" 같은 말이 된다.
      reject(received >= expected
        ? new BorchHubError(
          `가중치를 다 받았는데 연결이 닫히지 않았습니다 (${received}/${expected} 바이트).\n`
          + `  ${ms / 1000}초를 더 기다렸습니다. 다시 불러 보십시오.`,
        )
        : stalled(`가중치를 받다 멈췄습니다 (${received}/${expected} 바이트)`, ms));
      // 그 다음에 소켓을 놓는다. 안 놓으면 거절한 뒤에도 연결이 남는다.
      void reader.cancel().catch(() => undefined);
    }, ms);
  });
  try {
    return await Promise.race([reader.read(), clock]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 바이트를 받는다. **읽는 대로 진행률을 알린다.**
 *
 * 전에는 `arrayBuffer()` 로 통째로 받은 뒤에 콜백을 한 번 불렀다. 45MB 동안 0 이다가
 * 끝나는 순간 100 이 되는 진행률은 진행률이 아니다 — 받는 쪽은 그 사이를 멈춘 것과
 * 구별하지 못한다.
 *
 * 몸통을 스트림으로 못 주는 자리(일부 폴리필·가짜 fetch)도 있어서, 없으면 통째로
 * 받는 옛 길로 돌아간다.
 */
async function download(
  url: string, expected: number, opts: LoadOptions,
): Promise<Uint8Array> {
  const ms = opts.timeoutMs ?? STALL_MS;
  const allowed = opts.resumes ?? 2;
  const chunks: Uint8Array[] = [];
  let received = 0;
  let resumed = 0;

  for (;;) {
    try {
      received = await pull(url, expected, received, chunks, opts, ms);
      break;
    } catch (err) {
      // **던진 `pull` 은 돌려주는 값이 없다.** 그러니 받은 양은 반환값이 아니라 손에
      // 남은 조각에서 센다 — 이것을 빠뜨리면 이어받기가 영영 안 걸린다(실측).
      received = held(chunks);
      // 한 바이트도 없으면 이어받을 것도 없다. 처음부터 다시 받는 것과 같으므로,
      // 거절을 그대로 올려 받는 쪽이 판단하게 둔다.
      if (received === 0 || resumed >= allowed) throw err;
      resumed += 1;
    }
  }

  const all = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all;
}

/** 손에 든 바이트. 끊긴 뒤 어디서부터 이어받을지가 여기서 나온다. */
function held(chunks: readonly Uint8Array[]): number {
  let sum = 0;
  for (const chunk of chunks) sum += chunk.length;
  return sum;
}

/**
 * 한 번의 연결로 **끊긴 자리부터** 받는다. 받은 조각은 `chunks` 에 이어 붙이고 총량을
 * 돌려준다.
 *
 * ## 서버가 `Range` 를 무시할 수 있다
 *
 * 그때는 206 이 아니라 200 과 함께 **파일 전체**가 온다. 손에 든 것 뒤에 그것을 붙이면
 * 앞부분이 두 번 들어간 바이트가 되고, 해시는 그것을 "변조" 라고 말하게 된다 — 사실은
 * 우리가 잘못 이어 붙인 것인데. 그래서 200 을 보면 **들고 있던 것을 버리고 처음부터**
 * 받는다.
 */
async function pull(
  url: string, expected: number, from: number,
  chunks: Uint8Array[], opts: LoadOptions, ms: number,
): Promise<number> {
  const res = await begin(
    opts.fetch ?? fetch, url, "가중치", ms,
    from > 0 ? { Range: `bytes=${from}-` } : undefined,
  );
  if (!res.ok) throw new BorchHubError(`가중치를 받지 못했습니다: ${res.status} ${url}`);

  let received = from;
  if (from > 0 && res.status !== 206) {
    // 이어받기를 청했는데 전체가 왔다. 붙이지 않고 다시 센다.
    chunks.length = 0;
    received = 0;
  }

  const body = res.body;
  if (body === null || opts.onProgress === undefined) {
    const whole = new Uint8Array(await res.arrayBuffer());
    chunks.push(whole);
    received += whole.length;
    tell(opts, received, expected);
    return received;
  }

  const reader = body.getReader();
  for (;;) {
    // **조각과 조각 사이**를 잰다. 총 시간이 아니므로, 계속 오기만 하면 한 시간짜리
    // 내려받기도 안 끊긴다 — 끊기는 것은 오지 않을 때뿐이다.
    const { done, value } = await nextChunk(reader, received, expected, ms);
    if (done) break;
    chunks.push(value);
    received += value.length;
    // 매니페스트가 말한 수를 그대로 넘긴다. 서버의 content-length 를 쓰면 그것이
    // 거짓일 때 진행률이 100 을 넘거나 못 미치는데, **매니페스트는 이미 검사 대상**이다.
    tell(opts, received, expected);
  }
  return received;
}

export interface Loaded {
  readonly manifest: Manifest;
  readonly model: nn.Module;
  readonly environment: EnvironmentReport;
}

/**
 * 매니페스트 주소 하나로 돌 준비가 된 모델까지.
 *
 * **`await init()` 이 먼저다** — 층이 곧 텐서다. 안 부르고 오면 코어가 그 자리에서
 * 멈추고, 그 문구를 우리 말로 바꾸지 않는다.
 */
export async function load(manifestUrl: string, opts: LoadOptions = {}): Promise<Loaded> {
  const { decode } = await import("borch-ts");
  const manifest = await fetchManifest(manifestUrl, opts);

  const environment = await checkEnvironment(manifest);
  if (!environment.ok) {
    throw new BorchHubError(
      `이 브라우저에서는 ${manifest.name} 을 못 돌립니다:\n`
      + environment.reasons.map((r) => `  ${r}`).join("\n"),
    );
  }

  const bytes = await fetchWeights(manifest, manifestUrl, opts);
  const model = createModelFor(manifest.arch);
  // `load` 가 아니라 `decode` 다. 코어의 `load` 는 저장할 때의 트리를 그대로 돌려주므로
  // 반환형이 `Savable` 이고, 평평한 표를 꺼내려면 부르는 자리마다 좁혀야 한다. 가중치
  // 파일은 언제나 평평한 상태사전이다 — 남이 만든 safetensors 도 그렇다.
  model.loadStateDict(decode(bytes).tensors);
  return { manifest, model, environment };
}
