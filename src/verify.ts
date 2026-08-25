/**
 * 배지를 발급한다 — 샘플 입력을 넣어 매니페스트가 말한 출력이 나오는지 본다.
 *
 * ## 왜 받는 쪽이 다시 재는가
 *
 * 우리가 "이 모델은 됩니다" 라고 적어 보내면 그건 주장이다. 받는 쪽이 자기
 * 브라우저에서 같은 입력에 같은 값을 얻으면 그건 사실이다. 둘의 차이가 이 파일이
 * 존재하는 이유 전부다.
 *
 * ## 왜 정확도가 아니라 샘플인가
 *
 * 정확도를 다시 재려면 시험 세트 전체를 받아야 한다(CIFAR-10 만 30MB). 샘플 여덟
 * 장은 100KB 이고, **틀린 것을 잡는 힘은 거의 같다** — 가중치가 덜 실렸거나 층이
 * 어긋났거나 커널이 다르면 여덟 장에서 이미 갈린다. 조용히 지나가는 경우는 아주
 * 작은 수치 차이뿐이고, 그건 `rtol`·`atol` 이 다룰 일이다.
 */

import { decode, noGrad, nn, Tensor } from "borch-ts";

import { BorchHubError, type Manifest } from "./manifest.js";
import { resolve, type LoadOptions } from "./load.js";

export interface VerifyResult {
  readonly ok: boolean;
  /** 대조한 수의 개수. 0 이면 무언가 비어 있었던 것이지 통과가 아니다. */
  readonly count: number;
  readonly maxAbs: number;
  readonly maxRel: number;
  /** 가장 많이 어긋난 자리. 통과했으면 `null`. */
  readonly worst: { readonly at: number; readonly expected: number; readonly got: number } | null;
}

async function grabTensor(
  url: string, opts: LoadOptions, what: string,
): Promise<Tensor> {
  const get = opts.fetch ?? fetch;
  const res = await get(url);
  if (!res.ok) throw new BorchHubError(`${what} 을 받지 못했습니다: ${res.status} ${url}`);
  // 샘플 파일은 평평한 텐서 표다. 코어의 `load` 는 트리를 담은 `Savable` 을 주므로
  // 여기서는 평평한 표를 그대로 돌려주는 `decode` 를 쓴다.
  const bundle = decode(new Uint8Array(await res.arrayBuffer()));
  const names = Object.keys(bundle.tensors);
  const first = names[0] === undefined ? undefined : bundle.tensors[names[0]];
  if (first === undefined) throw new BorchHubError(`${what} 에 텐서가 없습니다: ${url}`);
  // **여러 개면 고르지 않는다.** 전에는 첫 번째를 집었는데, 그 '첫 번째' 는 파일에
  // 적힌 순서일 뿐이라 만드는 쪽이 순서를 바꾸면 배지가 다른 텐서를 대조하게 된다.
  // 그리고 그 사고는 조용하다 — 대조는 계속 통과한다.
  if (names.length > 1) {
    throw new BorchHubError(
      `${what} 에 텐서가 ${names.length} 개 있습니다 (${names.join(", ")}): ${url}\n`
      + "  어느 것을 대조해야 하는지 매니페스트가 말하지 않습니다.",
    );
  }
  return first;
}

/**
 * 모델을 샘플에 대 본다.
 *
 * **평가 모드로 둔다.** BatchNorm 이 학습 통계를 쓰면 값이 배치 구성에 따라 흔들려서,
 * 재는 것이 모델이 아니라 배치 운이 된다 — 그러면 같은 가중치가 어떤 날은 통과하고
 * 어떤 날은 아니다.
 */
export async function verify(
  model: nn.Module,
  manifest: Manifest,
  manifestUrl: string,
  opts: LoadOptions = {},
): Promise<VerifyResult> {
  const input = await grabTensor(
    resolve(manifestUrl, manifest.sample.inputUrl), opts, "샘플 입력");
  const expected = await grabTensor(
    resolve(manifestUrl, manifest.sample.outputUrl), opts, "샘플 출력");

  model.eval();
  const got = noGrad(() => model.forward(input));

  const a = await got.toArray();
  const b = await expected.toArray();
  if (a.length !== b.length) {
    throw new BorchHubError(
      `샘플 출력의 크기가 다릅니다: 기대 ${b.length} · 나온 것 ${a.length}\n`
      + "  모델이 매니페스트가 말하는 그 모델이 아닙니다.",
    );
  }

  const { rtol, atol } = manifest.sample;
  return compare(a, b, rtol, atol);
}

/**
 * 두 수열을 허용 오차로 대 본다. **모델도 네트워크도 안 탄다** — 그래서 노드에서
 * 검사할 수 있고, 이 파일에서 조용히 틀릴 수 있는 부분이 전부 여기 모여 있다.
 *
 * ## NaN 을 따로 다루는 이유
 *
 * `NaN` 은 어느 비교에서도 참이 아니다. 그래서 `abs > 허용치` 로만 판정하면 **전부
 * NaN 을 뱉는 모델이 통과한다** — 배지가 막아야 할 것 중 가장 명백한 것을 통과시킨다.
 * 가까운 것도 먼 것도 아니라 **수가 아닌 것**이므로, 여기서는 실패로 센다.
 */
export function compare(
  got: ArrayLike<number>, expected: ArrayLike<number>, rtol: number, atol: number,
): VerifyResult {
  // 셀 것이 없으면 통과가 아니다. 빈 파일과 통과한 대조는 다른 일이다.
  if (got.length === 0) {
    return { ok: false, count: 0, maxAbs: 0, maxRel: 0, worst: null };
  }

  let maxAbs = 0;
  let maxRel = 0;
  let ok = true;
  let worst: VerifyResult["worst"] = null;
  // **가장 많이 어긋난 자리는 절대차가 아니라 허용치를 넘은 폭으로 고른다.** 전에는
  // 절대차 최대를 들고 있었는데, 그러면 통과한 자리를 가리키면서 "여기가 제일
  // 어긋났다" 고 말할 수 있다 — 기대값이 작을 때 rtol 로 걸리는 자리가 그렇다.
  let worstMargin = -Infinity;

  for (let i = 0; i < got.length; i++) {
    const mine = got[i] ?? 0;
    const want = expected[i] ?? 0;

    if (!Number.isFinite(mine) || !Number.isFinite(want)) {
      ok = false;
      if (worstMargin < Infinity) {
        worstMargin = Infinity;
        worst = { at: i, expected: want, got: mine };
      }
      continue;
    }

    const abs = Math.abs(mine - want);
    const rel = Math.abs(want) === 0 ? abs : abs / Math.abs(want);
    if (abs > maxAbs) maxAbs = abs;
    if (rel > maxRel) maxRel = rel;

    const allowed = atol + rtol * Math.abs(want);
    if (abs > allowed) {
      ok = false;
      const margin = abs - allowed;
      if (margin > worstMargin) {
        worstMargin = margin;
        worst = { at: i, expected: want, got: mine };
      }
    }
  }

  return { ok, count: got.length, maxAbs, maxRel, worst: ok ? null : worst };
}
