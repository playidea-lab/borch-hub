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

import { init } from "borch";

import { createModel, load, fetchManifest, BorchHubError } from "../src/index.js";
import { verify } from "../src/verify.js";

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

export async function report(manifestUrl: string): Promise<RoundtripReport> {
  await init();
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, note: string): void => {
    checks.push({ name, ok, note });
  };

  const manifest = await fetchManifest(manifestUrl);
  add("매니페스트를 읽는다", true,
    `${manifest.name} ${manifest.version} · ${manifest.weights.bytes.toLocaleString()} 바이트`);

  const loaded = await load(manifestUrl);
  add("환경을 받기 전에 본다", loaded.environment.ok, loaded.environment.adapter);
  add("해시가 맞으면 실린다", true,
    `텐서 ${Object.keys(loaded.model.stateDict()).length}개`);

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

  // 최대 절대차가 0 으로 나오는 것은 같은 어댑터에서 같은 가중치를 다시 돌렸으니
  // 맞다. 그런데 그 0 만 보고는 **대조가 무엇이든 통과시키는 것**과 구별이 안 된다.
  // 그래서 배운 적 없는 모델을 같은 샘플에 대 본다 — 여기서 통과하면 배지는 거짓이다.
  const stranger = await verify(
    createModel(manifest.arch.factory, manifest.arch.args), manifest, manifestUrl);
  add("배운 적 없는 모델은 통과 못 한다", !stranger.ok,
    stranger.ok
      ? "통과했다 — 이 대조는 아무것도 안 가려낸다"
      : `막혔다 — 최대 절대차 ${stranger.maxAbs.toExponential(2)}`);

  // --- 거절하는 쪽 -------------------------------------------------------
  const tampered = { ...manifest, weights: { ...manifest.weights, sha256: "0".repeat(64) } };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(tampered)], { type: "application/json" }));
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
  return { ok, text: lines.join("\n"), checks };
}
