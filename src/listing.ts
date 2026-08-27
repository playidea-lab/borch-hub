/**
 * **무엇이 있는지 묻는 자리.**
 *
 * ## 왜 이것이 없으면 허브가 아닌가
 *
 * 이 클라이언트의 입구는 `load(매니페스트 주소)` 하나였다. 즉 **쓰는 사람이 그 주소를
 * 이미 알고 있어야 한다.** 모델이 하나일 때는 안 보이던 구멍이고, 스물이 되는 순간
 * "무엇이 있는지" 를 물을 곳이 없다는 것이 드러난다.
 *
 * 레지스트리는 목차를 이미 만들어 CDN 에 세워 두었다. 읽는 쪽이 없었을 뿐이다.
 *
 * ## 정본은 만드는 쪽이다
 *
 * 매니페스트와 달리 목차에는 스키마가 없다 — `borch-hub-registry/scripts/build_index.py`
 * 가 유일한 정의다. 그래서 여기서 **세 번째 사본을 만들지 않는다.** 대신 들어온 것을
 * 그 자리에서 검사하고, 모양이 다르면 어디가 다른지 말하고 멈춘다.
 *
 * 매니페스트 쪽처럼 스키마를 받아 대조하지 않는 이유는 읽는 쪽이 여기 하나뿐이기
 * 때문이다. 만드는 쪽이 필드를 바꾸면 이 파서가 던진다 — 조용히 지나가지 않는다.
 *
 * ## `path` 를 안 옮긴다
 *
 * 목차에는 `models/<이름>/<판>` 이 같이 들어 있다. 그것은 레지스트리 저장소 안의
 * 자리이지 받는 쪽이 쓸 주소가 아니다. 옮겨 두면 누군가 그것으로 URL 을 짓게 되고,
 * 그 순간 **가중치 주소에서 매니페스트 주소를 유도하던 그 버그**가 다시 생긴다.
 * 받는 쪽이 쓸 것은 `manifestUrl` 하나다.
 */

import { begin, STALL_MS, type LoadOptions } from "./load.js";
import { BorchHubError } from "./manifest.js";

/** 목차 한 줄 — **받기 전에 고르는 데 필요한 것까지만.** */
export interface Listed {
  readonly name: string;
  readonly version: string;
  readonly task: string | null;
  readonly dataset: string | null;
  readonly tags: readonly string[];
  /** `trained-by-borch` 또는 `converted-from-torch`. 남에게서 온 것인지가 여기 있다. */
  readonly origin: string | null;
  /** 가중치 크기. 고르는 사람이 받기 전에 알아야 하는 유일한 수다. */
  readonly bytes: number;
  readonly manifestUrl: string;
}

export interface Listing {
  readonly schemaVersion: number;
  readonly models: readonly Listed[];
}

function fail(where: string, said: string): never {
  throw new BorchHubError(`목차의 ${where}: ${said}`);
}

function textOrNull(doc: Record<string, unknown>, key: string, where: string): string | null {
  const value = doc[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(`${where}.${key}`, "글이어야 합니다");
  return value;
}

function text(doc: Record<string, unknown>, key: string, where: string): string {
  const value = textOrNull(doc, key, where);
  if (value === null) fail(`${where}.${key}`, "빠졌습니다");
  return value;
}

function row(raw: unknown, at: number): Listed {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`models[${at}]`, "표여야 합니다");
  }
  const doc = raw as Record<string, unknown>;
  const where = `models[${at}]`;
  const bytes = doc["bytes"];
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) {
    fail(`${where}.bytes`, "수여야 합니다");
  }
  const tags = doc["tags"];
  if (tags !== undefined && tags !== null && !Array.isArray(tags)) {
    fail(`${where}.tags`, "목록이어야 합니다");
  }
  return {
    name: text(doc, "name", where),
    version: text(doc, "version", where),
    task: textOrNull(doc, "task", where),
    dataset: textOrNull(doc, "dataset", where),
    tags: tags === undefined || tags === null
      ? []
      : (tags as unknown[]).map((t, i) => {
        if (typeof t !== "string") fail(`${where}.tags[${i}]`, "글이어야 합니다");
        return t;
      }),
    origin: textOrNull(doc, "origin", where),
    bytes,
    manifestUrl: text(doc, "manifestUrl", where),
  };
}

export function parseListing(raw: unknown): Listing {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail("뿌리", "표여야 합니다");
  }
  const doc = raw as Record<string, unknown>;
  const version = doc["schemaVersion"];
  if (typeof version !== "number") fail("schemaVersion", "수여야 합니다");
  const models = doc["models"];
  if (!Array.isArray(models)) fail("models", "목록이어야 합니다");
  return { schemaVersion: version, models: models.map(row) };
}

/**
 * 목차를 받아 온다.
 *
 * `load` 와 같은 훅(`fetch`·`timeoutMs`)을 받는다 — 목차만 다른 규칙으로 받으면
 * 서명 URL 을 쓰는 쪽이 여기서만 막힌다.
 */
export async function fetchIndex(url: string, opts: LoadOptions = {}): Promise<Listing> {
  const res = await begin(opts.fetch ?? fetch, url, "목차", opts.timeoutMs ?? STALL_MS);
  if (!res.ok) throw new BorchHubError(`목차를 받지 못했습니다: ${res.status} ${url}`);
  return parseListing(await res.json());
}

/** 판을 수로 견준다. 글로 견주면 `1.0.10` 이 `1.0.9` 보다 앞선다. */
function ahead(a: string, b: string): boolean {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    // 수가 아닌 판은 견주지 않는다 — 모르는 것을 앞선다고도 뒤진다고도 안 한다.
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * 이름마다 **가장 높은 판만** 남긴다.
 *
 * 목차는 나간 판을 전부 들고 있다 — 옛 주소가 죽으면 안 되기 때문이다. 그래서
 * 그대로 늘어놓으면 같은 모델이 두 번 보인다(지금 스물 중 열이 그렇다). 고르는
 * 화면을 만드는 쪽이 매번 이 코드를 다시 쓰게 두지 않는다.
 */
export function newest(listing: Listing): readonly Listed[] {
  const best = new Map<string, Listed>();
  for (const model of listing.models) {
    const seen = best.get(model.name);
    if (seen === undefined || ahead(model.version, seen.version)) best.set(model.name, model);
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}
