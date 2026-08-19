/**
 * 바이트의 sha256.
 *
 * 만드는 쪽과 받는 쪽이 **같은 함수**를 써야 한다. 두 벌이면 한쪽이 대문자 16진수를
 * 쓰거나 앞의 0 을 떨어뜨리는 날 대조가 조용히 실패한다 — 그리고 그 실패는 "가중치가
 * 변조됐다" 와 구별되지 않는다.
 */

import { BorchHubError } from "./manifest.js";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // SubtleCrypto 는 보안 컨텍스트에만 있다(https 와 127.0.0.1). 없으면 여기서
  // 멈추는 것이 맞다 — 해시를 못 재면 받은 바이트를 믿을 근거가 없고,
  // "확인 못 했지만 진행" 은 확인의 반대다.
  if (typeof crypto === "undefined" || crypto.subtle === undefined) {
    throw new BorchHubError(
      "SubtleCrypto 가 없습니다 — 가중치 해시를 확인할 수 없습니다.\n"
      + "  https 나 127.0.0.1 에서 여세요. 보안 컨텍스트가 아니면 브라우저가 이것을 감춥니다.",
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
