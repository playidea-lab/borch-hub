"""카탈로그의 ResNet-18 과 코어 벤치의 것을 대조한다.

    npm run parity

**창을 안 띄워도 된다.** 이 검사가 보는 것은 `stateDict` 의 열쇠와 모양이고, 그건
장치가 안 바꾼다 — 소프트웨어 어댑터에서 나온 결과도 그대로 유효하다. 시간을 재는
검사와 갈리는 자리라 여기서는 어댑터를 막지 않고 **무엇을 증명했는지만 좁혀 적는다.**
"""

import sys

from launch import browser as browser_of, warn_if_software
from serve import HUB, serve

TIMEOUT_MS = 120_000


def main(argv: list[str]) -> int:
    built = HUB / "dist" / "browser" / "parity.js"
    if not built.exists():
        print(f"방출물이 없다: {built}\n  먼저: npm run build", file=sys.stderr)
        return 2
    core_dist = HUB.parent / "borch" / "borch-ts" / "dist" / "test" / "bench.js"
    if not core_dist.exists():
        print(f"코어 방출물이 없다: {core_dist}\n"
              "  옆의 코어에서 먼저: npm run build:ts", file=sys.stderr)
        return 2

    port, stop = serve()
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p, browser_of(p, headed="--headed" in argv) as browser:
            page = browser.new_page()
            page.set_default_timeout(0)
            page.on("pageerror", lambda e: print(f"  [브라우저 예외] {e}"))
            page.on("console", lambda m: print(f"  {m.text}") if m.type == "error" else None)
            page.goto(f"http://127.0.0.1:{port}/borch-hub/browser/parity.html")
            page.wait_for_function("window.__borchHubParity !== undefined", timeout=TIMEOUT_MS)
            result = page.evaluate("window.__borchHubParity")
    finally:
        stop()

    print(result["text"])
    warn_if_software(result.get("adapter"), "대조 결과")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
