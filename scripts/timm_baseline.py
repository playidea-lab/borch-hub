"""**timm 자신을 같은 사진에 돌린다** — 우리 수와 나란히 놓기 위해.

    uv run --with timm --with torch --with pillow \
      python scripts/timm_baseline.py mobilenetv2_100

## 왜 이것이 있어야 하는가

`browser/accuracy.py` 가 낸 수만 매니페스트에 적으면, 그것을 읽는 사람은 흔히 인용되는
ImageNet 점수와 견주고 **"왜 이렇게 낮지" 라고 묻는다.** 실제로 그 질문을 받았고, 그
질문이 옳았다 — 낮은 수 하나만으로는 시험지가 어려운 것인지 변환이 틀린 것인지
구별할 수 없다.

그래서 **같은 사진에 timm 을 돌려 옆에 적는다.** 두 수가 나란히 있으면 그 구별이
읽는 자리에서 끝난다.

## 무엇이 확인됐나 (2026-08-27, 모델 8 개, 각 1000 장)

우리와 timm 이 갈린 사진은 **0~4 장**이었고, 부호가 섞였다 — 절반은 우리가 높고
절반은 낮다. 체계적 오차가 아니라 잡음이라는 뜻이다. 남는 차이는 브라우저의 JPEG
디코더와 PIL 이 경계에서 갈리는 자리다.

## timm 의 전처리를 쓴다 — 우리 것이 아니라

`create_transform` 이 그 모델의 설정대로 만든 것을 그대로 쓴다. 우리 전처리를 여기에
도 적용하면 **두 파이프라인이 아니라 한 파이프라인을 두 번 재는 것**이 되고, 전처리가
어긋난 경우를 못 잡는다.
"""

import argparse
import json
import pathlib
import sys

import timm
import torch
from PIL import Image

HUB = pathlib.Path(__file__).resolve().parent.parent
IMAGES = HUB / "imagenetv2-1perclass"


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(line_buffering=True)
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("model", help="timm 이름 (예: mobilenetv2_100)")
    ap.add_argument("--images", type=pathlib.Path, default=IMAGES)
    ap.add_argument("--limit", type=int, default=1000)
    args = ap.parse_args(argv)

    listing = json.loads((args.images / "index.json").read_text())
    model = timm.create_model(args.model, pretrained=True).eval()
    config = timm.data.resolve_data_config({}, model=model)
    transform = timm.data.create_transform(**config)

    hit1 = hit5 = seen = 0
    with torch.no_grad():
        for shot in listing["images"][:args.limit]:
            image = Image.open(args.images / shot["file"]).convert("RGB")
            top = model(transform(image).unsqueeze(0)).topk(5).indices[0].tolist()
            seen += 1
            if top[0] == shot["class"]:
                hit1 += 1
            if shot["class"] in top:
                hit5 += 1
            if seen % 200 == 0:
                print(f"  {seen} — top-1 {hit1 / seen * 100:.1f}%", flush=True)

    print(json.dumps({
        "model": args.model, "n": seen,
        "top1": hit1 / seen, "top5": hit5 / seen,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
