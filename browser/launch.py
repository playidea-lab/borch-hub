"""브라우저를 여는 문. **여기서 다시 쓰지 않고 코어의 것을 들여온다.**

코어가 같은 판단을 이미 한 번 했다(`borch-ts/test/launch.py`): 러너 트리가 갈린
인자로 브라우저를 띄우면 나란히 놓은 두 수가 같은 잣대가 아니게 된다. 저장소가
갈렸다고 그 이유가 없어지지 않는다 — 오히려 더 세진다. 여기서 잰 에폭 시간은
**코어의 벤치 수와 비교되기 위해** 존재하고, 플래그가 다르면 그 비교가 거짓이다.

그래서 옆에 나란히 받아둔 코어에서 가져온다. 없으면 여기서 멈춘다 — 몰래 우리
플래그로 띄우느니 안 도는 편이 낫다.
"""

import importlib.util
import pathlib
import sys

CORE = pathlib.Path(__file__).resolve().parents[2] / "borch"
_PATH = CORE / "tests" / "browser" / "launch.py"

if not _PATH.exists():
    print(
        f"코어를 못 찾았다: {_PATH}\n"
        "  이 저장소 옆에 나란히 받아야 한다:\n"
        "    git clone git@github.com:playidea-lab/borch.git ../borch\n"
        "  브라우저 플래그를 여기서 새로 쓰지 않는 이유는 launch.py 첫 문단에 있다.",
        file=sys.stderr,
    )
    raise SystemExit(2)

_spec = importlib.util.spec_from_file_location("core_browser_launch", _PATH)
if _spec is None or _spec.loader is None:
    raise SystemExit(f"코어의 launch.py 를 못 읽었다: {_PATH}")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

browser = _mod.browser
is_software = _mod.is_software
refuse_if_software = _mod.refuse_if_software
warn_if_software = _mod.warn_if_software
