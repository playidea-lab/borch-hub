/**
 * 첫 화물을 만든다 — CIFAR-10 ResNet-18 을 브라우저에서 학습해 safetensors 로 낸다.
 *
 * ## 레시피는 새로 정하지 않는다
 *
 * 옵티마이저·배치·정규화·늘리기가 전부 코어의 `accuracy.ts` 와 같은 값이다
 * (SGD lr 0.05 · 모멘텀 0.9 · 감쇠 5e-4 · 배치 128 · 자르기 32 채움 4 · 뒤집기 0.5).
 * 하이퍼파라미터를 우리가 새로 고르면 나온 정확도가 **코어가 발표한 수와 비교
 * 불가능**해진다. 같은 값을 쓰면 차이가 나올 때 그 차이가 무엇 때문인지 물을 수 있다.
 *
 * 그 함수들이 코어에서 module-private 이라 여기로 옮겨 적었다. 세 번째 사본이고,
 * 그것을 아는 채로 한다 — 대안은 코어의 `trainEval` 을 부르는 것인데 그쪽은 모델을
 * 안 돌려준다(안에서 만들어 안에서 버린다). 무게를 손에 넣을 방법이 없다.
 *
 * ## 무엇을 내놓는가
 *
 * 가중치만 내면 배지를 못 만든다. 그래서 **샘플 입력과 그때의 출력**을 같이 낸다 —
 * 받는 쪽이 자기 브라우저에서 같은 입력을 넣어 같은 값이 나오는지 스스로 확인할
 * 수 있어야 배지가 주장이 아니라 사실이 된다.
 */

import {
  Device, init, noGrad, save, Tensor, device, vision, nn, optim,
} from "borch";
import { decodeCifar, type Split } from "@core/accuracy";

import { createModel } from "../src/models/registry.js";

/** CIFAR-10 의 통상값. 정규화를 빼면 첫 에폭이 눈에 띄게 느리게 붙는다. */
const CIFAR_MEAN = [0.4914, 0.4822, 0.4465];
const CIFAR_STD = [0.2470, 0.2435, 0.2616];
const SIDE = 32;
const PIXELS = SIDE * SIDE;
const CHANNELS = 3;
const NUM_CLASSES = 10;

/** 배지에 실을 샘플 장수. 작아야 매니페스트 옆에 같이 산다. */
const SAMPLE_IMAGES = 8;

/** 늘리기 설정 — 코어와 같은 값이다. */
const CROP_PADDING = 4;
const HFLIP_P = 0.5;

export interface TrainOptions {
  readonly epochs: number;
  readonly batch: number;
  readonly lr: number;
  readonly momentum: number;
  readonly weightDecay: number;
  readonly augment: boolean;
  readonly seed: number;
}

export const DEFAULTS: TrainOptions = {
  epochs: 10,
  batch: 128,
  lr: 0.05,
  momentum: 0.9,
  weightDecay: 5e-4,
  augment: true,
  seed: 1234,
};

export interface EpochRow {
  readonly epoch: number;
  readonly train: number;
  readonly test: number;
  readonly loss: number;
  readonly seconds: number;
}

/**
 * 고른 장들을 모델에 넣을 모양으로. **늘리기가 정규화보다 먼저다** — 가장자리를
 * 0 으로 채운 뒤 정규화해야 그 0 이 다른 화소와 같은 자로 재진다.
 */
function prepare(split: Split, picks: ArrayLike<number>, augment: boolean): Float32Array {
  const n = picks.length;
  const stride = CHANNELS * PIXELS;
  const gathered = new Float32Array(n * stride);
  for (let i = 0; i < n; i++) {
    const from = (picks[i] ?? 0) * stride;
    gathered.set(split.x.subarray(from, from + stride), i * stride);
  }
  const shaped = augment
    ? vision.augmentBatch(gathered, n, CHANNELS, SIDE, SIDE,
      { crop: SIDE, padding: CROP_PADDING, hflipP: HFLIP_P })
    : gathered;
  return vision.normalizeBatch(shaped, n, CHANNELS, PIXELS, CIFAR_MEAN, CIFAR_STD);
}

/** 씨앗을 박은 섞기. 같은 씨앗이면 같은 차례를 본다. */
function shuffled(n: number, seed: number): Int32Array {
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  let s = seed >>> 0 || 1;
  for (let i = n - 1; i > 0; i--) {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    const j = s % (i + 1);
    const t = order[i] ?? 0;
    order[i] = order[j] ?? 0;
    order[j] = t;
  }
  return order;
}

/**
 * 맞힌 비율. **평가 모드가 조건이다** — BatchNorm 이 학습 통계를 쓰면 배치 구성에
 * 따라 값이 흔들려서 재는 것이 정확도가 아니라 배치 운이 된다.
 */
async function measure(model: nn.Module, split: Split, batch = 250): Promise<number> {
  model.eval();
  let right = 0;
  for (let i = 0; i < split.n; i += batch) {
    const size = Math.min(batch, split.n - i);
    const picks = Array.from({ length: size }, (_, k) => i + k);
    const d = device();
    d.beginScope();
    try {
      const out = noGrad(() => {
        const x = Tensor.from(prepare(split, picks, false), [size, CHANNELS, SIDE, SIDE]);
        return model.forward(x);
      });
      const scores = await out.toArray();
      for (let k = 0; k < size; k++) {
        let best = 0;
        for (let c = 1; c < NUM_CLASSES; c++) {
          if ((scores[k * NUM_CLASSES + c] ?? 0) > (scores[k * NUM_CLASSES + best] ?? 0)) best = c;
        }
        if (best === split.y[i + k]) right += 1;
      }
    } finally {
      d.endScope();
    }
  }
  model.train();
  return right / split.n;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // 127.0.0.1 은 보안 컨텍스트라 SubtleCrypto 가 있다. 없으면 여기서 멈추는 것이
  // 맞다 — 해시 없는 가중치는 매니페스트에 못 적는다.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Cargo {
  readonly rows: readonly EpochRow[];
  readonly bestTest: number;
  readonly finalTest: number;
  readonly adapter: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly tensors: number;
  readonly files: Readonly<Record<string, Uint8Array>>;
}

/**
 * 학습하고, 가중치와 샘플을 낸다.
 *
 * `onProgress` 로 에폭마다 흘려보낸다. 한 시간짜리 실행은 도중에 죽으면 반환값이
 * 통째로 사라지고, 그때 남는 것은 흘려보낸 것뿐이다.
 */
export async function run(
  train: Split,
  test: Split,
  opts: TrainOptions = DEFAULTS,
  onProgress: (line: string) => void = () => {},
): Promise<Cargo> {
  await init();

  const model = createModel("borchvision", "resnet18_cifar", { numClasses: NUM_CLASSES });
  const sgd = new optim.SGD(model.parameters(), opts.lr, opts.momentum, opts.weightDecay);
  const criterion = new nn.CrossEntropyLoss();
  const usable = train.n - (train.n % opts.batch);
  const rows: EpochRow[] = [];

  for (let e = 0; e < opts.epochs; e++) {
    const order = shuffled(train.n, opts.seed + e);
    const started = performance.now();
    let lastLoss = 0;
    for (let i = 0; i < usable; i += opts.batch) {
      const picks = order.subarray(i, i + opts.batch);
      const bx = prepare(train, picks, opts.augment);
      const by = new Float32Array(opts.batch);
      for (let k = 0; k < opts.batch; k++) by[k] = train.y[picks[k] ?? 0] ?? 0;
      const d = device();
      d.beginScope();
      try {
        const x = Tensor.from(bx, [opts.batch, CHANNELS, SIDE, SIDE]);
        const y = Tensor.from(by, [opts.batch], { dtype: "int64" });
        sgd.zeroGrad();
        const loss = criterion.forward(model.forward(x), y);
        loss.backward();
        sgd.step();
        lastLoss = await loss.item();
      } finally {
        d.endScope();
      }
    }
    const seconds = (performance.now() - started) / 1000;
    const row: EpochRow = {
      epoch: e + 1,
      train: await measure(model, train),
      test: await measure(model, test),
      loss: Math.round(lastLoss * 10000) / 10000,
      seconds: Math.round(seconds * 10) / 10,
    };
    rows.push(row);
    onProgress(
      `에폭 ${row.epoch}/${opts.epochs} 학습 ${row.train.toFixed(3)} `
      + `시험 ${row.test.toFixed(3)} 손실 ${row.loss.toFixed(4)} ${row.seconds.toFixed(1)}초`,
    );
  }

  // --- 화물 -------------------------------------------------------------
  model.eval();
  const state = model.stateDict();

  // 레시피를 파일 안에 싣는다. 매니페스트가 없어져도 이 파일 하나로 무엇이었는지
  // 알 수 있어야 한다 — safetensors 의 머리는 JSON 이라 그럴 자리가 있다.
  const weights = await save(state, {
    "borch-hub.factory": "resnet18",
    "borch-hub.numClasses": String(NUM_CLASSES),
    "borch-hub.epochs": String(opts.epochs),
    "borch-hub.batch": String(opts.batch),
    "borch-hub.lr": String(opts.lr),
    "borch-hub.momentum": String(opts.momentum),
    "borch-hub.weightDecay": String(opts.weightDecay),
    "borch-hub.augment": String(opts.augment),
    "borch-hub.seed": String(opts.seed),
    "borch-hub.trainImages": String(train.n),
    "borch-hub.adapter": Device.adapterInfo,
  });

  const picks = Array.from({ length: SAMPLE_IMAGES }, (_, k) => k);
  const sampleInput = Tensor.from(
    prepare(test, picks, false), [SAMPLE_IMAGES, CHANNELS, SIDE, SIDE],
  );
  const sampleOutput = noGrad(() => model.forward(sampleInput));
  const sampleIn = await save({ input: await sampleInput.cpu() });
  const sampleOut = await save({ output: await sampleOutput.cpu() });

  const last = rows[rows.length - 1];
  return {
    rows,
    bestTest: rows.reduce((a, b) => (b.test > a.test ? b : a), last ?? {
      epoch: 0, train: 0, test: 0, loss: 0, seconds: 0,
    }).test,
    finalTest: last?.test ?? 0,
    adapter: Device.adapterInfo,
    sha256: await sha256Hex(weights),
    bytes: weights.length,
    tensors: Object.keys(state).length,
    files: {
      "model.safetensors": weights,
      "sample.in.safetensors": sampleIn,
      "sample.out.safetensors": sampleOut,
    },
  };
}

export { decodeCifar };
