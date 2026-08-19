"""두 저장소를 **파일시스템과 같은 모양으로** 얹는다.

## 왜 공통 부모를 얹는가

페이지가 코어의 `dist` 와 이 저장소의 `dist` 를 둘 다 싣는다. 각각을 다른 접두사로
얹으면(`/core`, `/hub`) 컴파일러가 뱉은 상대 경로가 전부 어긋난다 — `dist/browser/`
에서 `../../borch/...` 라고 적힌 것은 **나란히 놓인 배치**를 전제하기 때문이다.
URL 모양을 파일 모양과 같게 두면 그 전제가 그대로 맞는다.

## 그렇다고 부모 전체를 열지는 않는다

공통 부모에는 다른 저장소들도 있다. 127.0.0.1 에만 묶이는 임시 서버라도 필요 없는
것을 여는 이유는 없으므로, 맨 앞 칸이 이 둘 중 하나가 아니면 거절한다.
"""

import functools
import http.server
import pathlib
import socketserver
import threading

HUB = pathlib.Path(__file__).resolve().parents[1]
PARENT = HUB.parent
CORE = PARENT / "borch"
REGISTRY = PARENT / "borch-hub-registry"

# 얹는 것은 이 셋뿐이다. 레지스트리가 여기 있는 이유는 **진짜 배치가 그 모양**이기
# 때문이다 — 매니페스트와 샘플은 레지스트리에서 오고 가중치만 CDN 에서 온다.
# 로컬에서 그 모양대로 돌려봐야 상대·절대 주소가 섞인 자리가 실제로 걸린다.
ALLOWED = (HUB.name, CORE.name, REGISTRY.name)


class _Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        translated = super().translate_path(path)
        # 허용한 저장소 밖이면 없는 것으로 친다. 상위 경로(`..`)는 위 호출이 이미
        # 정규화하므로 여기서는 결과만 보면 된다.
        try:
            first = pathlib.Path(translated).resolve().relative_to(PARENT).parts[0]
        except (ValueError, IndexError):
            return str(PARENT / "(거절)")
        return translated if first in ALLOWED else str(PARENT / "(거절)")

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        # **설명 안 된 404 를 덮어두지 않는다.** 코어의 러너가 한 번 404 HTML 을
        # 자바스크립트로 받아 엉뚱한 자리에서 터진 적이 있다.
        if code == 404:
            print(f"  [404] {self.path}")
        super().send_error(code, message, explain)

    def log_message(self, fmt: str, *args: object) -> None:
        """요청 한 줄씩 찍는 기본 동작을 끈다 — 학습 한 판이 수천 줄이 된다."""


def serve() -> tuple[int, "threading.Event | object"]:
    """임시 포트에 얹고 (포트, 종료함수) 를 돌려준다."""
    handler = functools.partial(_Handler, directory=str(PARENT))
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1], httpd.shutdown
