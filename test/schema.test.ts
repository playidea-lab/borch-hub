/**
 * **정본 스키마가 말하는 것을 거울이 실제로 지키는지** 본다.
 *
 * ## 두 벌이 있고, 아무도 대조하지 않았다
 *
 * 매니페스트 규칙은 두 군데 있다. 올리는 쪽이 검사받는 것은 레지스트리의
 * `schema/manifest.schema.json` 이고, 받는 쪽이 검사하는 것은 `src/manifest.ts` 다.
 * 정본은 앞엣것이고 뒤엣것은 그것을 TypeScript 로 옮긴 거울이다.
 *
 * 갈리면 **레지스트리는 통과시키는데 클라이언트가 거절하는** 매니페스트가 생긴다.
 * 올린 사람은 자기 파이프라인이 전부 초록이라 모르고, 받는 사람은 왜 안 되는지
 * 모른다 — **양쪽 다 상대가 틀렸다고 생각한다.**
 *
 * ## 글자를 대 보지 않고 행동을 대 본다
 *
 * JSON Schema 와 손으로 쓴 파서는 모양이 달라서 문서끼리 비교할 수가 없다. 대신
 * **스키마에서 주장을 뽑아 거울에게 물어본다** — 스키마가 값 셋을 허용하면 셋 다
 * 넣어 보고, 목록에 없는 값도 하나 넣어 본다. 스키마에 `lanczos` 가 추가되는 날
 * 이 검사가 그것을 넣어 보고, 거울이 모르면 그 자리에서 빨개진다.
 *
 * ## 사본이 낡는 문제는 여기서 안 푼다
 *
 * 이 파일이 읽는 것은 저장소에 든 **사본**이다. 사본이 정본과 같은지는 다른 질문이고,
 * CI 가 따로 묻는다(`schema:fresh`). 두 질문을 한 검사에 넣으면 네트워크가 끊긴 날
 * "거울이 갈렸다" 로 읽힌다.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseManifest } from "../src/manifest.js";

import { broken, whole } from "./fixture.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Schema {
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
}

function schema(): Schema {
  const raw = readFileSync(join(ROOT, "schema", "manifest.schema.json"), "utf8");
  return JSON.parse(raw) as Schema;
}

/** 스키마가 값 집합을 못박아 둔 자리. `enum` 과 `const` 를 한 가지로 본다. */
function choices(): Map<string, readonly unknown[]> {
  const found = new Map<string, readonly unknown[]>();
  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== "object") return;
    const doc = node as Record<string, unknown>;
    if (Array.isArray(doc["enum"])) found.set(path, doc["enum"]);
    if (doc["const"] !== undefined) found.set(path, [doc["const"]]);
    const props = doc["properties"];
    if (props !== undefined && typeof props === "object" && props !== null) {
      for (const [key, child] of Object.entries(props)) {
        walk(child, path === "" ? key : `${path}.${key}`);
      }
    }
    const items = doc["items"];
    if (items !== undefined) walk(items, path);
  };
  walk(schema(), "");
  return found;
}

/**
 * 값을 넣기 전에 **그 값이 앉을 자리를 온전하게** 만들어 둔다.
 *
 * 픽스처의 `resize` 는 `null` 이다. 거기에 `interpolation` 만 꽂으면 `shortSide` 가
 * 없는 `resize` 가 되고, 거울은 보간 이름이 아니라 **빠진 형제 때문에** 거절한다.
 * 그러면 이 검사는 틀린 이유로 빨개진다 — 여기가 정확히 그렇게 한 번 틀렸다.
 *
 * 값은 여전히 스키마에서 온다. 이 표가 정하는 것은 그릇뿐이다.
 */
const SEEDS: Readonly<Record<string, Record<string, unknown>>> = {
  "preprocess.resize": { shortSide: 40, interpolation: "bilinear" },
};

/** 점으로 이어진 자리에 값을 넣는다. 가는 길에 없는 칸은 그릇 표를 보고 만든다. */
function put(doc: Record<string, unknown>, path: string, value: unknown): void {
  const steps = path.split(".");
  let here = doc;
  const walked: string[] = [];
  for (const step of steps.slice(0, -1)) {
    walked.push(step);
    const next = here[step];
    if (next === null || typeof next !== "object") {
      here[step] = { ...(SEEDS[walked.join(".")] ?? {}) };
    }
    here = here[step] as Record<string, unknown>;
  }
  here[steps[steps.length - 1] as string] = value;
}

/** 값을 갈아 끼우기 **전의** 그릇이 이미 통과하는지. 아니면 이 자리의 답은 못 믿는다. */
function containerIsSound(path: string): boolean {
  const steps = path.split(".");
  if (steps.length === 1) return true;
  try {
    parseManifest(broken((d) => {
      const seed = SEEDS[steps.slice(0, -1).join(".")];
      if (seed !== undefined) put(d, steps.slice(0, -1).join("."), { ...seed });
    }));
    return true;
  } catch {
    return false;
  }
}

function accepts(path: string, value: unknown): boolean {
  try {
    parseManifest(broken((d) => put(d, path, value)));
    return true;
  } catch {
    return false;
  }
}

/**
 * `schemaVersion` 은 값이 아니라 **모양**을 바꾼다 — 판 1 에는 `preprocess` 도
 * `outputs` 도 없다. 값 하나만 갈아 끼우는 이 검사로는 그것을 못 묻는다.
 * 판 1 이 아직 실리는지는 `arch.test.ts` 가 본다.
 */
const SHAPE_NOT_VALUE = new Set(["schemaVersion"]);

test("스키마가 허용하는 값을 거울도 전부 받는다", () => {
  const table = choices();
  assert.ok(table.size >= 4, `뽑힌 자리가 너무 적습니다 — ${table.size}개`);

  for (const [path, allowed] of table) {
    if (SHAPE_NOT_VALUE.has(path)) continue;
    assert.ok(
      containerIsSound(path),
      `${path}: 값을 넣기 전의 그릇이 이미 거절당합니다 — SEEDS 를 채울 것.\n`
      + "  이대로 두면 아래 답이 전부 '거절' 이 되고, 그것은 갈림이 아니라 검사 잘못입니다",
    );
    for (const value of allowed) {
      assert.ok(
        accepts(path, value),
        `${path}: 스키마는 ${JSON.stringify(value)} 를 허용하는데 거울이 거절합니다\n`
        + "  레지스트리는 통과시키고 클라이언트가 막는 매니페스트가 됩니다",
      );
    }
  }
});

test("스키마에 없는 값은 거울도 거절한다", () => {
  // 반대 방향이다. 거울이 아무거나 받으면 위 검사는 통과하지만, 거울은 규칙을
  // 지키는 것이 아니라 **안 보고 있는** 것이다.
  const outsider = "이-집합에-없는-값";
  for (const [path] of choices()) {
    if (SHAPE_NOT_VALUE.has(path)) continue;
    assert.ok(
      !accepts(path, outsider),
      `${path}: 거울이 목록에 없는 값을 받습니다 — 그 자리를 안 보고 있습니다`,
    );
  }
});

test("스키마가 요구하는 필드를 빼면 거울이 거절한다", () => {
  for (const field of schema().required) {
    if (SHAPE_NOT_VALUE.has(field)) continue;
    const rejected = ((): boolean => {
      try {
        parseManifest(broken((d) => { delete d[field]; }));
        return false;
      } catch {
        return true;
      }
    })();
    assert.ok(
      rejected,
      `${field}: 스키마는 필수라는데 거울은 없어도 받습니다\n`
      + "  거울이 더 무르면, 클라이언트가 못 쓸 매니페스트를 통과시킵니다",
    );
  }
});

test("온전한 매니페스트는 그대로 지나간다", () => {
  // 위 셋이 전부 '거절하는가' 를 묻는다. 거울이 무엇이든 거절하게 되어도 그 셋은
  // 통과한다 — 그래서 지나가야 하는 것 하나를 같이 둔다.
  assert.doesNotThrow(() => parseManifest(whole()));
});
