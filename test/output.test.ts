/**
 * **나온 수를 읽는 쪽**과, 이미지를 넣기 전에 묻는 쪽을 본다.
 *
 * 둘 다 GPU 를 안 탄다 — 하나는 배열을 읽고, 하나는 매니페스트가 말이 되는지만 본다.
 * 그래서 노드에서 돈다.
 *
 * 여기서 지키려는 것은 하나다: **모르는 것을 아는 척하지 않는다.** 이름이 없으면
 * 자리 번호를 이름인 척 내놓지 않고, 이름 수가 안 맞으면 그 매니페스트가 이 모델을
 * 말하는 것이 아니라고 한다. 45MB 를 받은 뒤가 아니라 그 전에 묻는 것도 같은 규칙이다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { parseManifest } from "../src/manifest.js";
import { BorchHubError } from "../src/manifest.js";
import { preprocessGaps, readOutput, transformFor } from "../src/preprocess.js";

import { broken, v1, whole } from "./fixture.js";

function rejects(run: () => unknown, mentions: string): void {
  assert.throws(run, (err: unknown) => {
    assert.ok(err instanceof BorchHubError, `BorchHubError 여야 합니다 — ${String(err)}`);
    assert.ok(
      err.message.includes(mentions),
      `메시지가 '${mentions}' 를 짚어야 합니다 — 받은 것: ${err.message}`,
    );
    return true;
  });
}

test("가장 큰 수의 자리와 그 이름이 나온다", () => {
  const manifest = parseManifest(whole());
  const reading = readOutput(manifest, [0.1, 0.2, 9.5]);
  assert.equal(reading.index, 2);
  assert.equal(reading.label, "bird");
});

test("같은 값이면 앞자리를 고른다 — 뒤로 미끄러지지 않는다", () => {
  const manifest = parseManifest(whole());
  assert.equal(readOutput(manifest, [3, 3, 3]).index, 0);
});

test("이름이 없으면 null 이다 — 자리 번호를 이름인 척하지 않는다", () => {
  // 판 1 에는 `outputs` 가 없다. 그때 아는 것은 자리 번호까지다.
  const manifest = parseManifest(v1());
  const reading = readOutput(manifest, [0.1, 5.0, 0.2]);
  assert.equal(reading.index, 1);
  assert.equal(reading.label, null);
});

test("이름 수와 나온 수가 다르면 그 매니페스트를 거절한다", () => {
  // 이름 3개짜리 매니페스트에 10개가 나왔다 — 실린 모델이 매니페스트가 말하는
  // 그 모델이 아니라는 뜻이고, 그때 3번째 이름을 답하면 조용히 틀린 답이 된다.
  const manifest = parseManifest(whole());
  rejects(() => readOutput(manifest, new Array(10).fill(0)), "not describing this model");
});

test("아무것도 안 나오면 멈춘다", () => {
  const manifest = parseManifest(whole());
  rejects(() => readOutput(manifest, []), "returned nothing");
});

test("채널 수와 mean/std 길이가 어긋나면 받기 전에 걸린다", () => {
  const manifest = parseManifest(broken((d) => {
    const pre = d["preprocess"] as Record<string, unknown>;
    pre["mean"] = [0.5, 0.5];
  }));
  const gaps = preprocessGaps(manifest.preprocess!);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0] ?? "", /3 channels/);
});

test("온전한 전처리에는 빈 곳이 없다", () => {
  const manifest = parseManifest(whole());
  assert.deepEqual(preprocessGaps(manifest.preprocess!), []);
});

test("판 1 매니페스트로는 이미지를 넣을 수 없다고 말한다", () => {
  // 가중치는 실리지만 무엇을 먹이는지는 적혀 있지 않다. **실린다는 것과 쓸 수 있다는
  // 것이 다르다** — 그 차이를 말하지 않으면 받는 쪽이 아무 텐서나 넣어 보게 된다.
  const manifest = parseManifest(v1());
  rejects(() => transformFor(manifest), "schema version 1 had no such field");
});

test("이 런타임이 못 하는 전처리를 요구하면 만들기 전에 거절한다", () => {
  const manifest = parseManifest(broken((d) => {
    const pre = d["preprocess"] as Record<string, unknown>;
    pre["std"] = [0.2];
  }));
  rejects(() => transformFor(manifest), "cannot perform the preprocessing");
});
