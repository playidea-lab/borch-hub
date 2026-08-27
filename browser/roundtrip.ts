/**
 * 만든 것을 **다시 받아 되싣고 대조한다** — 화물의 왕복 전체.
 *
 * 지금까지의 검사는 각자 한 토막만 봤다. 이 검사가 보는 것은 이어짐이다:
 * 매니페스트를 읽고 → 환경을 보고 → 받고 → 해시를 대조하고 → 카탈로그 모델에
 * 싣고 → 샘플 입력을 넣어 → 매니페스트가 말한 출력이 나오는가.
 *
 * **거절하는 쪽도 본다.** 해시가 틀렸을 때 실리지 않는지까지 확인해야 대조가
 * 의미를 갖는다 — 언제나 통과하는 검사는 검사가 아니다.
 */

import { init } from "borch-ts";

import {
  createModelFor, load, fetchManifest, readOutput, transformFor, BorchHubError,
} from "../src/index.js";
import { noGrad, vision } from "borch-ts";
import { verify } from "../src/verify.js";

/**
 * 아래에서 읽는 이미지가 **어느 데이터셋의 것인가.**
 *
 * 라벨을 매니페스트의 클래스 목록으로 읽어도 되는지가 여기 걸린다. 이미지를 바꾸면
 * 이 값도 같이 바꿔야 하고, 갈리면 정답 대조가 남의 목록을 읽는다.
 */
const IMAGE_DATASET = "cifar-10";

/**
 * 시험 이미지 **한 장.** CIFAR-10 시험 덩이의 첫 기록(라벨 1 바이트 + 픽셀 3072)을
 * 그대로 잘라 둔 것이라 3073 바이트다.
 *
 * 전에는 덩이 전체(30.7MB)를 `/borch/` 에서 받았다. 그 마운트는 0.2.2 에서 빠졌고,
 * 이 검사는 **한 장만 쓰므로** 나머지 9999 장은 처음부터 필요 없었다. 30MB 를
 * 저장소에 넣지 않고 3KB 를 넣는 쪽이 맞다.
 *
 * `serve.py` 가 얹는 접두사 아래여야 한다 — 그 바깥을 가리키면 404 가 오고, 404 는
 * 여기서 **멈춤이지 통과가 아니다.**
 */
const CIFAR_URL = "/borch-hub/test/cifar-first.bin";

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly note: string;
}

export interface RoundtripReport {
  readonly ok: boolean;
  readonly text: string;
  readonly checks: readonly Check[];
}

/**
 * **어디까지 갔는지 말한다.**
 *
 * 이 검사는 끝날 때까지 한 줄도 안 찍었다. 그래서 매달렸을 때 로그의 마지막 줄은
 * 첫 줄이었고, "도는 중" 과 "멈춤" 이 화면에서 같은 모양이었다 — 실제로 매달린
 * 자리를 찾는 데 여러 번을 버렸고, 그때마다 원인을 엉뚱한 곳에서 찾았다.
 *
 * `console.log` 는 여기서 로그가 아니라 **밖으로 나가는 유일한 통로다.** 이 코드는
 * 페이지 안에서 돌고, 결과를 기다리는 쪽은 다른 프로세스다.
 */
/** 판정 줄의 표. 파이썬 쪽이 이 글자로 그 줄을 가려낸다. */
export const VERDICT = "__roundtrip__ ";

const step = (what: string): void => {
  console.log(`  … ${what}`);
};

export async function report(manifestUrl: string): Promise<RoundtripReport> {
  step("장치를 연다");
  await init();
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, note: string): void => {
    checks.push({ name, ok, note });
  };

  step("매니페스트를 읽는다");
  const manifest = await fetchManifest(manifestUrl);
  add("매니페스트를 읽는다", true,
    `${manifest.name} ${manifest.version} · ${manifest.weights.bytes.toLocaleString()} 바이트`);

  step("가중치를 받아 싣는다");
  const loaded = await load(manifestUrl);
  add("환경을 받기 전에 본다", loaded.environment.ok, loaded.environment.adapter);
  add("해시가 맞으면 실린다", true,
    `텐서 ${Object.keys(loaded.model.stateDict()).length}개`);

  step("샘플을 대 본다");
  const result = await verify(loaded.model, manifest, manifestUrl);
  add("샘플 출력이 재현된다", result.ok,
    result.ok
      ? `수 ${result.count}개 · 최대 절대차 ${result.maxAbs.toExponential(2)}`
      : `어긋났다 — 최대 절대차 ${result.maxAbs.toExponential(2)}`
        + (result.worst ? ` (${result.worst.at}번: 기대 ${result.worst.expected} · 나온 것 ${result.worst.got})` : ""));

  // 캐시를 실제로 썼는지. 두 번째로 여는 사람이 45MB 를 다시 받으면 CDN 이 아니라
  // 그냥 파일 서버다.
  let cached = false;
  if (typeof caches !== "undefined") {
    const box = await caches.open("borch-hub-v1");
    cached = (await box.match(manifest.weights.url)) !== undefined;
  }
  add("받은 바이트가 통에 남는다", cached, cached ? "다음 방문은 안 받는다" : "통에 없다");

  // --- **쓸 수 있는가** ------------------------------------------------
  //
  // 여기까지는 전부 "실린다" 의 증명이다. 샘플 대조가 통과해도 받는 쪽은 자기
  // 이미지를 어떤 텐서로 만들어야 하는지 모를 수 있다 — 첫 화물이 정확히 그
  // 상태였다. 그래서 **매니페스트가 말한 대로만** 해서 이름이 나오는지 본다.
  if (manifest.preprocess !== null) {
    const [, height, width] = manifest.preprocess.inputSize;
    // CIFAR 시험 덩이의 첫 장. 라벨은 바이트 하나로 앞에 붙어 있다.
    // 이미지를 바꾸면 `IMAGE_DATASET` 도 같이 바꿔야 한다 — 그 둘이 갈리면 정답
    // 대조가 남의 목록을 읽는다.
    step("진짜 이미지 한 장을 넣어 본다");
    // **못 받으면 멈춘다.** 이 주소는 `serve.py` 가 `../borch` 를 얹던 시절의
    // 것이고, 0.2.2 에서 그 마운트가 빠지면서 404 가 되었다. 그런데도 아래 검사는
    // **초록이었다** — 받은 것이 없으면 `?? 0` 이 0 을 채우고, 0 으로 채운 그림에도
    // 모델은 이름 하나를 내놓기 때문이다. 이름이 나오는지만 보는 검사에게 그것은
    // 통과다. 그래서 이 검사는 한동안 **이미지에 대해 아무것도 묻지 않았다.**
    const got = await fetch(CIFAR_URL);
    if (!got.ok) {
      throw new BorchHubError(
        `시험 이미지를 못 받았습니다 (${got.status}): ${CIFAR_URL}\n`
        + "  이 검사는 받는 쪽이 자기 이미지를 어떤 텐서로 만드는지를 봅니다.\n"
        + "  그림이 없으면 볼 것이 없으므로, 조용히 지나가지 않고 여기서 멈춥니다.",
      );
    }
    const raw = new Uint8Array(await got.arrayBuffer());
    const truth = raw[0] ?? 0;
    const pixels = new Float64Array(height * width * 3);
    // 저장이 R 판 · G 판 · B 판 순서다. (H,W,C) 로 엮는다.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 3; c++) {
          pixels[(y * width + x) * 3 + c] = raw[1 + c * height * width + y * width + x] ?? 0;
        }
      }
    }
    const img = vision.image(pixels, height, width, 3, true);
    const x = transformFor(manifest)(img);
    const scores = await noGrad(() => loaded.model.forward(x)).toArray();
    const read = readOutput(manifest, [...scores]);
    const want = manifest.outputs?.classes?.[truth] ?? String(truth);
    // **크기가 다른 이미지도 넣어 본다.** 우리 모델은 resize 가 null 이라 그 경로가
    // 한 번도 안 지나간다 — 안 지나가는 코드는 없는 코드와 구별이 안 된다.
    // 매니페스트를 손에서 고쳐 resize·centerCrop 을 켜고, 64×64 를 넣는다.
    const asked = {
      ...manifest,
      preprocess: {
        ...manifest.preprocess,
        resize: { shortSide: height, interpolation: "bilinear" as const },
        centerCrop: [height, width] as readonly [number, number],
      },
    };
    const big = new Float64Array(64 * 64 * 3);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7) % 256;
    const grown = vision.image(big, 64, 64, 3, true);
    let resized: string | null = null;
    try {
      const t = transformFor(asked)(grown);
      resized = `${t.shape.join("x")}`;
    } catch (err) {
      resized = `막혔다: ${String(err)}`;
    }
    add("크기가 다른 이미지는 매니페스트가 말한 대로 맞춰진다",
      resized === `1x${manifest.preprocess.inputSize.join("x")}`,
      resized ?? "(없음)");

    // **이 이미지는 CIFAR 이다.** 라벨도 CIFAR 의 0–9 이므로, 그것을 매니페스트의
    // 클래스 목록으로 읽어도 되는 것은 그 목록이 CIFAR 의 것일 때뿐이다. ImageNet
    // 화물에서는 라벨 3(cat)이 "tiger shark" 로 읽히고, 32×32 를 224 로 늘린 그림이
    // 들어가므로 **무엇이 나오든 판정이 아니다**(실측).
    //
    // 그래서 둘로 가른다. 이름이 나오는지는 언제나 보고, 그 이름이 맞는지는 이
    // 이미지의 데이터셋일 때만 본다 — 아닐 때는 **안 봤다고 말한다.** 전에는 이
    // 검사가 `label !== null` 만 보았으므로, 틀린 이름을 괄호에 담은 채 초록색이었다.
    const ours = manifest.dataset === IMAGE_DATASET;
    add("진짜 이미지 한 장에서 이름이 나온다", read.label !== null,
      read.label === null
        ? "이름이 안 나왔다 — 매니페스트가 classes 를 안 적었다"
        : ours
          ? `${read.label} (정답 ${want})`
          : `${read.label} — 이 화물은 ${manifest.dataset ?? "다른"} 것이라 맞는지는 안 본다`);

    if (ours) {
      add("그 이름이 정답이다", read.label === want,
        read.label === want ? `${read.label}` : `${read.label} 인데 정답은 ${want}`);
    }
  }

  // 최대 절대차가 0 으로 나오는 것은 같은 어댑터에서 같은 가중치를 다시 돌렸으니
  // 맞다. 그런데 그 0 만 보고는 **대조가 무엇이든 통과시키는 것**과 구별이 안 된다.
  // 그래서 배운 적 없는 모델을 같은 샘플에 대 본다 — 여기서 통과하면 배지는 거짓이다.
  step("배운 적 없는 모델을 대 본다");
  const stranger = await verify(
    createModelFor(manifest.arch), manifest, manifestUrl);
  add("배운 적 없는 모델은 통과 못 한다", !stranger.ok,
    stranger.ok
      ? "통과했다 — 이 대조는 아무것도 안 가려낸다"
      : `막혔다 — 최대 절대차 ${stranger.maxAbs.toExponential(2)}`);

  // --- 거절하는 쪽 -------------------------------------------------------
  const tampered = { ...manifest, weights: { ...manifest.weights, sha256: "0".repeat(64) } };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(tampered)], { type: "application/json" }));
  step("해시를 틀리게 해 거절을 본다");
  let refused = false;
  let how = "거절하지 않았다 — 이 로더는 바이트를 안 보고 있다";
  try {
    await load(url);
  } catch (err) {
    refused = err instanceof BorchHubError && err.message.includes("해시");
    how = refused ? "해시가 다르다고 멈췄다" : `다른 이유로 멈췄다: ${String(err)}`;
  } finally {
    URL.revokeObjectURL(url);
  }
  add("해시가 틀리면 거절한다", refused, how);

  const ok = checks.every((c) => c.ok);
  const lines = [
    ok ? "왕복 전체가 돈다" : "**어딘가 끊겼다**",
    ...checks.map((c) => `  ${c.ok ? "○" : "×"} ${c.name} — ${c.note}`),
  ];
  // **판정을 이 통로로 내보낸다. 이것이 정본이다.**
  //
  // 아래에서 `window.__borchHubRoundtrip` 에도 세우지만, 밖에서 그 값을 읽어 가는
  // 손잡기는 **큰 화물에서 안 온다**(실측). 값은 제대로 서고 `typeof` 도 맞는데,
  // 바로 뒤에 건 300ms 짜리 `setTimeout` 이 끝내 안 돈다 — 그 시점부터 페이지의
  // 메인 스레드가 멎는다. playwright 의 기다림은 rAF 든 시계든 그 스레드에서
  // 도므로 둘 다 굶고, 21MB 화물은 통과하고 31~49MB 만 10 분을 꽉 채웠다.
  //
  // 왜 멎는지는 아직 모른다. 아는 것은 **멎기 전에 이 줄이 나간다**는 것이고,
  // 그래서 판정을 값이 아니라 줄로 건넨다. 모르는 것을 안다고 적지 않기 위해
  // 여기 그대로 적어 둔다.
  const text = lines.join("\n");
  console.log(`${VERDICT}${JSON.stringify({ ok, text })}`);
  return { ok, text, checks };
}
