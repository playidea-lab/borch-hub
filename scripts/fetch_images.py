"""정확도를 잴 **사진 천 장**을 받는다 — 클래스마다 한 장씩.

    uv run python scripts/fetch_images.py              # 1000 장 (약 130MB)
    uv run python scripts/fetch_images.py --limit 20   # 맛만 본다

## 왜 ImageNet 이 아니라 ImageNet-V2 인가

ImageNet 검증셋은 등록과 라이선스 동의가 필요하고 6.7GB 다. ImageNet-V2 는 **같은
1000 클래스를 같은 방식으로 새로 모은 것**이고, MIT 이며 아무나 받는다.

**점수 이름을 `top1` 로 쓰면 안 된다.** ImageNet-V2 점수는 ImageNet val 보다 체계적으로
11~14% 낮다 — 그것이 그 논문의 결론이지 우리 변환이 나쁘다는 뜻이 아니다. 이 수는
`top1_imagenetv2` 다.

## 클래스마다 한 장인 이유

클래스당 10 장 중 하나만 가져와 **1000 클래스를 전부 덮는다.** 변환이 틀리는 방식은
무작위가 아니라 체계적이라(ReLU6 포화, 패딩 경계 같은 것) 장수보다 다양성이 잡아낸다.
그리고 1000 장이면 모델 하나에 몇 분이라 실제로 돌릴 수 있다.

## 아카이브를 디스크에 안 남긴다

gzip 은 앞에서부터만 풀리므로 1.26GB 를 다 흘려보내기는 한다. 다만 스트림으로 열면
**쓰는 것은 고른 것뿐**이다 — 받아 두었다가 지우는 것과 처음부터 130MB 만 쓰는 것은
디스크가 찬 기계에서 다른 일이다.

## 재현

`index.json` 에 출처 주소와 장당 sha256 을 남긴다. 원본 파일 이름 자체가 내용의
sha1 이라 사진은 자기 신원을 들고 있다 — **바이트를 다시 배포하지 않아도** 남이 같은
천 장을 다시 모을 수 있다.
"""

import argparse
import hashlib
import json
import pathlib
import sys
import tarfile
import urllib.request

URL = ("https://huggingface.co/datasets/vaishaal/ImageNetV2/resolve/main/"
       "imagenetv2-matched-frequency.tar.gz")
HUB = pathlib.Path(__file__).resolve().parent.parent
OUT = HUB / "imagenetv2-1perclass"


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(line_buffering=True)
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=pathlib.Path, default=OUT)
    ap.add_argument("--limit", type=int, default=1000, help="클래스 몇 개까지")
    args = ap.parse_args(argv)

    args.out.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    records: list[dict[str, object]] = []

    req = urllib.request.Request(URL, headers={"User-Agent": "borch-hub-images/1"})
    with urllib.request.urlopen(req, timeout=120) as res:
        # **압축 모드는 `r|*` 다.** 이름은 `.tar.gz` 인데 받는 쪽이 이미 풀어 놓은
        # 평 tar 일 수 있다 — HF 가 `Content-Encoding: gzip` 으로 보내면 그렇게 된다.
        # `r|gz` 로 못박으면 그 자리에서 "not a gzip file" 로 멈춘다(실측).
        with tarfile.open(fileobj=res, mode="r|*") as tar:
            for member in tar:
                if not member.isfile() or not member.name.endswith(".jpeg"):
                    continue
                parts = member.name.split("/")
                cls = parts[-2]
                if cls in seen:
                    continue
                handle = tar.extractfile(member)
                if handle is None:
                    continue
                data = handle.read()
                name = f"{int(cls):03d}-{parts[-1]}"
                (args.out / name).write_bytes(data)
                seen.add(cls)
                records.append({
                    "file": name,
                    "class": int(cls),
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                })
                if len(records) % 100 == 0:
                    print(f"  {len(records)}장", flush=True)
                if len(records) >= args.limit:
                    break

    records.sort(key=lambda r: str(r["file"]))
    (args.out / "index.json").write_text(json.dumps({
        "source": URL,
        "note": "클래스마다 첫 한 장. tar 안의 순서가 곧 '첫' 이고, 아카이브가 "
                "고정이라 재현된다.",
        "count": len(records),
        "images": records,
    }, indent=2, ensure_ascii=False) + "\n")
    total = sum(int(r["bytes"]) for r in records)
    print(f"  끝 — {len(records)}장 / 클래스 {len(seen)}개 / {total / 1e6:.0f}MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
