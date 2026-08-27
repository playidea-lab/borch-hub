/**
 * **선언한 의존 범위가 새 카탈로그를 막지 않는지** 본다.
 *
 * ## 왜 이런 검사가 있나
 *
 * 카탈로그가 0.2.0 으로 두 번째 아키텍처를 실었고, 매니페스트도 CDN 바이트도 준비됐는데
 * 허브가 그 모델을 못 만들었다. 원인은 `package.json` 한 줄이었다 — peer 가 `^0.1.0`
 * 이었고, **0.x 에서 `^` 는 마이너를 메이저처럼 다룬다**(`>=0.1.0 <0.2.0`). npm 이
 * 0.2.0 을 배제하고 0.1.0 을 깔았고, 남는 것은 `unknown factory` 뿐이었다.
 *
 * 그 실패는 우리 쪽에서 안 보인다. 컴파일도 되고 검사도 통과한다 — **설치하는 사람의
 * 자리에서만** 드러난다. 그래서 여기서 본다.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createModelFor } from "../src/arch.js";
import { BorchHubError } from "../src/manifest.js";

// dist/test/ 에서 두 칸 위가 저장소 뿌리다.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Manifest {
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}

/** 잠금 파일이 뿌리 패키지에 대해 적어 둔 것. `packages[""]` 가 그 자리다. */
interface Lock {
  readonly packages: Readonly<Record<string, Partial<Manifest>>>;
}

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Manifest;
}

function lock(): Lock {
  return JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as Lock;
}

test("peer 범위가 0.x 의 새 마이너를 배제하지 않는다", () => {
  for (const [name, range] of Object.entries(manifest().peerDependencies)) {
    // `^0.` 하나가 이 사고의 전부였다. 문자열로 잡는 것이 얕지만, 잡으려는 것이
    // 정확히 그 문자열이다.
    assert.ok(
      !range.startsWith("^0."),
      `${name}: '${range}' — 0.x 에서 ^ 는 마이너를 배제한다. '>=x.y.z <1.0.0' 로 적을 것`,
    );
    assert.match(
      range,
      /<1\.0\.0/,
      `${name}: '${range}' — 0.x 안에서만 열어야 한다. 1.0.0 은 깨지는 판이다`,
    );
  }
});

test("검사가 도는 카탈로그도 같은 규칙을 따른다", () => {
  // dev 가 좁으면 CI 는 옛 카탈로그를 보고 초록을 켠다 — 사용자가 받는 것과 다른
  // 것을 본다는 뜻이고, 그것이 이 사고의 절반이었다.
  const dev = manifest().devDependencies;
  for (const name of ["bimm-ts", "borch-ts"]) {
    const range = dev[name];
    assert.ok(range !== undefined, `${name} 이 devDependencies 에 있어야 합니다`);
    assert.ok(!range.startsWith("^0."), `${name}: '${range}' — 위와 같은 이유`);
  }
});

test("잠금 파일이 같은 범위를 적고 있다", () => {
  // **CI 는 `npm ci` 다 — 실제로 깔리는 것을 정하는 것은 잠금 파일이지 `package.json`
  // 이 아니다.** 그래서 위 두 검사만으로는 부족했다: `package.json` 을 넓혀도 잠금
  // 파일에 `^0.2.3` 이 남아 있으면 CI 는 계속 0.2.x 만 보고, 새 마이너가 허브를
  // 깨는 날 그것을 아무도 못 본다. 실제로 그렇게 어긋나 있었다.
  //
  // `npm ci` 는 이 어긋남을 안 막는다 — 잠긴 판이 선언한 범위를 만족하기만 하면
  // 통과다. 즉 **좁아진 것은 오류로 안 보인다.** 그 구별을 여기서 한다.
  const declared = manifest();
  const recorded = lock().packages[""];
  assert.ok(recorded !== undefined, "잠금 파일에 뿌리 패키지가 있어야 합니다");

  for (const kind of ["peerDependencies", "devDependencies"] as const) {
    for (const [name, range] of Object.entries(declared[kind])) {
      assert.equal(
        recorded[kind]?.[name],
        range,
        `${kind}.${name}: package.json 은 '${range}' 인데 잠금 파일은 `
        + `'${String(recorded[kind]?.[name])}' 입니다 — \`npm install\` 로 맞출 것`,
      );
    }
  }
});

test("설치된 카탈로그가 레지스트리에 나간 모델을 안다", () => {
  // 범위를 열어 두는 것만으로는 부족하다. **실제로 무엇이 깔렸는지**를 본다.
  //
  // 카탈로그가 이름을 알아들으면 장치가 없다고 멈추고, 못 알아들으면 그런 이름이
  // 없다고 멈춘다. 두 멈춤이 다르다는 것이 곧 이름이 닿았다는 증거다.
  const err = ((): unknown => {
    try {
      createModelFor({ library: "timm", factory: "mobilenetv2_100", args: { numClasses: 1000 } });
      return null;
    } catch (caught) {
      return caught;
    }
  })();

  assert.ok(err instanceof Error, "장치가 없으므로 무언가 던져야 합니다");
  assert.ok(
    !(err instanceof BorchHubError),
    `카탈로그까지 갔어야 합니다 — ${err.message}`,
  );
  assert.ok(
    !err.message.includes("unknown factory"),
    `설치된 카탈로그가 이 모델을 모릅니다 — 범위가 새 판을 막고 있습니다.\n  ${err.message}`,
  );
  assert.match(err.message, /device|init/i);
});
