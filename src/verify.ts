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
  const first = Object.values(bundle.tensors)[0];
  if (first === undefined) throw new BorchHubError(`${what} 에 텐서가 없습니다: ${url}`);
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
  let maxAbs = 0;
  let maxRel = 0;
  let worst: VerifyResult["worst"] = null;
  let ok = true;
  for (let i = 0; i < a.length; i++) {
    const mine = a[i] ?? 0;
    const want = b[i] ?? 0;
    const abs = Math.abs(mine - want);
    const rel = Math.abs(want) === 0 ? abs : abs / Math.abs(want);
    if (abs > maxAbs) {
      maxAbs = abs;
      // 가장 어긋난 자리를 들고 있는다 — "안 맞는다" 만으로는 얼마나 안 맞는지,
      // 실린 것이 아예 다른 모델인지 수치 오차인지가 안 갈린다.
      worst = { at: i, expected: want, got: mine };
    }
    if (rel > maxRel) maxRel = rel;
    if (abs > atol + rtol * Math.abs(want)) ok = false;
  }

  return { ok, count: a.length, maxAbs, maxRel, worst: ok ? null : worst };
}
