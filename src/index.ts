/**
 * borch-hub — borch 런타임이 바로 불러 돌릴 수 있는 모델의 배포·검증 클라이언트.
 *
 * ## 지금 여기 있는 것은 계약뿐이다
 *
 * 매니페스트를 읽고 거절하는 것까지가 지금의 전부다. 받아 오는 것(`load`)과
 * 대조하는 것(`verify`), 그리고 구조를 되살리는 카탈로그(`createModel`)는
 * **아직 없다.** 빈 함수로 자리만 잡아두지 않은 것은 일부러다 — 코어 저장소가
 * 여러 번 적어둔 대로, 사용자 없는 표면은 케이스가 안 생기고 케이스 없는 표면이
 * 조용히 틀린다. 첫 모델 하나를 끝까지 통과시키면서 같이 나올 것이다.
 *
 * 계약을 먼저 두는 이유는 반대다. 매니페스트는 **한 번 배포되면 못 바꾼다** —
 * 남의 페이지가 이미 그 URL 을 박아두고 그 필드를 읽고 있기 때문이다.
 */

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
