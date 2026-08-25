/**
 * 배지가 **막아야 할 것을 막는지** 본다.
 *
 * 모델을 만들려면 GPU 가 들지만, 배지의 판정은 수 두 벌을 대 보는 일이라 GPU 를 안
 * 탄다. 그래서 이 파일이 보는 것은 `compare` 다 — 이 파일에서 조용히 틀릴 수 있는
 * 부분이 전부 거기 모여 있다.
 *
 * **통과하는 경우만 확인하는 것은 검사가 아니다.** 배지가 통과만 하고 아무것도 막지
 * 못하면 그건 배지가 아니라 도장이고, 아래 첫 두 검사가 그 차이를 지킨다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { compare } from "../src/verify.js";

const RTOL = 1e-4;
const ATOL = 1e-6;

test("NaN 은 통과하지 못한다 — 비교가 전부 거짓이라 그냥 두면 통과한다", () => {
  // `NaN > 허용치` 는 거짓이다. 허용 오차만으로 판정하면 **전부 NaN 을 뱉는 모델이
  // 통과한다** — 배지가 막아야 할 것 중 가장 명백한 것을 통과시킨다.
  const result = compare([NaN, NaN, NaN], [1, 2, 3], RTOL, ATOL);
  assert.equal(result.ok, false);
  assert.equal(result.worst?.at, 0);
  assert.ok(Number.isNaN(result.worst?.got));
});

test("하나만 NaN 이어도 막힌다", () => {
  const result = compare([1, NaN, 3], [1, 2, 3], RTOL, ATOL);
  assert.equal(result.ok, false);
  assert.equal(result.worst?.at, 1);
});

test("Infinity 도 수가 아닌 것으로 센다", () => {
  assert.equal(compare([Infinity], [1], RTOL, ATOL).ok, false);
  assert.equal(compare([1], [-Infinity], RTOL, ATOL).ok, false);
});

test("셀 것이 없으면 통과가 아니다", () => {
  // 빈 파일과 통과한 대조는 다른 일이다. 0 개를 다 맞혔다고 말하면 안 된다.
  const result = compare([], [], RTOL, ATOL);
  assert.equal(result.ok, false);
  assert.equal(result.count, 0);
});

test("같은 수는 통과하고 어긋난 자리를 안 내놓는다", () => {
  const result = compare([1, 2, 3], [1, 2, 3], RTOL, ATOL);
  assert.equal(result.ok, true);
  assert.equal(result.maxAbs, 0);
  assert.equal(result.worst, null);
});

test("허용 오차 안의 차이는 통과한다", () => {
  const result = compare([1 + 5e-7], [1], RTOL, ATOL);
  assert.equal(result.ok, true);
  assert.ok(result.maxAbs > 0);
});

test("허용 오차를 넘으면 막고 그 자리를 짚는다", () => {
  const result = compare([1, 5, 3], [1, 2, 3], RTOL, ATOL);
  assert.equal(result.ok, false);
  assert.equal(result.count, 3);
  assert.equal(result.worst?.at, 1);
  assert.equal(result.worst?.expected, 2);
  assert.equal(result.worst?.got, 5);
});

test("가장 어긋난 자리는 절대차가 아니라 허용치를 넘은 폭으로 고른다", () => {
  // 0 번: 절대차 0.05 인데 기대값이 1000 이라 rtol 이 0.1 까지 봐준다 → **통과**.
  // 1 번: 절대차 0.01 로 더 작지만 기대값이 0 이라 봐주는 폭이 atol 뿐이다 → **위반**.
  //
  // 절대차 최대로 고르면 통과한 0 번을 가리키면서 "여기가 제일 어긋났다" 고 말한다.
  const result = compare([1000.05, 0.01], [1000, 0], RTOL, ATOL);
  assert.equal(result.ok, false);
  // 1000.05 - 1000 은 부동소수라 정확히 0.05 가 아니다. 자릿수만 본다.
  assert.ok(Math.abs(result.maxAbs - 0.05) < 1e-9, "절대차 최대는 통과한 0 번에 있다");
  assert.equal(result.worst?.at, 1, "그래도 짚어야 할 곳은 위반한 1 번이다");
});

test("기대값이 0 이면 상대차 대신 절대차로 본다 — 0 으로 나누지 않는다", () => {
  const result = compare([1e-9], [0], RTOL, ATOL);
  assert.equal(result.ok, true);
  assert.ok(Number.isFinite(result.maxRel));
});

test("Float32Array 를 그대로 받는다 — 코어가 내놓는 모양이다", () => {
  const result = compare(new Float32Array([1, 2]), new Float32Array([1, 2]), RTOL, ATOL);
  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
});
