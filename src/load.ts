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

import { nn } from "borch";

import { sha256Hex } from "./hash.js";
import { BorchHubError, parseManifest, type Manifest } from "./manifest.js";
import { createModelFor } from "./models/registry.js";

/** 받은 것을 다시 안 받으려고 쓰는 통. 판을 이름에 박아 규칙이 바뀌면 갈린다. */
const CACHE_NAME = "borch-hub-v1";

export interface LoadOptions {
  /** 인증이 필요한 자리를 위한 훅. 안 주면 전역 `fetch`. */
  readonly fetch?: typeof fetch;
  /** Cache API 로 재사용할지. 기본은 쓴다 — 45MB 를 새로고침마다 받을 이유가 없다. */
  readonly cache?: boolean;
  readonly onProgress?: (received: number, total: number) => void;
}

/** 매니페스트 안의 상대 주소는 **매니페스트 자신을 기준**으로 푼다. */
export function resolve(base: string, ref: string): string {
  return new URL(ref, base).toString();
}

export async function fetchManifest(url: string, opts: LoadOptions = {}): Promise<Manifest> {
  const get = opts.fetch ?? fetch;
  const res = await get(url);
  if (!res.ok) throw new BorchHubError(`매니페스트를 받지 못했습니다: ${res.status} ${url}`);
  return parseManifest(await res.json());
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
 * 가중치 바이트. **해시가 안 맞으면 던진다.**
 *
 * 캐시에 든 것도 해시를 다시 잰다. 통에 들어간 뒤에 바뀔 일이 없다고 믿는 것과
 * 재는 것은 비용 차이가 크지 않고, 안 재면 한 번 잘못 들어간 바이트가 영원히 산다.
 */
export async function fetchWeights(
  manifest: Manifest, manifestUrl: string, opts: LoadOptions = {},
): Promise<Uint8Array> {
  const url = resolve(manifestUrl, manifest.weights.url);
  const get = opts.fetch ?? fetch;
  const useCache = (opts.cache ?? true) && typeof caches !== "undefined";

  let bytes: Uint8Array | null = null;
  const box = useCache ? await caches.open(CACHE_NAME) : null;
  if (box) {
    const hit = await box.match(url);
    if (hit) bytes = new Uint8Array(await hit.arrayBuffer());
  }

  if (bytes === null) {
    const res = await get(url);
    if (!res.ok) throw new BorchHubError(`가중치를 받지 못했습니다: ${res.status} ${url}`);
    const buf = await res.arrayBuffer();
    bytes = new Uint8Array(buf);
    opts.onProgress?.(bytes.length, manifest.weights.bytes);
    if (box) await box.put(url, new Response(buf));
  }

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
  return bytes;
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
  const { load: loadBundle } = await import("borch");
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
  model.loadStateDict(loadBundle(bytes).tensors);
  return { manifest, model, environment };
}
