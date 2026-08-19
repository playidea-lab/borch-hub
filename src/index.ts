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
 */

export {
  checkEnvironment, fetchManifest, fetchWeights, load, resolve,
  type EnvironmentReport, type Loaded, type LoadOptions,
} from "./load.js";
export { verify, type VerifyResult } from "./verify.js";
export { sha256Hex } from "./hash.js";

export { createModel, factories, factorySpec } from "./models/registry.js";
export { checkArgs, type ArgSpec, type FactoryArgs } from "./models/args.js";
export { BasicBlock, ResNet18 } from "./models/resnet.js";

export {
  BorchHubError,
  SCHEMA_VERSION,
  parseManifest,
  type Arch,
  type License,
  type Manifest,
  type Metrics,
  type Origin,
  type Runtime,
  type Sample,
  type WebGPURequirement,
  type Weights,
} from "./manifest.js";
