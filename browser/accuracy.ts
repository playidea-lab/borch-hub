/**
 * **매니페스트가 말한 대로 사진을 넣어, 얼마나 맞히는지 잰다.**
 *
 * ## 지금 매니페스트에 수가 없다
 *
 * 나가 있는 모델 열 중 여덟에 `metrics` 가 비어 있다. 우리가 학습한 것에만 있고,
 * timm 에서 옮긴 것에는 없다. 그래서 고르는 사람이 볼 수 있는 것은 "샘플 한 장을
 * 재현한다" 는 배지뿐인데, 그것은 **변환이 충실하다**는 증거지 **얼마나 맞히느냐**
 * 가 아니다.
 *
 * ## 왜 이 저장소인가
 *
 * 재는 것은 `사진 → 매니페스트의 전처리 → 카탈로그의 모델` 이다. 전처리를 아는 것은
 * 허브고 모델을 아는 것은 카탈로그인데, **카탈로그는 매니페스트를 몰라야 한다**
 * (의존은 한 방향으로만 흐른다). 셋을 다 아는 자리는 여기뿐이다.
 *
 * ## 왜 이것이 `roundtrip` 과 따로 있나
 *
 * 되싣기는 **사슬이 이어지는가**를 한 장으로 묻는다 — 1 분 안에 끝나야 하고, CI 가
 * 볼 수 있어야 한다. 이 파일은 **수를 하나 만든다** — 천 장을 돌고 몇 분이 걸린다.
 * 한 파일에 넣으면 둘 중 하나가 다른 하나의 주기를 따라가게 된다.
 *
 * ## timm 이 여기 없는 이유
 *
 * 라벨이 있으므로 **남과 견주지 않고 직접 잰다.** timm 이 발표한 수를 옮겨 적는 길도
 * 있었지만, 그것은 timm 의 런타임에서 timm 의 가중치가 낸 수지 **우리 변환의 수가
 * 아니다.** 측정된 것처럼 읽히는데 측정 안 한 값을 적지 않는다.
 *
 * ## 브라우저가 JPEG 을 푸는 방식은 PIL 과 다를 수 있다
 *
 * 크로마 업샘플링과 색 관리가 갈릴 자리다. 그래서 여기서 나온 수는 **이 파이프라인의
 * 수**이지 timm 의 수와 소수점까지 같아야 하는 값이 아니다. 그리고 그것이 맞다 —
 * 받는 사람이 브라우저에서 실제로 겪는 것이 이 파이프라인이다.
 */

import { init, noGrad, scope, vision } from "borch-ts";

import { load, transformFor } from "../src/index.js";

/** 판정이 나가는 통로. `roundtrip` 과 같은 이유로 값이 아니라 줄로 건넨다. */
export const VERDICT = "__BORCH_ACCURACY__";

interface Shot {
  readonly file: string;
  readonly class: number;
}

interface Listing {
  readonly source: string;
  readonly images: readonly Shot[];
}

export interface AccuracyReport {
  readonly n: number;
  readonly top1: number;
  readonly top5: number;
  readonly failed: number;
  readonly source: string;
}

/** JS 힙. 멈춘 자리를 찾을 때 **무엇이 차는지**가 첫 물음이라 같이 찍는다. */
function heap(): string {
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
  };
  const m = perf.memory;
  if (m === undefined) return "heap ?";
  return `heap ${Math.round(m.usedJSHeapSize / 1e6)}/${Math.round(m.jsHeapSizeLimit / 1e6)}MB`;
}

function say(line: string): void {
  console.log(`    … ${line}`);
}

/** 로짓에서 가장 큰 k 개의 자리. 값이 아니라 **자리**가 답이다. */
function best(scores: readonly number[], k: number): number[] {
  return scores
    .map((v, i) => [v, i] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, k)
    .map(([, i]) => i);
}

/** JPEG 한 장을 `vision.Image` 로. 캔버스를 거치는 것 말고 브라우저에 다른 길이 없다. */
async function pictureOf(url: string): Promise<vision.Image> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`사진을 못 받았습니다 (${res.status}): ${url}`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2d 컨텍스트를 못 얻었습니다");
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  // RGBA → RGB. `vision.image` 가 받는 것은 (H,W,C) 로 엮인 것이다.
  const rgb = new Float64Array(height * width * 3);
  for (let p = 0; p < width * height; p++) {
    rgb[p * 3] = data[p * 4] ?? 0;
    rgb[p * 3 + 1] = data[p * 4 + 1] ?? 0;
    rgb[p * 3 + 2] = data[p * 4 + 2] ?? 0;
  }
  return vision.image(rgb, height, width, 3, true);
}

export async function report(
  manifestUrl: string, listingUrl: string, limit: number,
): Promise<AccuracyReport> {
  say("장치를 연다");
  await init();

  say("매니페스트를 읽고 가중치를 싣는다");
  const loaded = await load(manifestUrl);
  // **평가 모드로 둔다.** 이것이 없으면 BatchNorm 이 배치 하나의 통계를 쓰고, 그
  // 배치는 사진 한 장이다 — 출력이 무의미해진다. 처음 돌렸을 때 50 장에서 top-1 이
  // 정확히 0 이었고, 오류는 한 건도 없었다. **잘 도는데 전부 틀리는** 모양이라
  // 디코더도 전처리도 클래스 표도 다 의심하게 만든다.
  //
  // `roundtrip` 이 같은 실수를 안 한 것은 아니다 — 거기서는 앞서 부른 `verify` 가
  // `eval()` 을 부수효과로 켜 두고 있었다. 기대는 것이 부수효과면 순서를 바꾸는
  // 날 조용히 깨진다.
  loaded.model.eval();
  const toTensor = transformFor(loaded.manifest);

  const listed = await fetch(listingUrl);
  if (!listed.ok) throw new Error(`사진 목록을 못 받았습니다 (${listed.status}): ${listingUrl}`);
  const listing = await listed.json() as Listing;
  const shots = listing.images.slice(0, limit);
  const base = listingUrl.slice(0, listingUrl.lastIndexOf("/") + 1);
  say(`사진 ${shots.length}장`);

  let hit1 = 0;
  let hit5 = 0;
  let failed = 0;
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    if (shot === undefined) continue;
    try {
      // **장마다 놓는다.** 천 장을 도는 동안 중간 텐서를 안 놓으면 장치가 찬다.
      const top = await scope(async () => {
        const x = toTensor(await pictureOf(base + shot.file));
        const scores = await noGrad(() => loaded.model.forward(x)).toArray();
        return best([...scores], 5);
      });
      if (top[0] === shot.class) hit1 += 1;
      if (top.includes(shot.class)) hit5 += 1;
    } catch (err) {
      // **못 푼 사진을 맞힌 것으로도 틀린 것으로도 안 센다.** 따로 센다 — 그 수가
      // 커지면 재고 있는 것이 모델이 아니라 디코더다.
      failed += 1;
      if (failed <= 3) say(`${shot.file} 을 못 읽었다: ${String(err)}`);
    }
    if ((i + 1) % 20 === 0) {
      say(`${i + 1}/${shots.length} — top-1 ${(hit1 / (i + 1 - failed) * 100).toFixed(1)}%`
        + ` · ${heap()}`);
    }
  }

  const counted = shots.length - failed;
  const out: AccuracyReport = {
    n: counted,
    top1: counted === 0 ? 0 : hit1 / counted,
    top5: counted === 0 ? 0 : hit5 / counted,
    failed,
    source: listing.source,
  };
  console.log(`${VERDICT}${JSON.stringify(out)}`);
  return out;
}
