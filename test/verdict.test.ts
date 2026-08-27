/**
 * **판정 줄의 표가 양쪽에서 같은지** 본다.
 *
 * ## 왜 이런 검사가 있나
 *
 * 왕복 검사의 판정은 값이 아니라 줄로 건너간다. 페이지가 `console.log` 로 한 줄을
 * 내보내고, 파이썬 쪽이 그 줄을 글자로 가려내 담는다 — `window` 에 세운 값을 밖에서
 * 읽어 가는 손잡기가 큰 화물에서 **끝내 안 오기 때문이다**(`browser/roundtrip.ts` 의
 * 판정 자리에 그 실측이 적혀 있다).
 *
 * 그래서 그 글자가 두 파일에 각각 적혀 있고, **갈리면 아무도 소리를 내지 않는다.**
 * 판정 줄은 평범한 로그 줄로 흘러가 화면에 찍히고, 기다리는 쪽은 오지 않는 것을
 * 기다리다 시간을 다 채운 뒤 "판정이 오지 않았다" 고 말한다 — 검사가 실패한 것처럼
 * 보이지만 실은 검사가 성공했고 우리가 못 받은 것이다. 한 글자 차이로 그렇게 된다.
 *
 * 두 파일을 글자로 대 보는 것이 그것을 막는 가장 싼 방법이다.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

/** 따옴표 안의 글자를 꺼낸다. 없으면 그 자체가 실패다. */
function marker(file: string, pattern: RegExp): string {
  const text = readFileSync(join(root, file), "utf8");
  const found = pattern.exec(text);
  assert.ok(found, `${file} 에서 판정 표를 못 찾았다 — 이름이 바뀌었나`);
  return found[1] ?? "";
}

test("판정 줄의 표가 페이지와 파이썬에서 같다", () => {
  const page = marker(
    "browser/roundtrip.ts",
    /export const VERDICT = "([^"]*)"/,
  );
  const host = marker("browser/roundtrip.py", /^VERDICT = "([^"]*)"/m);

  assert.equal(host, page,
    `판정 표가 갈렸다 — 페이지 '${page}' · 파이썬 '${host}'.\n`
    + "  갈리면 판정이 평범한 로그 줄로 흘러가고, 기다리는 쪽은 시간을 다 채운다.");
  assert.ok(page.length > 0, "판정 표가 비어 있다 — 모든 줄이 판정으로 읽힌다");
});
