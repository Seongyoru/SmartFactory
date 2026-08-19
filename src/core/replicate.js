/**
 * =============================================================================
 *  반복 실행 — **한 번 돌린 값은 사실 아무 말도 안 한다**
 * =============================================================================
 *  이 시뮬에는 고장(지수분포)과 공정 편차가 들어 있다. 그러면 같은 배치를 다시
 *  돌려도 다른 값이 나온다. 그런데 지금까지 화면은 **한 번 돌린 숫자 하나**를
 *  「이 배치의 처리량」이라고 말해 왔다. 그건 주사위를 한 번 굴려 놓고 「이
 *  주사위는 4가 나온다」고 하는 것과 같다.
 *
 *      한 번:   412 개/시
 *      30번:    412 ± 18 개/시 (95%)      ← 이래야 견줄 수 있는 값이 된다
 *
 *  배치 A(410)와 B(420)를 한 번씩 돌려 「B가 낫다」고 하면 **틀릴 수 있다.**
 *  구간이 겹치면 그 차이는 아직 아무것도 아니다. 이 모듈은 그 판단을 숫자로
 *  하게 만든다.
 *
 *  ── 왜 이제 되나 ─────────────────────────────────────────────────────────
 *  틱이 `core/sim.js` 로 나왔기 때문이다. 그 전에는 시뮬이 3D 씬의 프레임 루프
 *  안에 있어서 **화면이 있어야만** 돌았고, 배경에서 여러 번 돌릴 방법이 없었다.
 *  지금은 같은 함수를 루프로 부르면 된다 — 30분 시뮬이 몇 ms 다.
 *
 *  ── 같은 난수를 먹인다 (common random numbers) ───────────────────────────
 *  배치 둘을 견줄 때는 **같은 씨앗**을 쓴다. 그래야 「A는 운 좋게 고장이 안
 *  났고 B는 났다」가 아니라 **배치 차이만** 남는다. 통계에서 표본을 줄이는
 *  고전적인 수법이고, 여기서는 공짜로 얻는다.
 *
 *  ── 데우는 시간은 버린다 ─────────────────────────────────────────────────
 *  라인이 채워지기 전의 처리량은 그 배치의 실력이 아니다. `metrics` 가 이미
 *  WARMUP 을 두고 있으므로, 여기서는 **그 뒤부터** 재도록 시간을 준다.
 * ---------------------------------------------------------------------------
 */

import { resetRun, runMachines } from './sim.js';
import { getRan } from './metrics.js';

/** 한 판을 이만큼씩 끊어 굴린다 (시뮬 초) — 화면의 한 프레임과 같은 크기 */
export const STEP = 0.1;

/**
 * 씨앗을 받는 난수. **재현이 되어야 반복 실행이 성립한다.**
 *  선형 합동법 — 통계적으로 훌륭하진 않지만 이 용도에는 충분하고, 한 줄이라
 *  어디서 무엇이 달라졌는지 따질 일이 없다.
 */
export function seeded(seed = 1) {
  let x = (Math.abs(Math.trunc(seed)) || 1) % 4294967296;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

/* ==========================================================================
 * 통계 — 여러 판을 한 줄로
 * ======================================================================== */

/**
 * t 분포의 95% 값. 표본이 적을 때 정규분포(1.96)를 쓰면 **구간이 좁게 나온다** —
 * 즉 「차이가 있다」고 성급하게 말하게 된다. 30까지는 표를 그대로 쓴다.
 */
const T95 = [
  0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045,
];
const tOf = (df) => (df <= 0 ? 0 : df < T95.length ? T95[df] : 1.96);

/**
 * 값 여럿 → 평균과 95% 신뢰구간.
 *
 *  @returns { n, mean, sd, half, lo, hi }
 *    half  ± 얼마 — 화면이 「412 ± 18」 로 쓰는 그 값
 *    lo·hi 구간. **두 배치의 구간이 겹치면 아직 차이라고 말할 수 없다**
 */
export function stats(values) {
  const xs = (values ?? []).filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (!n) return { n: 0, mean: null, sd: 0, se: 0, half: 0, lo: null, hi: null };
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  if (n === 1) return { n, mean, sd: 0, se: 0, half: 0, lo: mean, hi: mean };
  /* 표본 표준편차 — n 이 아니라 n−1 로 나눈다. 모집단이 아니라 **뽑은 것**이다 */
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  const half = tOf(n - 1) * se;
  return { n, mean, sd, se, half, lo: mean - half, hi: mean + half };
}

/**
 * 두 배치가 **정말 다른가.**
 * ---------------------------------------------------------------------------
 *  「A 410, B 420 이니 B가 낫다」 는 틀릴 수 있다. 다시 돌리면 뒤집힐 수 있다는
 *  뜻이다. 이 판정이 없으면 반복 실행을 해 놓고도 결국 눈으로 숫자를 견주게 된다.
 *
 *  ── 「구간이 겹치나」로 보면 안 된다 ──────────────────────────────────────
 *  처음에는 두 신뢰구간이 겹치는지로 봤다. 쉽고 그럴듯하지만 **지나치게 보수적
 *  이다** — 실제로 6.0초/개와 5.5초/개(9% 차이)를 스무 판씩 돌려 견줬더니
 *  「아직 모른다」가 나왔다. 있는 차이를 없다고 하는 것은 안 하느니만 못하다.
 *
 *  차이 자체에도 신뢰구간이 있다. 그걸 보는 것이 맞다 —
 *
 *      차이의 표준오차 = √(seA² + seB²)          (Welch)
 *      차이가 0 을 안 품으면 **진짜 차이**다
 *
 *  자유도는 Welch–Satterthwaite 로 낸다. 분산이 다른 두 표본을 견주는 자리라
 *  「합쳐서 하나로 본다」가 성립하지 않는다.
 */
export function differs(a, b) {
  if (!a?.n || !b?.n || a.n < 2 || b.n < 2) return null;
  const gap = Math.abs(a.mean - b.mean);
  const va = a.se ** 2;
  const vb = b.se ** 2;
  const se = Math.sqrt(va + vb);
  if (!(se > 0)) return { gap, half: 0, sure: gap > 0, better: a.mean > b.mean ? 'a' : 'b' };
  /* Welch–Satterthwaite */
  const df = (va + vb) ** 2 / (va ** 2 / (a.n - 1) + vb ** 2 / (b.n - 1));
  const half = tOf(Math.max(1, Math.floor(df))) * se;
  return {
    gap,
    /** 차이의 ± — `gap` 이 이보다 크면 0 을 안 품는다 */
    half,
    sure: gap > half,
    better: a.mean > b.mean ? 'a' : 'b',
  };
}

/* ==========================================================================
 * 여러 판 돌리기
 * ======================================================================== */

/**
 * 한 판을 끝까지 굴리고, 볼 값을 뽑아 돌려준다.
 *
 *  @param d.seconds 시뮬 몇 초를 굴릴지
 *  @param d.world   `runMachines` 에 넘길 것들 (machines · equips · halted …)
 *                   **틱마다 다시 만들어야 하면** 함수로 준다
 *  @param d.pick    (…) => 값 — 이 판에서 무엇을 볼지. 없으면 처리량
 *  @param d.rand    난수
 */
export function runOnce(d = {}) {
  const seconds = Math.max(0, d.seconds ?? 600);
  const rand = d.rand ?? Math.random;
  const step = d.step ?? STEP;

  resetRun();
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    const w = typeof d.world === 'function' ? d.world(i * step) : (d.world ?? {});
    runMachines(step, { ...w, rand });
  }
  return d.pick ? d.pick() : getRan();
}

/**
 * **여러 판**을 돌려 평균과 신뢰구간을 낸다.
 *
 *  @param d.reps  몇 판. 기본 10 — 30분 시뮬 열 판이 1초 남짓이다
 *  @param d.seed  씨앗. 배치 둘을 견줄 때 **같은 값**을 주면 같은 난수를 먹는다
 *  @returns { runs, ...stats }
 */
export function replicate(d = {}) {
  const reps = Math.max(1, Math.round(d.reps ?? 10));
  const seed = d.seed ?? 1;
  const runs = [];
  for (let r = 0; r < reps; r++) {
    /* 판마다 씨앗을 옮긴다 — 같은 씨앗으로 열 번 돌리면 같은 판을 열 번 보는
       것이라 편차가 0 으로 나온다. 대신 **씨앗을 정하는 규칙**이 같으므로
       배치 A 와 B 는 r 번째 판에서 같은 난수를 먹는다. */
    runs.push(runOnce({ ...d, rand: seeded(seed + r * 7919) }));
  }
  return { runs, ...stats(runs) };
}

/** 「412 ± 18」 — 화면과 보고서가 같은 모양으로 쓴다 */
export const ciText = (s, digits = 1) => {
  if (!s?.n) return '—';
  if (s.n === 1) return `${s.mean.toFixed(digits)} (한 판)`;
  return `${s.mean.toFixed(digits)} ± ${s.half.toFixed(digits)}`;
};
