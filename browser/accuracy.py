"""**매니페스트가 말한 대로 사진을 넣어, 얼마나 맞히는지 잰다.**

    npm run accuracy -- --manifest https://models.pilab.kr/imagenet-mobilenetv2-100/1.0.0/manifest.json
    npm run accuracy -- --manifest ... --limit 100 --headed

## 왜 이 수가 필요한가

나가 있는 모델 열 중 여덟에 `metrics` 가 비어 있다. 고르는 사람이 볼 수 있는 것은
"샘플 한 장을 재현한다" 는 배지뿐인데, 그것은 **변환이 충실하다**는 증거지 **얼마나
맞히느냐**가 아니다.

## 사진은 ImageNet-V2 다 — ImageNet 이 아니다

`scripts/fetch_images.py` 가 클래스마다 한 장씩 받아 둔다. ImageNet 과 같은 1000
클래스를 같은 방식으로 새로 모은 것이고, MIT 이며 등록이 필요 없다.

**점수를 `top1` 이라 부르면 안 된다.** ImageNet-V2 점수는 ImageNet val 보다 체계적으로
11~14% 낮다 — 그것이 그 논문의 결론이다. 이 수는 `top1_imagenetv2` 다.

## CI 가 안 돈다

모델 하나에 몇 분이다. 화물을 만들 때 한 번 재서 매니페스트에 박는 쪽이 맞고, 매
커밋마다 도는 것은 `roundtrip` 이다.
"""

import argparse
import json
import os
import pathlib
import sys
import time

from launch import browser as browser_of
from roundtrip import _reap
from serve import HUB, serve

TIMEOUT_MS = 3_600_000
POLL_MS = 500
VERDICT = "__BORCH_ACCURACY__"

IMAGES = "imagenetv2-1perclass"
OUT = HUB / "out" / "accuracy"


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(line_buffering=True)
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", required=True, help="매니페스트 주소")
    ap.add_argument("--images", default=IMAGES, help=f"사진 폴더 (기본 {IMAGES})")
    ap.add_argument("--limit", type=int, default=1000)
    ap.add_argument("--headed", action="store_true")
    args, _ = ap.parse_known_args(argv)

    if not (HUB / "dist" / "browser" / "accuracy.js").exists():
        print("방출물이 없다 — 먼저: npm run build:browser", file=sys.stderr)
        return 2
    listing = HUB / args.images / "index.json"
    if not listing.exists():
        print(f"사진 목록이 없다: {listing}\n"
              "  먼저: uv run python scripts/fetch_images.py", file=sys.stderr)
        return 2

    port, stop = serve()
    try:
        return _run(port, args)
    finally:
        stop()


def _run(port: int, args: argparse.Namespace) -> int:
    from playwright.sync_api import sync_playwright

    verdict: dict[str, object | None] = {"value": None}
    with sync_playwright() as p, browser_of(p, headed=args.headed) as browser:
        page = browser.new_page()
        page.set_default_timeout(0)
        page.on("pageerror", lambda e: print(f"  [브라우저 예외] {e}"))
        page.on("crash", lambda _p: print("  [페이지가 죽었다]", flush=True))

        def heard(text: str) -> None:
            if text.startswith(VERDICT):
                verdict["value"] = json.loads(text[len(VERDICT):])
                return
            print(f"  {text}", flush=True)

        page.on("console", lambda m: heard(m.text))
        images = f"http://127.0.0.1:{port}/borch-hub/{args.images}/index.json"
        page.goto(f"http://127.0.0.1:{port}/borch-hub/browser/accuracy.html"
                  f"?manifest={args.manifest}&images={images}&limit={args.limit}")

        deadline = time.monotonic() + TIMEOUT_MS / 1000
        while verdict["value"] is None and time.monotonic() < deadline:
            page.wait_for_timeout(POLL_MS)
        if verdict["value"] is None:
            print(f"판정이 {TIMEOUT_MS // 1000}초 안에 오지 않았다.", flush=True)
            _reap()
            return 1

        result = verdict["value"]
        # **`with` 를 나가기 전에 찍는다.** 큰 화물에서 `browser.close()` 가 돌아오지
        # 않는 것을 되싣기에서 실측했고, 여기 화물은 그보다 크지 않을 이유가 없다.
        if "error" in result:
            print(f"재지 못했다: {result['error']}", flush=True)
            sys.stdout.flush()
            _reap()
            os._exit(1)

        name = args.manifest.rstrip("/").split("/")[-3:-1]
        OUT.mkdir(parents=True, exist_ok=True)
        where = OUT / f"{'-'.join(name)}.json"
        where.write_text(json.dumps({
            "manifest": args.manifest,
            "metric": "top1_imagenetv2",
            **result,
        }, indent=2, ensure_ascii=False) + "\n")
        print(f"\n  n={result['n']}  top1_imagenetv2={result['top1']:.4f}"
              f"  top5={result['top5']:.4f}"
              + (f"  (못 읽은 사진 {result['failed']}장)" if result["failed"] else ""),
              flush=True)
        print(f"  → {where.relative_to(HUB)}", flush=True)
        sys.stdout.flush()
        _reap()
        os._exit(0)

    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
