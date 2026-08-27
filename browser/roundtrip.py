"""만든 화물을 **다시 받아 되싣고 대조한다.**

    npm run train -- --dry-run --images 256 --epochs 1   # 먼저 화물을 만들고
    npm run roundtrip -- --dry                            # 그것으로 왕복을 본다

`out/` 를 CDN 자리에 세운다. 진짜 CDN 이 아니라도 **로더가 하는 일은 같다** —
주소로 받고, 길이를 보고, 해시를 대조하고, 통에 넣는다. 다른 것은 왕복 시간뿐이고
이 검사는 그것을 안 잰다.

발행한 뒤에는 **레지스트리에 쓴 매니페스트 그대로** 돌린다:

    npm run roundtrip -- --manifest models/cifar10-resnet18/1.0.0/manifest.json

그때 가중치는 진짜 CDN 에서 오고 샘플은 레지스트리에서 온다. 우리가 쓴 매니페스트를
우리가 만든 로더가 실제로 소화하는지는 그렇게만 확인된다 — 여기서 매니페스트를 지어
쓰면 검사가 자기 자신을 보는 것이 된다.

매니페스트는 여기서 쓴다. 가중치 주소는 **절대 주소**(서버가 방금 잡은 포트)로,
샘플 주소는 **상대 주소**로 적는다 — 진짜 배치가 그 모양이고(가중치는 CDN, 샘플은
매니페스트 옆), 로더가 둘 다 풀 줄 아는지 여기서 걸린다.
"""

import json
import os
import sys
import time

from launch import browser as browser_of
from serve import HUB, REGISTRY, serve

TIMEOUT_MS = 600_000
# 판정 줄이 왔는지 보는 간격.
POLL_MS = 200
# `browser/roundtrip.ts` 의 `VERDICT` 와 **같은 글자여야 한다.** 갈리면 판정이
# 평범한 로그 줄로 흘러가고, 이 검사는 아무 말 없이 시간을 채운다.
VERDICT = "__roundtrip__ "
# 답이 섰는지 보는 간격. `raf` 가 아니라 시계여야 하는 까닭은 아래 기다리는 자리에.
POLL_MS = 200


def _registry_manifest(port: int, rel: str) -> str:
    """레지스트리에 있는 매니페스트를 그 자리에서 얹어 준다."""
    path = REGISTRY / rel
    if not path.exists():
        raise SystemExit(f"레지스트리에 없다: {path}")
    return f"http://127.0.0.1:{port}/{path.relative_to(REGISTRY.parent).as_posix()}"


def main(argv: list[str]) -> int:
    # **줄 단위로 흘려보낸다.** 파이프로 나갈 때 파이썬 stdout 은 블록 버퍼링이라
    # 진행 줄이 몇 KB 쌓일 때까지 안 나온다. 한 시간짜리 실행에서 그것은 "아무것도
    # 안 보이는 한 시간" 이고, 도중에 죽으면 흘려보낸 것마저 사라진다 — 흘려보내는
    # 이유가 통째로 무의미해진다. 실측으로 걸렸다: 25 분 동안 0 바이트였다.
    sys.stdout.reconfigure(line_buffering=True)

    given = argv[argv.index("--manifest") + 1] if "--manifest" in argv else None
    out = HUB / "out" / "dry" if "--dry" in argv else HUB / "out"
    summary_path = out / "summary.json"
    if given is None and not summary_path.exists():
        print(f"화물이 없다: {summary_path}\n  먼저: npm run train", file=sys.stderr)
        return 2
    if not (HUB / "dist" / "browser" / "roundtrip.js").exists():
        print("방출물이 없다 — 먼저: npm run build:browser", file=sys.stderr)
        return 2

    port, stop = serve()
    try:
        if given is not None:
            manifest_url = _registry_manifest(port, given)
            print(f"레지스트리의 매니페스트로 돈다: {given}")
            return _run(port, manifest_url, argv)

        summary = json.loads(summary_path.read_text())
        rel = out.relative_to(HUB.parent).as_posix()
        base = f"http://127.0.0.1:{port}/{rel}"
        manifest = {
            "schemaVersion": 1,
            "name": "cifar10-resnet18",
            "version": "0.0.0",
            "task": "image-classification",
            "dataset": "cifar-10",
            "arch": {"factory": "resnet18", "args": {"numClasses": 10}},
            "weights": {
                "url": f"{base}/model.safetensors",
                "sha256": summary["sha256"],
                "bytes": summary["bytes"],
                "format": "safetensors",
            },
            # 자기 자신을 대조하는 실행이라 어댑터 한계는 안 건다. 한계를 거는 것은
            # 매니페스트를 쓰는 사람의 몫이고, 여기서 지어내면 이 검사가 그 사람의
            # 판단을 흉내 내는 것이 된다.
            "runtime": {"ts": ">=0.1.0", "py": None,
                        "webgpu": {"required": True, "limits": {}}},
            "sample": {"inputUrl": "sample.in.safetensors",
                       "outputUrl": "sample.out.safetensors",
                       "rtol": 1e-4, "atol": 1e-5},
            "origin": "trained-by-borch",
            "license": {"weights": "Apache-2.0", "data": "CIFAR-10 (research use)"},
            "attestation": None,
        }
        (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
        return _run(port, f"{base}/manifest.json", argv)
    finally:
        stop()


def _run(port: int, manifest_url: str, argv: list[str]) -> int:
    """페이지를 띄워 왕복을 시키고 보고서를 찍는다."""
    verdict: dict[str, object | None] = {"value": None}
    if True:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p, browser_of(p, headed="--headed" in argv) as browser:
            page = browser.new_page()
            page.set_default_timeout(0)
            page.on("pageerror", lambda e: print(f"  [브라우저 예외] {e}"))
            # **진행을 흘려보낸다.** 전에는 `error` 만 찍었고, 그래서 화면은 끝날
            # 때까지 비어 있었다 — "도는 중" 과 "멈춤" 이 구별되지 않는다. 이 검사가
            # 실제로 매달렸을 때 로그의 마지막 줄은 첫 줄이었고, 어느 단계인지
            # 알아내는 데만 여러 번을 버렸다.
            # 판정 줄은 가려내 담고, 나머지는 그대로 흘려보낸다.
            def heard(text: str) -> None:
                if text.startswith(VERDICT):
                    verdict["value"] = json.loads(text[len(VERDICT):])
                    return
                print(f"  {text}", flush=True)

            page.on("console", lambda m: heard(m.text))
            # 렌더러가 죽으면 위의 기다림은 이유 없이 시간을 채운다. 죽었다고 말한다.
            page.on("crash", lambda _p: print("  [페이지가 죽었다]", flush=True))
            page.goto(f"http://127.0.0.1:{port}/borch-hub/browser/roundtrip.html"
                      f"?manifest={manifest_url}")
            # **판정은 줄로 온다.** 페이지가 한 줄을 내보내고 여기서 그것을 담는다.
            deadline = time.monotonic() + TIMEOUT_MS / 1000
            while verdict["value"] is None and time.monotonic() < deadline:
                page.wait_for_timeout(POLL_MS)
            if verdict["value"] is None:
                print(f"판정이 {TIMEOUT_MS // 1000}초 안에 오지 않았다.", flush=True)
                return 1
            result = verdict["value"]
            # **판정을 여기서 찍는다 — `with` 를 나가기 전에.**
            #
            # 밖에 두면 `browser.close()` 가 먼저 돌고, 그것이 **큰 화물에서
            # 돌아오지 않는다**(실측). 검사는 21 초에 다 끝나 있는데 아무것도 안
            # 찍힌 채 10 분 한도를 채웠고, 화물이 클수록 어김없이 그랬다 — 49MB 는
            # 매번, 31~37MB 는 절반쯤, 21~23MB 는 통과했다.
            #
            # 그 증상을 나는 "페이지가 멎는다" 로 읽었고 원인을 페이지 안에서
            # 넷이나 찾았다. 페이지는 멀쩡했다. 계측해 보니 힙은 한도의 5% 였고
            # microtask·rAF·setTimeout 이 전부 돌고 있었다. **닫는 쪽이 문제였다.**
            print(result["text"], flush=True)
            code = 0 if result["ok"] else 1
            # **여기서 끝낸다.** 답은 이미 찍혔고, 남은 것은 뒷정리뿐인데 그
            # 뒷정리가 돌아오지 않는다 — `with` 를 나가면 `browser.close()` 가
            # 돌고 큰 화물에서 그것이 매달린다. 판정을 안으로 옮긴 뒤에도
            # 세 화물이 전부 답을 찍은 채로 시간 한도를 채웠다(실측).
            #
            # 그래서 브라우저를 먼저 거두고 프로세스를 그 자리에서 내린다.
            # `os._exit` 는 정리 절차를 건너뛴다 — 여기서는 그것이 목적이다.
            sys.stdout.flush()
            _reap()
            os._exit(code)

    _reap()
    return 1


def _reap() -> None:
    """**남은 브라우저를 거둔다.**

    `browser.close()` 가 돌아오지 않는 자리가 있어서 판정을 그 앞에서 찍는다. 그러면
    닫히지 않은 브라우저가 남고, 그것들이 쌓이면 GPU 를 나눠 쓰게 되어 다음 실행이
    몇 배로 느려진다 — 한 번은 91 분짜리 하나가 살아서 모든 증상을 흐렸다.
    """
    import subprocess
    subprocess.run(["pkill", "-f", "ms-playwright/chromium"],
                   capture_output=True, check=False)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
