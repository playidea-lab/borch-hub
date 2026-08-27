/**
 * **매니페스트가 요구하는 판을 실제로 대조하는지** 본다.
 *
 * ## 오래 안 읽히던 필드다
 *
 * `runtime.ts` 는 "이 가중치는 이 판 이상에서 돈다" 는 조건인데, 받는 쪽이 **자기가 몇
 * 판인지 몰라서** 대조할 수가 없었다. 그래서 이 필드는 적히기만 하고 읽힌 적이 없다.
 * `borch-ts` 0.2.3 이 `VERSION` 을 내보내면서 그 조건이 끝났다.
 *
 * ## 왜 받기 **전에** 보는가
 *
 * 이 검사가 서는 자리는 45MB 를 받기 전이다. 여기서 막으면 받는 쪽이 그 자리에서
 * 이유를 읽는다. 통과시키면 못 돌 모델을 다 받은 뒤 **훨씬 안쪽에서 다른 말로**
 * 실패한다 — 그때는 무엇이 문제인지 아무도 모른다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { VERSION } from "borch-ts";

import { checkEnvironment } from "../src/load.js";
import { parseManifest } from "../src/manifest.js";

import { broken } from "./fixture.js";

/** `runtime.ts` 만 갈아 끼운 매니페스트. WebGPU 는 안 보게 꺼 둔다. */
function asking(range: string | null) {
  return parseManifest(broken((d) => {
    const rt = d["runtime"] as Record<string, unknown>;
    rt["ts"] = range;
    rt["py"] = ">=0.1.0";
    rt["webgpu"] = null;
  }));
}

test("이 판보다 낮은 것을 요구하면 지나간다", async () => {
  const report = await checkEnvironment(asking(">=0.1.0"));
  assert.equal(report.ok, true, `막히면 안 됩니다 — ${report.reasons.join(" / ")}`);
});

test("이 판 자신을 요구해도 지나간다 — 경계가 포함이다", async () => {
  // `>=` 다. 같은 수에서 막으면 방금 나간 판을 위해 쓴 매니페스트가 그날부터 안 실린다.
  const report = await checkEnvironment(asking(`>=${VERSION}`));
  assert.equal(report.ok, true, `같은 판은 지나가야 합니다 — ${report.reasons.join(" / ")}`);
});

test("이 판보다 높은 것을 요구하면 받기 전에 막는다", async () => {
  const report = await checkEnvironment(asking(">=99.0.0"));
  assert.equal(report.ok, false);
  assert.match(report.reasons[0] ?? "", /99\.0\.0/);
  assert.match(report.reasons[0] ?? "", new RegExp(VERSION.replace(/\./g, "\\.")));
});

test("마이너와 패치도 본다 — 메이저만 보지 않는다", async () => {
  const [major, minor, patch] = VERSION.split(".").map(Number);
  const higherMinor = `>=${major}.${(minor ?? 0) + 1}.0`;
  const higherPatch = `>=${major}.${minor}.${(patch ?? 0) + 1}`;
  assert.equal((await checkEnvironment(asking(higherMinor))).ok, false, higherMinor);
  assert.equal((await checkEnvironment(asking(higherPatch))).ok, false, higherPatch);
});

test("모르는 형식은 추측하지 않고 거절한다", async () => {
  // `^`·`~`·`||` 는 이 로더가 모른다. **통과시키는 쪽으로 기울이지 않는다** — 모르는
  // 것을 통과시키면 못 돌 모델을 받게 하고, 그 실패는 훨씬 안쪽에서 난다.
  for (const odd of ["^0.2.0", "~0.2.0", ">=0.1.0 || >=1.0.0", "0.2.x", "latest"]) {
    const report = await checkEnvironment(asking(odd));
    assert.equal(report.ok, false, `${odd} 를 통과시키면 안 됩니다`);
    assert.match(report.reasons[0] ?? "", /읽을 줄 아는 형식이 아닙니다/);
  }
});

test("ts 가 비면 여전히 그 이유로 막는다", async () => {
  const report = await checkEnvironment(asking(null));
  assert.equal(report.ok, false);
  assert.match(report.reasons[0] ?? "", /지원한다고 적혀 있지 않습니다/);
});

test("레지스트리에 나가 있는 범위가 지나간다", async () => {
  // 지금 발행된 매니페스트 여섯이 전부 `>=0.1.0` 이다. 이 검사가 그것들을 막으면
  // **이미 나간 것을 오늘부터 못 싣게 되는** 것이고, 그건 고침이 아니라 사고다.
  assert.equal((await checkEnvironment(asking(">=0.1.0"))).ok, true);
});
