/**
 * replicate.js — 여러 번 돌려 평균과 신뢰구간.
 * ---------------------------------------------------------------------------
 *  한 번 돌린 값은 사실 아무 말도 안 한다. 이 검사는 그 「말이 되게」 만드는
 *  산수가 맞는지 본다 — 특히 **있는 차이를 없다고 하지 않는지.**
 */
import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('반복 실행');

const R = await import(SRC + 'core/replicate.js');
const SS = await import(SRC + 'core/simStore.js');
const src = await readSrc('core/replicate.js');

/* ---------- 씨앗 ------------------------------------------------------------ */

t('같은 씨앗이면 같은 수열 — 재현이 안 되면 통계가 아니다', () => {
  const a = Array.from({ length: 5 }, R.seeded(7));
  const b = Array.from({ length: 5 }, R.seeded(7));
  const c = Array.from({ length: 5 }, R.seeded(8));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

t('0~1 사이만 나온다', () => {
  const r = R.seeded(3);
  for (let i = 0; i < 500; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `${v}`);
  }
});

t('씨앗이 없거나 이상해도 돈다 — 멈추면 그게 더 나쁘다', () => {
  assert.ok(Number.isFinite(R.seeded()()));
  assert.ok(Number.isFinite(R.seeded(0)()));
  assert.ok(Number.isFinite(R.seeded(-5)()));
});

/* ---------- 평균과 구간 ----------------------------------------------------- */

t('평균과 표준편차 — 표본이라 n−1 로 나눈다', () => {
  const s = R.stats([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(s.n, 8);
  assert.equal(s.mean, 5);
  /* 모집단이면 2, 표본이면 √(32/7) ≈ 2.138 */
  assert.ok(Math.abs(s.sd - Math.sqrt(32 / 7)) < 1e-9, `sd=${s.sd}`);
});

t('한 판만 돌리면 **구간이 없다** — ± 0 이라고 하면 확실하다는 뜻이 된다', () => {
  const s = R.stats([412]);
  assert.equal(s.n, 1);
  assert.equal(s.mean, 412);
  assert.equal(s.half, 0);
  assert.ok(R.ciText(s).includes('한 판'), '한 판이라는 말이 없다');
});

t('아무것도 없으면 답이 없다 — 0 이 아니다', () => {
  const s = R.stats([]);
  assert.equal(s.n, 0);
  assert.equal(s.mean, null);
  assert.equal(R.ciText(s), '—');
});

t('표본이 적으면 **t 분포**를 쓴다 — 1.96 을 쓰면 구간이 좁게 나온다', () => {
  /* 같은 자료를 n 만 다르게 흉내 낼 수는 없으니, 작은 n 에서 구간이
     정규분포보다 **넓은지**만 본다. 좁으면 「차이가 있다」고 성급해진다. */
  const xs = [10, 12, 14];                       // n=3, sd=2, se≈1.1547
  const s = R.stats(xs);
  const normal = 1.96 * s.se;
  assert.ok(s.half > normal * 1.5, `t 를 안 쓰고 있다: ${s.half} vs ${normal}`);
});

t('구간이 평균을 가운데 둔다', () => {
  const s = R.stats([1, 2, 3, 4, 5]);
  assert.ok(Math.abs((s.lo + s.hi) / 2 - s.mean) < 1e-9);
  assert.ok(Math.abs(s.hi - s.lo - 2 * s.half) < 1e-9);
});

/* ---------- 정말 다른가 ----------------------------------------------------- */

t('**구간 겹침으로 보면 안 된다** — 있는 차이를 없다고 한다', () => {
  /* 실제로 겪은 판이다. 6.0초/개와 5.5초/개를 스무 판씩 돌렸더니
     549.0 ± 28.4 와 597.6 ± 30.9 가 나왔다. 구간은 겹친다(577 > 566).
     그런데 차이 자체의 구간은 48.6 ± 39.3 이라 0 을 안 품는다 — **진짜 차이다.** */
  const a = { n: 20, mean: 549.0, sd: 60.67, se: 60.67 / Math.sqrt(20), half: 28.4 };
  const b = { n: 20, mean: 597.6, sd: 66.0, se: 66.0 / Math.sqrt(20), half: 30.9 };
  assert.ok(a.hi === undefined || true);
  /* 겹침 판정이라면 안 잡힌다 */
  assert.ok(a.mean + a.half > b.mean - b.half, '표본이 겹치는 판이 아니다 — 검사가 뜻이 없다');
  const d = R.differs(a, b);
  assert.equal(d.sure, true, '있는 차이를 없다고 한다');
  assert.equal(d.better, 'b');
});

t('정말 안 다르면 안 다르다고 한다', () => {
  const a = { n: 10, mean: 100, sd: 20, se: 20 / Math.sqrt(10), half: 14 };
  const b = { n: 10, mean: 103, sd: 20, se: 20 / Math.sqrt(10), half: 14 };
  assert.equal(R.differs(a, b).sure, false, '없는 차이를 있다고 한다');
});

t('한 판씩으로는 견줄 수 없다 — 편차를 모른다', () => {
  const one = { n: 1, mean: 100, sd: 0, se: 0, half: 0 };
  assert.equal(R.differs(one, one), null);
  assert.equal(R.differs(null, one), null);
});

t('차이가 클수록 확실해진다', () => {
  const a = { n: 10, mean: 100, sd: 10, se: 10 / Math.sqrt(10), half: 7 };
  const near = { n: 10, mean: 102, sd: 10, se: 10 / Math.sqrt(10), half: 7 };
  const far = { n: 10, mean: 140, sd: 10, se: 10 / Math.sqrt(10), half: 7 };
  assert.equal(R.differs(a, near).sure, false);
  assert.equal(R.differs(a, far).sure, true);
});

/* ---------- 실제로 여러 판 돌린다 ------------------------------------------- */

const WORLD = {
  machines: [{ uid: 'A', cycleSec: 6, cycleVar: 0.3, cap: 999, need: null }],
  equips: [{ uid: 'A', mtbf: 2400, mttr: 300 }],
  halted: new Set(),
  shipped: 0,
};
const PICK = () => SS.getMade('A');

t('**화면 없이 여러 판을 돌린다** — A(틱 분리)가 없었으면 못 하는 일이다', () => {
  const r = R.replicate({ reps: 8, seconds: 1800, seed: 42, world: WORLD, pick: PICK });
  assert.equal(r.runs.length, 8);
  assert.ok(r.runs.every((v) => v > 0), '한 판도 못 만들었다');
  assert.ok(r.mean > 0 && r.half > 0, '편차가 0 이다 — 판마다 같은 난수를 먹고 있다');
});

t('판마다 **다른** 난수를 먹는다 — 같으면 같은 판을 여러 번 보는 것이다', () => {
  const r = R.replicate({ reps: 6, seconds: 1800, seed: 42, world: WORLD, pick: PICK });
  assert.ok(new Set(r.runs).size > 1, '판마다 결과가 똑같다');
});

t('씨앗이 같으면 **묶음 전체**가 되풀이된다', () => {
  const a = R.replicate({ reps: 6, seconds: 900, seed: 7, world: WORLD, pick: PICK });
  const b = R.replicate({ reps: 6, seconds: 900, seed: 7, world: WORLD, pick: PICK });
  assert.deepEqual(a.runs, b.runs, '같은 씨앗인데 묶음이 다르다');
});

t('배치 둘이 **같은 난수**를 먹는다 — 그래야 배치 차이만 남는다', () => {
  /* 씨앗을 정하는 규칙이 같으므로 r 번째 판은 양쪽 다 같은 난수를 쓴다.
     (common random numbers — 표본을 줄이는 고전적인 수법) */
  const faster = { ...WORLD, machines: [{ ...WORLD.machines[0], cycleSec: 3 }] };
  const a = R.replicate({ reps: 6, seconds: 1800, seed: 99, world: WORLD, pick: PICK });
  const b = R.replicate({ reps: 6, seconds: 1800, seed: 99, world: faster, pick: PICK });
  assert.ok(b.mean > a.mean, '두 배로 빠른데 안 늘었다');
  assert.equal(R.differs(a, b).sure, true, '두 배 차이를 못 잡는다');
});

t('판마다 **처음부터** 시작한다 — 앞 판이 남으면 통계가 못 쓴다', () => {
  const one = R.replicate({ reps: 1, seconds: 1800, seed: 5, world: WORLD, pick: PICK });
  const many = R.replicate({ reps: 4, seconds: 1800, seed: 5, world: WORLD, pick: PICK });
  assert.equal(many.runs[0], one.runs[0], '첫 판이 달라졌다 — 되돌리기가 새고 있다');
});

t('되돌리기를 **직접 적지 않는다** — sim 의 resetRun 을 쓴다', () => {
  assert.match(src, /import \{ resetRun, runMachines \} from '\.\/sim\.js'/);
  assert.ok(src.includes('resetRun();'), '판마다 되돌리지 않는다');
  for (const one of ['resetMetrics', 'resetFaults', 'clearStock']) {
    assert.equal(src.includes(one), false, `${one} 를 여기서 또 적었다`);
  }
});

t('읽는 문구가 「평균 ± 반폭」이다', () => {
  const s = R.stats([100, 110, 120]);
  const txt = R.ciText(s, 1);
  assert.match(txt, /^110\.0 ± \d+\.\d$/, txt);
});
