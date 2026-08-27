/**
 * **저장소에 든 스키마 사본이 정본과 같은지** 본다.
 *
 *     node scripts/schema-fresh.mjs
 *
 * ## 왜 검사와 따로 있나
 *
 * `test/schema.test.ts` 는 "거울이 스키마를 지키는가" 를 묻고, 이 파일은 "우리가 든
 * 스키마가 최신인가" 를 묻는다. 다른 질문이다.
 *
 * 한 검사에 넣으면 **네트워크가 끊긴 날 "거울이 갈렸다" 로 읽힌다.** 그리고 그렇게
 * 읽히는 순간 사람은 거울을 고치러 간다 — 멀쩡한 것을. 이 저장소가 스물두 번 만난
 * 모양이 그것이다: 다른 두 사실이 같은 신호를 내면, 아무도 어느 쪽인지 모른다.
 *
 * ## 주소를 여기 안 적는다
 *
 * 스키마의 `$id` 가 자기 정본 주소다. 그것을 읽어 쓰면 주소가 두 벌이 되지 않는다 —
 * 사본을 옮긴 날 이 파일을 같이 고치는 것을 잊어도 스스로 따라간다.
 *
 * ## 못 받으면 빨강이다
 *
 * 건너뛰지 않는다. 확인 못 한 것을 통과로 적으면, 재는 것이 값이 아니라 침묵이 된다.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COPY = join(ROOT, "schema", "manifest.schema.json");

const mine = readFileSync(COPY, "utf8");
const url = JSON.parse(mine)["$id"];
if (typeof url !== "string" || url === "") {
  console.error("사본에 `$id` 가 없습니다 — 정본이 어디인지 파일 스스로 말해야 합니다.");
  process.exit(1);
}

const res = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch((err) => err);
if (res instanceof Error) {
  console.error(`정본을 못 받았습니다: ${res.message}\n  ${url}\n`
    + "  건너뛰지 않습니다 — 확인 못 한 것은 통과가 아닙니다.");
  process.exit(1);
}
if (!res.ok) {
  console.error(`정본을 못 받았습니다: ${res.status}\n  ${url}`);
  process.exit(1);
}

const theirs = await res.text();

// **글자가 아니라 뜻으로 견준다.** 정본이 들여쓰기만 바뀌어도 빨개지면, 사람은 곧
// 이 검사를 안 믿게 된다 — 그러면 진짜로 갈린 날에도 안 본다. 거짓 경보는 검사를
// 끄는 가장 빠른 길이다.
let same = false;
try {
  same = JSON.stringify(JSON.parse(mine)) === JSON.stringify(JSON.parse(theirs));
} catch (err) {
  console.error(`정본을 JSON 으로 못 읽었습니다: ${String(err)}\n  ${url}`);
  process.exit(1);
}
if (same) {
  console.log(`  사본이 정본과 같습니다 — ${url}`);
  process.exit(0);
}

// **무엇이 달라졌는지 말한다.** "다르다" 만 말하면 받는 사람이 두 파일을 손으로 연다.
const a = mine.split("\n");
const b = theirs.split("\n");
console.error(`사본이 정본과 다릅니다 — ${url}\n`);
let shown = 0;
for (let i = 0; i < Math.max(a.length, b.length) && shown < 12; i++) {
  if (a[i] === b[i]) continue;
  console.error(`  ${String(i + 1).padStart(4)}  사본: ${a[i] ?? "(없음)"}`);
  console.error(`        정본: ${b[i] ?? "(없음)"}`);
  shown++;
}
console.error("\n  `schema/manifest.schema.json` 을 정본으로 맞추고, 거울이 여전히"
  + " 지키는지 `npm test` 로 확인할 것.");
process.exit(1);
