/**
 * **고친 결함을 도로 심고, 무엇이 잡는지 본다.**
 *
 *     node scripts/reinstate.mjs          # 전부
 *     node scripts/reinstate.mjs nan      # 이름에 nan 이 든 것만
 *
 * ## 왜 이것이 필요한가
 *
 * 검사를 쓸 때마다 "되돌리면 실패하는가" 를 손으로 한 번씩 해 봤다. 그것으로 충분해
 * 보였는데, 아니었다 — **되돌린 뒤 빨간 것과, 되돌린 뒤 아예 못 도는 것이 같아 보인다.**
 * 이웃 저장소에서 실제로 그 일이 났다: 결함을 심었더니 "못 잡음" 으로 나왔고, 사실은
 * 러너가 멈춘 것이었다. 도구가 `exit != 0` 을 전부 빨강으로 읽고 있었다.
 *
 * 그래서 결과를 셋으로 가른다:
 *
 * | | 뜻 |
 * |---|---|
 * | **red** | 검사가 잡았다. **그리고 잡은 것이 그 검사인지까지** 본다 |
 * | **green** | 아무것도 안 잡았다 — 결함이 통과했다 |
 * | **stop** | 검사가 돌지 못했다(컴파일 실패 등). 못 잡은 것과 **다른 일**이다 |
 *
 * `stop` 이 특히 중요하다. 컴파일러가 먼저 막는 것은 **더 이른 방어**이지 검사의
 * 실패가 아닌데, 둘을 한 칸에 넣으면 그 구별이 사라진다.
 *
 * ## 이름을 맞춰 보는 이유
 *
 * 빨간 것만으로는 부족하다. 결함 A 를 심었는데 검사 B 가 (다른 이유로) 실패해도 빨강은
 * 빨강이다. 그래서 **어느 검사가 잡아야 하는지를 여기 적어 두고** 실제로 그것이
 * 실패했는지 본다. 안 맞으면 `red(딴 것)` 로 나온다 — 통과보다 조금 나을 뿐이다.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * 고친 자리마다: 무엇을 되돌리고, 어느 검사가 잡아야 하는가.
 *
 * `find` 는 지금 소스에 **정확히 한 번** 나와야 한다. 안 그러면 그 자체가 신호다 —
 * 코드가 움직였는데 이 표가 안 따라온 것이다.
 */
const DEFECTS = [
  {
    name: "nan-passes-the-badge",
    what: "NaN 을 실패로 세지 않는다 — 비교가 전부 거짓이라 통과한다",
    file: "src/verify.ts",
    find: "    if (!Number.isFinite(mine) || !Number.isFinite(want)) {",
    with: "    if (false) {",
    caughtBy: "NaN 은 통과하지 못한다",
  },
  {
    name: "empty-comparison-passes",
    what: "셀 것이 없는데 통과로 센다",
    file: "src/verify.ts",
    find: "  if (got.length === 0) {\n    return { ok: false, count: 0, maxAbs: 0, maxRel: 0, worst: null };",
    with: "  if (got.length === 0) {\n    return { ok: true, count: 0, maxAbs: 0, maxRel: 0, worst: null };",
    caughtBy: "셀 것이 없으면 통과가 아니다",
  },
  {
    name: "ambiguous-sample-tensor",
    what: "샘플 파일에 텐서가 여럿이면 조용히 첫 번째를 집는다",
    file: "src/verify.ts",
    find: "  if (names.length > 1) {",
    with: "  if (false) {",
    // **노드는 이것을 못 잡는다** — `decode` 가 텐서를 만들고 텐서는 장치를 요구한다.
    // 그래서 여기서는 언제나 초록이고, 그 초록은 "괜찮다" 가 아니라 "여기서는 못 잰다"
    // 는 뜻이다.
    //
    // 재는 곳은 브라우저 하네스다. 레지스트리의 샘플 파일은 전부 텐서가 하나뿐이라
    // 진짜 화물로는 영영 안 밟히므로, 하네스가 **있는 샘플을 두 번 담아** 그 갈래를
    // 짓는다("샘플에 텐서를 둘 넣어 거절을 본다"). 양쪽으로 확인했다 — 방어가 있으면
    // 개수를 말하며 멈추고, 이 줄을 지우면 그 단계가 빨개진다.
    //
    // CI 는 하네스를 못 돌린다(러너에 WebGPU 가 없어 타입만 본다). 그래서 이 줄은
    // 초록으로 남지만, 이제 **확인된 적 없는 방어는 아니다.**
    caughtBy: null,
    expect: "green",
    elsewhere: "브라우저 하네스 — npm run roundtrip",
  },
  {
    name: "schema-moves-and-the-mirror-does-not",
    what: "정본이 값을 하나 늘렸는데 거울이 안 따라왔다",
    file: "schema/manifest.schema.json",
    // **갈림은 이 방향으로 온다.** 거울을 좁히는 쪽은 컴파일러가 먼저 막지만,
    // 정본이 먼저 움직이는 쪽은 아무도 안 막았다 — 레지스트리는 통과시키고
    // 클라이언트가 거절하는 매니페스트가 그렇게 생긴다.
    find: '                "bicubic"\n              ]',
    with: '                "bicubic",\n                "lanczos"\n              ]',
    caughtBy: "스키마가 허용하는 값을 거울도 전부 받는다",
  },
  {
    name: "index-versions-compared-as-text",
    what: "판을 글로 견준다 — 1.0.10 이 1.0.9 보다 뒤진다",
    file: "src/listing.ts",
    // 지금 목차에는 1.0.0 과 1.0.1 뿐이라 **글로 견줘도 맞는 답이 나온다.** 열 번째
    // 수정판이 나가는 날 조용히 틀리기 시작하고, 그날 이것을 의심할 사람은 없다.
    find: "    if (x !== y) return x > y;",
    with: "    if (x !== y) return String(x) > String(y);",
    caughtBy: "판을 수로 견준다 — 글로 견주면 1.0.10 이 1.0.9 보다 뒤진다",
  },
  {
    name: "lockfile-narrower-than-package-json",
    what: "잠금 파일이 캐럿으로 좁아져 CI 가 옛 판만 본다",
    file: "package-lock.json",
    // `npm ci` 는 이것을 안 막는다 — 잠긴 판이 선언 범위를 만족하면 통과다.
    // 즉 좁아진 것은 오류로 안 보이고, 새 마이너가 깨도 CI 는 초록이다.
    find: '        "borch-ts": ">=0.2.3 <1.0.0",\n        "typescript"',
    with: '        "borch-ts": "^0.2.3",\n        "typescript"',
    caughtBy: "잠금 파일이 같은 범위를 적고 있다",
  },
  {
    name: "catalogue-checked-after-the-download",
    what: "카탈로그에 없는 이름을 45MB 다 받은 뒤에야 알려 준다",
    file: "src/load.ts",
    find: "  const unbuildable = cannotBuild(manifest.arch);",
    with: "  const unbuildable = null as string | null; void cannotBuild;",
    // 되돌려도 `createModelFor` 는 여전히 거절한다 — 받은 **뒤에** 한다는 것만 달라진다.
    // 그래서 "던지는가" 를 보는 검사는 이 결함을 못 잡는다. 잡는 것은 바이트를 세는 쪽뿐이다.
    caughtBy: "가중치를 **한 바이트도 안 받고** 막는다",
  },
  {
    name: "measure-without-await",
    what: "해시·길이 검사를 기다리지 않는다",
    file: "src/load.ts",
    find: "    await measure(bytes, manifest);",
    with: "    void measure(bytes, manifest);",
    caughtBy: "한 바이트만 달라도 해시에서 멈춘다",
  },
  {
    name: "cache-hit-reports-nothing",
    what: "통에서 꺼낼 때 진행률을 안 알린다",
    file: "src/load.ts",
    find: "      tell(opts, bytes.length, manifest.weights.bytes);",
    with: "",
    caughtBy: "통에서 꺼낼 때도 진행률이 울린다",
  },
  {
    name: "peer-caret-on-0x",
    what: "peer 범위가 0.x 에서 caret 을 쓴다 — 새 마이너를 배제한다",
    file: "package.json",
    // `peerDependencies` 와 `devDependencies` 양쪽에 같은 문자열이 있다. 앞의 것만
    // 되돌리려고 열쇠 이름을 붙여 유일하게 만든다.
    find: '"peerDependencies": {\n    "bimm-ts": ">=0.2.1 <1.0.0"',
    with: '"peerDependencies": {\n    "bimm-ts": "^0.2.1"',
    caughtBy: "peer 범위가 0.x 의 새 마이너를 배제하지 않는다",
  },
];

const only = process.argv[2];
const chosen = only ? DEFECTS.filter((d) => d.name.includes(only)) : DEFECTS;
if (chosen.length === 0) {
  console.error(`이름에 '${only}' 가 든 결함이 없다`);
  process.exit(2);
}

/** 검사를 한 번 돌리고, 무엇이 일어났는지 셋 중 하나로 답한다. */
function run() {
  let text;
  try {
    text = execFileSync("npm", ["test"], { encoding: "utf8", stdio: "pipe" });
  } catch (err) {
    text = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }

  // **검사가 돌기는 했는가.** 이것을 먼저 본다 — 컴파일이 안 되면 결함이 통과한 것도
  // 아니고 잡힌 것도 아니다. 셋을 가르는 축이 여기다.
  //
  // 노드의 기본 리포터는 TAP 이 아니라 `ℹ tests N` 과 `✖ 이름` 을 쓴다. 처음에 TAP 을
  // 가정했더니 **돌아간 검사를 "못 돌았다" 로 읽었다** — 이 도구가 찾으려던 바로 그
  // 결함을 이 도구가 갖고 있었다. 그래서 두 형식을 다 본다.
  const ran = /^(ℹ tests |# tests )\d+/m.test(text);
  if (!ran) {
    const first = text.split("\n").find((l) => /error TS\d+|Error:|error:/.test(l));
    return { kind: "stop", why: first?.trim() ?? "무엇이 막았는지 못 읽었다", failed: [] };
  }

  const failed = [
    ...[...text.matchAll(/^✖ (.+?)(?: \([\d.]+ms\))?$/gm)].map((m) => m[1].trim()),
    ...[...text.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim()),
  ].filter((n) => n !== "failing tests:");

  return failed.length === 0
    ? { kind: "green", failed: [] }
    : { kind: "red", failed: [...new Set(failed)] };
}

const results = [];
for (const d of chosen) {
  const before = readFileSync(d.file, "utf8");
  const hits = before.split(d.find).length - 1;
  if (hits !== 1) {
    results.push({ d, kind: "stale", why: `find 가 ${hits}번 맞았다 (1번이어야 한다)` });
    continue;
  }
  writeFileSync(d.file, before.replace(d.find, d.with));
  try {
    const r = run();
    const hit = d.caughtBy === null
      ? null
      : r.failed.some((f) => f.includes(d.caughtBy));
    results.push({ d, ...r, hit });
  } finally {
    writeFileSync(d.file, before); // 무슨 일이 있어도 되돌린다
  }
}

const MARK = { red: "red  ", green: "green", stop: "stop ", stale: "STALE" };
let bad = 0;
console.log("");
for (const r of results) {
  const { d } = r;
  let note;
  if (r.kind === "stale") { note = r.why; bad += 1; }
  else if (r.kind === "green" && d.expect === "green") {
    // **초록 둘을 가른다.** 아무도 안 재는 것과, 여기서는 못 재고 다른 데서 재는
    // 것은 다른 일이다. 한 문구로 적으면 이미 메운 구멍이 안 메운 것처럼 남는다.
    note = d.elsewhere === undefined
      ? "아무것도 안 잡는다 — **알고 있는 구멍**이다. 위 주석에 이유가 있다"
      : `여기서는 못 잰다 — 재는 곳은 ${d.elsewhere}`;
  }
  else if (r.kind === "green") { note = "아무것도 안 잡았다 — 이 결함은 통과한다"; bad += 1; }
  else if (r.kind === "stop") { note = `검사가 못 돌았다 — ${r.why}`; }
  else if (r.hit === false) { note = `딴 것이 잡았다: ${r.failed.join(", ")}`; bad += 1; }
  else if (r.hit === null) { note = `잡혔다: ${r.failed.join(", ")}`; }
  else if (d.expect === "green") { note = `초록일 줄 알았는데 잡혔다 — ${r.failed.join(", ")}`; }
  else { note = `그 검사가 잡았다 — ${r.failed.length}건`; }
  console.log(`  ${MARK[r.kind]}  ${d.name}`);
  console.log(`         ${note}`);
}
console.log("");
if (bad > 0) {
  console.error(`${bad}개가 기대와 다르다.`);
  process.exit(1);
}
console.log(`${results.length}개 전부 기대대로 잡혔다.`);
