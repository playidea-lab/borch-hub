/**
 * 매니페스트 — borch-hub 의 유일한 계약.
 *
 * ## 이 파일이 스펙의 정본이 아니다
 *
 * 정본은 `borch-hub-registry/schema/manifest.schema.json` 이다. 여기 있는 것은 그것을
 * TypeScript 로 옮긴 **거울**이고, 거울은 원본과 갈릴 수 있다. 갈리면 레지스트리는
 * 통과시키는데 클라이언트가 거절하는 매니페스트가 생기고, 그건 올린 사람이 아니라
 * 받는 사람이 만난다. CI 가 스키마를 받아 대조하게 만드는 것이 다음 할 일이다.
 *
 * ## 왜 선택 필드를 쓰지 않고 전부 `| null` 인가
 *
 * "없음"을 표현하는 방법이 둘(`undefined` 와 `null`)이면 비교하는 자리마다 둘 다
 * 다뤄야 하고, 한쪽을 빠뜨린 것은 그 값이 실제로 비는 날에만 드러난다. JSON 에는
 * `undefined` 가 없으므로 들어오는 쪽을 `null` 하나로 좁힌다.
 *
 * ## 왜 파싱이 곧 검증인가
 *
 * `JSON.parse` 가 준 것은 `unknown` 이다. 그대로 형만 붙이면(`as Manifest`) 틀린
 * 매니페스트가 타입 검사를 통과해서 **로더 한참 안쪽에서** 터진다. 여기서 한 번
 * 걸러 두면 그 뒤로는 모양을 믿을 수 있다.
 */

/**
 * 이 클라이언트가 읽을 수 있는 스펙 판들.
 *
 * **옛 판을 계속 읽는다.** 받는 쪽이 옛 매니페스트를 거절하면 그건 허브가 아니라
 * 한 판짜리 형식이다 — 이미 남의 페이지에 박힌 URL 이 어느 날 죽는다.
 *
 * 판 1 은 전처리·후처리 정보가 없고 `arch` 에 이름공간이 없다. 읽히기는 하되
 * `preprocess` 가 `null` 로 오므로, 그것을 쓰는 쪽이 없다는 것을 알고 갈라야 한다.
 */
export const SCHEMA_VERSIONS = [1, 2] as const;

/** 새로 쓰는 매니페스트가 따를 판. */
export const SCHEMA_VERSION = 2;

/** 매니페스트가 계약을 어겼을 때. 받는 쪽이 이 종류로 잡을 수 있어야 한다. */
export class BorchHubError extends Error {
  override readonly name = "BorchHubError";
}

/**
 * 이 가중치가 어디서 왔는가.
 *
 * 우리가 잰 수와 남이 발표한 수를 처음부터 다른 이름으로 부르기 위한 필드다.
 * `converted-from-torch` 인 모델의 정확도를 발표된 값과 비교하면 안 된다 —
 * 비트 동등은 borch 의 명시적 비목표라 지킬 수 없는 약속이다.
 */
export type Origin = "trained-by-borch" | "converted-from-torch";

export interface Arch {
  /**
   * `factory` 가 어느 카탈로그의 것인가. 판 1 에는 없어서 `null` 로 온다.
   *
   * **이름공간이 없으면 이 필드는 언젠가 거짓말이 된다.** torchvision 의
   * `resnet18` 과 timm 의 `resnet18` 은 다른 모델이고 가중치가 안 호환된다.
   * `borchvision` 과 `bimm` 이 둘 다 생기면 우리도 같은 자리에 선다.
   */
  readonly library: string | null;
  /** 카탈로그의 팩토리 이름. */
  readonly factory: string;
  /** 팩토리에 그대로 넘어간다. */
  readonly args: Readonly<Record<string, unknown>>;
}

/** 이미지 한 장이 입력 텐서가 되기까지. 판 1 에는 없다. */
export interface Preprocess {
  /** (C, H, W). 배치 축은 없다. */
  readonly inputSize: readonly [number, number, number];
  /** 정규화 **전** 값의 범위. `unit` 은 [0,1] — uint8 을 255 로 나눈 것. */
  readonly valueRange: "unit";
  readonly mean: readonly number[];
  readonly std: readonly number[];
  /**
   * 짧은 변을 이 길이로 맞춘다. 코어에 `vision.Resize` 가 생기면서 **적을 수만 있던
   * 필드가 실제로 수행된다** — 이 줄은 그 전 사정을 그대로 들고 있었다.
   *
   * 지금 레지스트리의 모델은 32×32 로 이미 맞아 들어와서 둘 다 `null` 이다. 값이
   * 든 채로 지나가는 길은 `test/resized.test.ts` 가 대신 밟아 둔다.
   */
  readonly resize:
    | { readonly shortSide: number;
        readonly interpolation: "nearest" | "bilinear" | "bicubic" }
    | null;
  readonly centerCrop: readonly [number, number] | null;
}

/** 나온 수를 어떻게 읽는가. 판 1 에는 없다. */
export interface Outputs {
  readonly kind: "logits";
  /** logits 의 자리마다 무엇인가. 없으면 argmax 가 3 이라는 것까지만 안다. */
  readonly classes: readonly string[] | null;
}

export interface Weights {
  readonly url: string;
  /** 받은 바이트 전체의 해시. 실으러 가기 전에 대조한다. */
  readonly sha256: string;
  /** 받기 전에 사용자에게 알려줄 수 있어야 한다. */
  readonly bytes: number;
  readonly format: "safetensors";
}

export interface WebGPURequirement {
  readonly required: boolean;
  /** 어댑터가 만족해야 할 최소 limits. 받기 전에 판정하려고 있는 것이다. */
  readonly limits: Readonly<Record<string, number>>;
}

export interface Runtime {
  /** npm `borch` 의 semver 범위. `null` 이면 이 런타임을 지원하지 않는다. */
  readonly ts: string | null;
  /** PyPI `borch` 의 semver 범위. */
  readonly py: string | null;
  readonly webgpu: WebGPURequirement | null;
}

export interface Sample {
  readonly inputUrl: string;
  readonly outputUrl: string;
  readonly rtol: number;
  readonly atol: number;
}

export interface Metrics {
  readonly values: Readonly<Record<string, number>>;
  /** 런타임·버전·브라우저·장치. 손으로 돌리므로 이 문자열이 유일한 기록이다. */
  readonly measuredBy: string;
  readonly measuredAt: string;
}

export interface License {
  readonly weights: string;
  readonly data: string | null;
}

export interface Manifest {
  readonly schemaVersion: number;
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly task: string | null;
  readonly dataset: string | null;
  readonly tags: readonly string[];
  readonly arch: Arch;
  readonly preprocess: Preprocess | null;
  readonly outputs: Outputs | null;
  readonly weights: Weights;
  readonly runtime: Runtime;
  readonly sample: Sample;
  readonly metrics: Metrics | null;
  readonly origin: Origin;
  readonly license: License;
  /** 검증 증거가 붙을 자리. 지금은 언제나 `null` 이다. */
  readonly attestation: Readonly<Record<string, unknown>> | null;
}

// --- 읽는 도구 -------------------------------------------------------------
// 어긋난 자리를 **경로와 함께** 말한다. "invalid manifest" 하나로는 42개 필드 중
// 어디가 틀렸는지 알 수 없고, 그러면 받는 쪽이 우리에게 물어봐야 한다.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function at(doc: Record<string, unknown>, key: string): unknown {
  return doc[key];
}

function fail(path: string, said: string): never {
  throw new BorchHubError(`매니페스트 ${path}: ${said}`);
}

function obj(doc: Record<string, unknown>, key: string, path: string): Record<string, unknown> {
  const v = at(doc, key);
  if (!isRecord(v)) fail(`${path}.${key}`, `객체여야 합니다 — ${typeof v} 를 받았습니다`);
  return v;
}

function str(doc: Record<string, unknown>, key: string, path: string): string {
  const v = at(doc, key);
  if (typeof v !== "string") fail(`${path}.${key}`, `문자열이어야 합니다 — ${typeof v} 를 받았습니다`);
  return v;
}

function num(doc: Record<string, unknown>, key: string, path: string): number {
  const v = at(doc, key);
  if (typeof v !== "number" || !Number.isFinite(v)) {
    fail(`${path}.${key}`, `유한한 수여야 합니다 — ${String(v)} 를 받았습니다`);
  }
  return v;
}

/** 없거나 `null` 이면 `null`. 있으면 문자열이어야 한다 — 숫자가 오는 것은 실수다. */
function strOrNull(doc: Record<string, unknown>, key: string, path: string): string | null {
  const v = at(doc, key);
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(`${path}.${key}`, `문자열이거나 없어야 합니다`);
  return v;
}

function numberList(v: unknown, path: string, least = 1): number[] {
  if (!Array.isArray(v)) fail(path, "배열이어야 합니다");
  if (v.length < least) fail(path, `원소가 ${least} 개 이상이어야 합니다`);
  return v.map((raw, i) => {
    if (typeof raw !== "number" || !Number.isFinite(raw)) fail(`${path}[${i}]`, "수여야 합니다");
    return raw;
  });
}

function numberMap(v: unknown, path: string): Record<string, number> {
  if (!isRecord(v)) fail(path, "객체여야 합니다");
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v)) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) fail(`${path}.${k}`, "수여야 합니다");
    out[k] = raw;
  }
  return out;
}

/**
 * `JSON.parse` 가 준 것을 매니페스트로 좁힌다. 어긋나면 `BorchHubError` 를 던진다.
 *
 * 스키마 전체를 여기서 다시 구현하지는 않는다 — 정규식까지 옮기면 두 벌이 되고,
 * 두 벌은 갈린다. 여기서 보는 것은 **로더가 실제로 읽는 필드의 모양**이고,
 * 값의 규칙(이름 패턴·semver 꼴)은 레지스트리 CI 가 병합 전에 본다.
 */
export function parseManifest(raw: unknown): Manifest {
  if (!isRecord(raw)) fail("(뿌리)", "객체여야 합니다");

  const schemaVersion = num(raw, "schemaVersion", "");
  if (!(SCHEMA_VERSIONS as readonly number[]).includes(schemaVersion)) {
    fail(
      ".schemaVersion",
      `this client reads ${SCHEMA_VERSIONS.join(" and ")}, not ${schemaVersion}.\n` +
        "  Upgrade borch-hub, or use a manifest this version understands.",
    );
  }

  const archDoc = obj(raw, "arch", "");
  const argsRaw = at(archDoc, "args");
  if (argsRaw !== undefined && !isRecord(argsRaw)) fail(".arch.args", "객체여야 합니다");

  const weightsDoc = obj(raw, "weights", "");
  const format = str(weightsDoc, "format", ".weights");
  if (format !== "safetensors") {
    fail(".weights.format", `safetensors 여야 합니다 — '${format}' 를 받았습니다`);
  }

  const runtimeDoc = obj(raw, "runtime", "");
  const webgpuRaw = at(runtimeDoc, "webgpu");
  let webgpu: WebGPURequirement | null = null;
  if (isRecord(webgpuRaw)) {
    const required = at(webgpuRaw, "required");
    if (typeof required !== "boolean") fail(".runtime.webgpu.required", "참/거짓이어야 합니다");
    const limitsRaw = at(webgpuRaw, "limits");
    webgpu = {
      required,
      limits: limitsRaw === undefined ? {} : numberMap(limitsRaw, ".runtime.webgpu.limits"),
    };
  }

  const ts = strOrNull(runtimeDoc, "ts", ".runtime");
  const py = strOrNull(runtimeDoc, "py", ".runtime");
  if (ts === null && py === null) {
    fail(".runtime", "ts 와 py 가 둘 다 비어 있습니다 — 어디서도 못 도는 모델입니다");
  }

  const sampleDoc = obj(raw, "sample", "");
  const licenseDoc = obj(raw, "license", "");

  const metricsRaw = at(raw, "metrics");
  let metrics: Metrics | null = null;
  if (isRecord(metricsRaw)) {
    metrics = {
      values: numberMap(at(metricsRaw, "values"), ".metrics.values"),
      measuredBy: str(metricsRaw, "measuredBy", ".metrics"),
      measuredAt: str(metricsRaw, "measuredAt", ".metrics"),
    };
  }

  const preRaw = at(raw, "preprocess");
  let preprocess: Preprocess | null = null;
  if (isRecord(preRaw)) {
    const size = numberList(at(preRaw, "inputSize"), ".preprocess.inputSize", 3);
    if (size.length !== 3) fail(".preprocess.inputSize", "(C, H, W) 셋이어야 합니다");
    const range = str(preRaw, "valueRange", ".preprocess");
    if (range !== "unit") fail(".preprocess.valueRange", `모르는 값입니다 — '${range}'`);

    const resizeRaw = at(preRaw, "resize");
    let resize: Preprocess["resize"] = null;
    if (isRecord(resizeRaw)) {
      const interp = str(resizeRaw, "interpolation", ".preprocess.resize");
      // `bicubic` 은 코어 0.2.0 부터 있다. timm 의 ImageNet 설정이 쓰는 보간이고,
      // 그것이 없던 동안 timm 화물은 전처리 한 항목을 두고 와야 했다 — bilinear 로
      // 바꿔 넣으면 top-1 이 68.5% 만 일치한다(실측).
      if (interp !== "nearest" && interp !== "bilinear" && interp !== "bicubic") {
        fail(".preprocess.resize.interpolation", `모르는 값입니다 — '${interp}'`);
      }
      resize = { shortSide: num(resizeRaw, "shortSide", ".preprocess.resize"), interpolation: interp };
    }

    const cropRaw = at(preRaw, "centerCrop");
    let centerCrop: Preprocess["centerCrop"] = null;
    if (Array.isArray(cropRaw)) {
      const two = numberList(cropRaw, ".preprocess.centerCrop", 2);
      centerCrop = [two[0] ?? 0, two[1] ?? 0];
    }

    preprocess = {
      inputSize: [size[0] ?? 0, size[1] ?? 0, size[2] ?? 0],
      valueRange: range,
      mean: numberList(at(preRaw, "mean"), ".preprocess.mean"),
      std: numberList(at(preRaw, "std"), ".preprocess.std"),
      resize,
      centerCrop,
    };
  }

  const outRaw = at(raw, "outputs");
  let outputs: Outputs | null = null;
  if (isRecord(outRaw)) {
    const kind = str(outRaw, "kind", ".outputs");
    if (kind !== "logits") fail(".outputs.kind", `모르는 값입니다 — '${kind}'`);
    const classesRaw = at(outRaw, "classes");
    let classes: string[] | null = null;
    if (Array.isArray(classesRaw)) {
      classes = classesRaw.map((c, i) => {
        if (typeof c !== "string") fail(`.outputs.classes[${i}]`, "문자열이어야 합니다");
        return c;
      });
    }
    outputs = { kind, classes };
  }

  // **판 2 는 둘 다 있어야 한다.** 스키마가 병합 전에 같은 것을 보지만, 받는 쪽이
  // 그것을 믿고 갈 수는 없다 — 매니페스트는 우리 CI 를 안 지나온 곳에서도 온다.
  if (schemaVersion >= 2) {
    if (preprocess === null) fail(".preprocess", "판 2 에는 있어야 합니다");
    if (outputs === null) fail(".outputs", "판 2 에는 있어야 합니다");
    if (strOrNull(archDoc, "library", ".arch") === null) {
      fail(".arch.library", "판 2 에는 있어야 합니다");
    }
  }

  const origin = str(raw, "origin", "");
  if (origin !== "trained-by-borch" && origin !== "converted-from-torch") {
    fail(".origin", `모르는 값입니다 — '${origin}'`);
  }

  const tagsRaw = at(raw, "tags");
  const tags: string[] = [];
  if (Array.isArray(tagsRaw)) {
    for (const [i, tag] of tagsRaw.entries()) {
      if (typeof tag !== "string") fail(`.tags[${i}]`, "문자열이어야 합니다");
      tags.push(tag);
    }
  }

  const attestationRaw = at(raw, "attestation");

  return {
    schemaVersion,
    name: str(raw, "name", ""),
    version: str(raw, "version", ""),
    description: strOrNull(raw, "description", ""),
    task: strOrNull(raw, "task", ""),
    dataset: strOrNull(raw, "dataset", ""),
    tags,
    preprocess,
    outputs,
    arch: {
      library: strOrNull(archDoc, "library", ".arch"),
      factory: str(archDoc, "factory", ".arch"),
      args: isRecord(argsRaw) ? argsRaw : {},
    },
    weights: {
      url: str(weightsDoc, "url", ".weights"),
      sha256: str(weightsDoc, "sha256", ".weights"),
      bytes: num(weightsDoc, "bytes", ".weights"),
      format: "safetensors",
    },
    runtime: { ts, py, webgpu },
    sample: {
      inputUrl: str(sampleDoc, "inputUrl", ".sample"),
      outputUrl: str(sampleDoc, "outputUrl", ".sample"),
      rtol: num(sampleDoc, "rtol", ".sample"),
      atol: num(sampleDoc, "atol", ".sample"),
    },
    metrics,
    origin,
    license: {
      weights: str(licenseDoc, "weights", ".license"),
      data: strOrNull(licenseDoc, "data", ".license"),
    },
    attestation: isRecord(attestationRaw) ? attestationRaw : null,
  };
}
