"""첫 화물을 만든다 — 브라우저에서 학습해 safetensors 세 개를 받아온다.

    npm run build                      # 여기
    (cd ../borch && npm run build:ts)  # 코어

    uv run --with playwright python browser/train.py --headed --epochs 2
    uv run --with playwright python browser/train.py --headed --full --epochs 30

**창을 띄워야 한다(`--headed`).** 헤드리스는 소프트웨어 어댑터를 주고, 그러면 한
시간짜리가 하루가 된다. 그래서 이 러너는 소프트웨어 어댑터에서 나온 결과를
**거절한다** — 학습이 됐어도 그 가중치를 만든 조건을 매니페스트에 정직하게 적을 수
없다(에폭 시간이 거짓이 되고, 그 수가 곧 재현 지시서다).

`--dry-run` 은 그 거절을 푼다. **화물을 만드는 것이 아니라 길이 뚫렸는지 보는**
실행이라는 뜻이고, 그래서 결과가 `out/dry/` 로 따로 떨어지고 요약에 무효 표시가
박힌다. 플래그 이름이 의도를 말하는 자리라 `--allow-software` 같은 이름을 안 쓴다 —
그건 "무엇을 허용하는가"만 말하고 "왜"를 안 말한다. `--images` 로 장수를 줄여
몇 분 안에 끝낼 수 있다.

받아온 파일은 `out/` 에 떨어진다. 거기서 레지스트리로 옮기는 것은 사람이 한다 —
가중치를 CDN 에 올리는 것과 매니페스트를 병합하는 것은 순서가 있고, 그 순서를
자동으로 밟게 두면 바이트 없는 매니페스트가 먼저 병합된다.
"""

import json
import sys
import tarfile

from launch import browser as browser_of, is_software
from serve import CORE, HUB, serve

TIMEOUT_MS = 24 * 60 * 60 * 1000
OUT = HUB / "out"

# 원본 아카이브 안의 이름 → 저장소 루트에 두는 이름.
ARCHIVE = CORE / "cifar-10-binary.tar.gz"
MEMBERS = {f"cifar-10-batches-bin/data_batch_{i}.bin": f"cifar-batch{i}.bin" for i in range(1, 6)}
MEMBERS["cifar-10-batches-bin/test_batch.bin"] = "cifar-batch-test.bin"


def ensure_batches(names: list[str]) -> int:
    """없는 덩이를 원본 아카이브에서 푼다. 코어가 이미 받아둔 것을 다시 안 받는다."""
    missing = [n for n in names if not (CORE / n).exists()]
    if not missing:
        return 0
    if not ARCHIVE.exists():
        print(f"데이터가 없다: {', '.join(missing)}\n"
              f"  원본 아카이브도 없다: {ARCHIVE}", file=sys.stderr)
        return 2
    wanted = {member: out for member, out in MEMBERS.items() if out in missing}
    print(f"원본에서 푼다: {', '.join(sorted(wanted.values()))}")
    with tarfile.open(ARCHIVE) as tar:
        for member, out in wanted.items():
            src = tar.extractfile(member)
            if src is None:
                print(f"아카이브에 없다: {member}", file=sys.stderr)
                return 2
            (CORE / out).write_bytes(src.read())
    return 0


def main(argv: list[str]) -> int:
    built = HUB / "dist" / "browser" / "train.js"
    if not built.exists():
        print(f"방출물이 없다: {built}\n  먼저: npm run build", file=sys.stderr)
        return 2

    def opt(flag: str, default: str) -> str:
        return argv[argv.index(flag) + 1] if flag in argv else default

    batches = "1,2,3,4,5" if "--full" in argv else "1"
    needed = [f"cifar-batch{b}.bin" for b in batches.split(",")] + ["cifar-batch-test.bin"]
    failed = ensure_batches(needed)
    if failed:
        return failed

    dry = "--dry-run" in argv
    query = (f"?batches={batches}&epochs={opt('--epochs', '10')}"
             f"&batch={opt('--batch', '128')}&augment={opt('--augment', 'on')}"
             f"&images={opt('--images', '0')}")

    out_dir = OUT / "dry" if dry else OUT
    out_dir.mkdir(parents=True, exist_ok=True)
    port, stop = serve()
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p, browser_of(p, headed="--headed" in argv) as browser:
            page = browser.new_page(accept_downloads=True)
            page.set_default_timeout(0)
            page.on("console", lambda m: print(f"  {m.text}")
                    if m.text.startswith("[train]") or m.type == "error" else None)
            page.on("pageerror", lambda e: print(f"  [브라우저 예외] {e}"))
            page.goto(f"http://127.0.0.1:{port}/borch-hub/browser/train.html{query}")
            page.wait_for_function("window.__borchHubTrain !== undefined", timeout=TIMEOUT_MS)
            result = page.evaluate("window.__borchHubTrain")

            if "error" in result:
                print(f"학습하지 못했다: {result['error']}", file=sys.stderr)
                return 1

            # 어댑터 판정을 **파일을 받기 전에** 한다. 무효한 가중치를 디스크에
            # 남기면 나중에 누군가 그것을 올린다.
            software = is_software(result.get("adapter"))
            if software and not dry:
                print(f"**소프트웨어 어댑터다({result['adapter']}) — 이 가중치는 안 받는다.**\n"
                      "  CPU 로 돈 것이라 에폭 시간이 GPU 의 수가 아니고, 그 수가 곧\n"
                      "  재현 지시서다. `--headed` 로, 진짜 GPU 가 붙은 화면에서 다시 돌려라.",
                      file=sys.stderr)
                return 1
            if software:
                print(f"  (소프트웨어 어댑터다({result['adapter']}) — 길이 뚫렸는지만 본다.\n"
                      "   이 가중치는 화물이 아니다.)")

            for name in result["names"]:
                with page.expect_download() as caught:
                    page.evaluate(f"window.__emit({json.dumps(name)})")
                caught.value.save_as(out_dir / name)
                print(f"  받았다: {out_dir.relative_to(HUB)}/{name}")
    finally:
        stop()

    print(f"\n어댑터: {result['adapter']}")
    print(f"학습 {result['trainImages']}장 · 텐서 {result['tensors']}개 · "
          f"{result['bytes']:,} 바이트")
    print(f"sha256: {result['sha256']}")
    print(f"마지막 시험 정확도 {result['finalTest'] * 100:.2f}% · "
          f"가장 좋은 것 {result['bestTest'] * 100:.2f}%")
    if dry:
        # 무효 표시를 파일 안에 박는다. 디렉터리 이름만으로는 옮겨진 뒤 사라진다.
        result["invalid"] = "dry-run — 길을 확인한 실행이다. 화물이 아니다."
    (out_dir / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"요약: {(out_dir / 'summary.json').relative_to(HUB)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
