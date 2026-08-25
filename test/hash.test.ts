/**
 * 해시가 **남들과 같은 수를 내는지** 본다.
 *
 * 우리끼리 일관된 것으로는 부족하다. 매니페스트에 적힌 수는 `sha256sum` 이 낸 것일
 * 수도, 파이썬 `hashlib` 이 낸 것일 수도 있다. 여기 쓴 값은 표준 시험 벡터라서,
 * 이것이 맞으면 **우리 해시가 바깥과 같은 함수**라는 뜻이다.
 *
 * 앞의 0 을 떨어뜨리는 결함은 그렇게만 걸린다 — 자기들끼리 비교하면 두 쪽이 똑같이
 * 틀려서 통과한다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { sha256Hex } from "../src/hash.js";

test("빈 바이트의 해시는 알려진 값이다", async () => {
  assert.equal(
    await sha256Hex(new Uint8Array(0)),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("'abc' 의 해시는 알려진 값이다", async () => {
  assert.equal(
    await sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("64 자리 소문자 16진수로 낸다 — 매니페스트가 그 모양을 기대한다", async () => {
  const hex = await sha256Hex(new TextEncoder().encode("borch"));
  assert.match(hex, /^[0-9a-f]{64}$/);
});

test("앞의 0 을 떨어뜨리지 않는다", async () => {
  // 이 입력의 다이제스트는 **0x03 으로 시작한다.** `padStart` 없이 `toString(16)` 만
  // 쓰면 "3" 이 되어 63 자리가 나오고, 그때 대조 실패는 "변조됨" 과 구별되지 않는다.
  // 그런 바이트가 나오는 입력을 일부러 골라야 걸리는 결함이라 여기 박아 둔다.
  const hex = await sha256Hex(new TextEncoder().encode("borch-hub/3"));
  assert.equal(hex.length, 64);
  assert.equal(
    hex,
    "037de04b20bb293789bedb83e4772060367891155b266af4dfae10ef26f9b8d0",
  );
});

test("한 비트가 달라지면 값이 달라진다", async () => {
  const a = await sha256Hex(new Uint8Array([0, 1, 2, 3]));
  const b = await sha256Hex(new Uint8Array([0, 1, 2, 2]));
  assert.notEqual(a, b);
});
