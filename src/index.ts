/**
 * borch-hub — borch 런타임이 바로 불러 돌릴 수 있는 모델의 배포·검증 클라이언트.
 *
 * ## 지금 여기 있는 것은 계약뿐이다
 *
 * 매니페스트 주소 하나로 돌 준비가 된 모델까지 간다:
 *
 * ```ts
 * await init();
 * const { model, manifest } = await load("https://.../manifest.json");
 * const badge = await verify(model, manifest, "https://.../manifest.json");
 * ```
 *
 * 순서가 요점이다 — 환경 판정 → 받기 → 해시 대조 → 싣기. 앞의 둘이 뒤바뀌면
 * 45MB 를 받은 뒤에 "이 브라우저에서는 안 됩니다" 라고 말하게 된다.
 *
 * 계약을 먼저 두는 이유는 반대다. 매니페스트는 **한 번 배포되면 못 바꾼다** —
 * 남의 페이지가 이미 그 URL 을 박아두고 그 필드를 읽고 있기 때문이다.
 *
 * ## 카탈로그는 `bimm` 에 있다
 *
 * 아키텍처 표와 `createModel` 은 이 패키지에서 갈라져 나갔다. 방향 때문이다 —
 * 허브는 카탈로그를 알아야 하지만 카탈로그는 매니페스트를 몰라도 되고, 알면 모델
 * 하나 만들려는 사람이 배포·검증 계층을 끌어온다.
 */

export {
  checkEnvironment, fetchManifest, fetchWeights, load, resolve,
  type EnvironmentReport, type Loaded, type LoadOptions,
} from "./load.js";
export { verify, type VerifyResult } from "./verify.js";
export {
  preprocessGaps, readOutput, transformFor, type Reading,
} from "./preprocess.js";
export { sha256Hex } from "./hash.js";

// **카탈로그는 여기서 재수출하지 않는다.** 모델을 만들려는 사람은 `bimm` 을 직접
// 임포트한다 — 이 패키지를 거쳐 가게 만들면 아키텍처 하나 쓰려고 매니페스트·해시·
// 환경 판정을 전부 끌어오게 되고, 그 방향이 정확히 둘을 가른 이유다.
export { createModelFor } from "./arch.js";
export {
  fetchIndex, newest, parseListing, type Listed, type Listing,
} from "./listing.js";

export {
  BorchHubError,
  SCHEMA_VERSION,
  SCHEMA_VERSIONS,
  parseManifest,
  type Arch,
  type Outputs,
  type Preprocess,
  type License,
  type Manifest,
  type Metrics,
  type Origin,
  type Runtime,
  type Sample,
  type WebGPURequirement,
  type Weights,
} from "./manifest.js";
