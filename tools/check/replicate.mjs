/**
 * replicate.js — 여러 번 돌려 평균과 신뢰구간.
 * ---------------------------------------------------------------------------
 *  한 번 돌린 값은 사실 아무 말도 안 한다. 이 검사는 그 「말이 되게」 만드는
 *  산수가 맞는지 본다 — 특히 **있는 차이를 없다고 하지 않는지.**
 */
import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

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

/* ---------- 막힘·굶음이 도는 라인을 통째로 --------------------------------- */

const MET = await import(SRC + 'core/metrics.js');
const FLT = await import(SRC + 'core/faults.js');

/* A(제작 4초/개) ──벨트──▶ S(적치대 12칸). 비워 주는 것이 없으니 곧 막힌다 */
const ITEMS = { M: { id: 'M' }, ST: { id: 'ST', kind: 'stillage' } };
const itemOf = (id) => ITEMS[id] ?? null;
const MA = { uid: 'A', itemId: 'M', outputCount: 3, recipe: { in: [], out: 'PART_R' } };
const ST = { uid: 'S', itemId: 'ST' };
const FLOWS = [{ link: { uid: 'L1', to: { uid: 'S' } }, owner: MA, sink: { uid: 'S', cap: 12 } }];
const MACH = [{ uid: 'A', cycleSec: 4, cycleVar: 0.2, cap: 3, need: null }];

/**
 * 벨트가 하는 일을 **흉내 낸다** — 설비 출력을 적치대로 옮긴다.
 * ---------------------------------------------------------------------------
 *  이게 없으면 설비가 제 출력 자리(3개)에서 막혀 버려 적치대는 손도 안 댄다.
 *  그러면 「적치대가 차서 막혔다」(halt 의 ① 규칙)를 확인할 수가 없다 —
 *  실제로 여기서 한 번 헛짚었다.
 *
 *  옮기는 시간(벨트 길이)은 안 센다. 여기서 보려는 것은 **자리가 차면 서는가**
 *  이지 벨트 속도가 아니다.
 */
const drain = (sinkUid, cap) => {
  const n = SS.getMade('A');
  if (n > 0) SS.addLots(sinkUid, Array.from({ length: SS.takeMade('A', n) }, () => 'PART_R'), cap);
};

const lineOf = (over = {}) => {
  const flows = over.beltFlows ?? FLOWS;
  const cap = flows[0]?.sink?.cap ?? Infinity;
  const w = R.lineWorld({
    beltFlows: flows, machines: MACH, placed: [MA, ST], itemOf,
    equips: [], downMap: () => FLT.getDown(), crew: { unmanned: new Set() },
    ...over,
  });
  return (tSec) => { if (flows.length) drain('S', cap); return w(tSec); };
};

t('**막힘이 실제로 쌓인다** — halt 가 화면에 묶여 있으면 못 하는 일이다', () => {
  /* 이 검사가 도는 것이 곧 「막힘·굶음이 도는 라인을 화면 없이 돌린다」는 증거다.
     halt 가 EditorScene 안에 있던 동안에는 반복 실행이 **안 서는 라인**만
     돌릴 수 있었다 — 정작 보고 싶은 것이 빠진 반복 실행이었다. */
  const blocked = R.runOnce({
    seconds: 600, world: lineOf(), rand: R.seeded(7),
    pick: () => MET.getBlocked().A ?? 0,
  });
  assert.ok(blocked > 60, `막힌 시간이 ${blocked}초 — 적치대가 찼는데 안 쌓인다`);
  assert.ok(blocked < 600, '내내 막혔다고 한다 — 처음엔 돌았어야 한다');
});

t('자리가 넉넉하면 안 막힌다 — 막힘이 아무 때나 서지 않는다', () => {
  const roomy = [{ link: { uid: 'L1', to: { uid: 'S' } }, owner: MA, sink: { uid: 'S', cap: 99999 } }];
  const blocked = R.runOnce({
    seconds: 600, world: lineOf({ beltFlows: roomy }), rand: R.seeded(7),
    pick: () => MET.getBlocked().A ?? 0,
  });
  assert.equal(Math.round(blocked), 0, '안 막혀야 하는데 막혔다고 한다');
});

t('world 를 **함수로** 준다 — 재고가 틱마다 달라지니까', () => {
  /* 객체로 주면 첫 틱의 재고로 굳는다. 그러면 적치대가 차도 영영 안 막힌다 */
  assert.equal(typeof lineOf(), 'function', 'lineWorld 가 함수를 안 돌려준다');
  assert.match(src, /typeof d\.world === 'function' \? d\.world\(/, 'runOnce 가 함수를 안 받는다');
});

t('굶음도 잡힌다 — 재료를 안 주면 조립 설비가 굶는다', () => {
  const C = {
    uid: 'C', itemId: 'M', outputCount: 3,
    recipe: { in: [{ kind: 'PART_R', qty: 2 }], out: 'ASM' },
  };
  const starved = R.runOnce({
    seconds: 120,
    world: lineOf({ beltFlows: [], machines: [{ uid: 'C', cycleSec: 4, cap: 3, need: { PART_R: 2 } }], placed: [C] }),
    rand: R.seeded(7),
    pick: () => MET.getStarved().C ?? 0,
  });
  assert.ok(starved > 100, `굶은 시간이 ${starved}초 — 재료가 없는데 안 쌓인다`);
});

t('halt 를 직접 다시 적지 않는다 — core/halt.js 를 부른다', () => {
  assert.match(src, /import \{ haltState \} from '\.\/halt\.js'/);
  for (const rule of ['buildableCount', 'getLots(', 'jammed.add'])
    assert.equal(src.includes(rule), false, `replicate 가 ${rule} 를 다시 들고 있다`);
});

/* ---------- 화면 배선 ------------------------------------------------------ */

const dock = await readSrc('ui/RunDock.jsx');
const hook = await readSrc('ui/useLineWorld.js');

t('반복 실행은 **세 번째 탭**이다 — 실행 탭에 다섯 칸을 늘어놓지 않는다', () => {
  /* 이 파일이 탭을 만든 이유가 「폭이 모자라 글자가 잘렸다」였다. 새 칸을
     실행 탭에 밀어 넣으면 그 문제를 되풀이한다. */
  assert.match(dock, /\['reps', '여러 판'\]/, '세 번째 탭이 없다');
  assert.match(dock, /tab === 'reps' && \(/, '탭으로 안 갈린다');
  const runCols = dock.slice(dock.indexOf("tab === 'run' && ("), dock.indexOf("tab === 'cost' && ("));
  assert.equal((runCols.match(/<Col title=/g) ?? []).length, 4, '실행 탭이 네 칸을 넘었다');
});

t('도면을 **한 곳에서** 모은다 — 두 벌이면 화면과 다른 라인을 돌리게 된다', () => {
  assert.match(dock, /import \{ useLineWorld \} from '\.\/useLineWorld\.js'/);
  const fn = cut(dock, 'function Replicate()', '\n/*', '반복 실행 칸');
  assert.ok(fn.includes('useLineWorld()'), '도면을 자기 나름대로 모은다');
  for (const own of ['beltFlowsOf(', 'machinesOf(', 'haltState('])
    assert.equal(fn.includes(own), false, `화면이 ${own} 를 다시 부른다`);
});

t('훅은 화면 층의 값만 고른다 — 계산은 core 가 한다', () => {
  for (const call of ['beltFlowsOf(', 'machinesOf(', 'lineWorld(', 'linkPath('])
    assert.ok(hook.includes(call), `${call} 를 안 쓴다`);
  /* 규칙을 여기서 다시 적으면 안 된다 */
  for (const rule of ['jammed', 'buildableCount', 'slotShares'])
    assert.equal(hook.includes(rule), false, `훅이 ${rule} 를 다시 들고 있다`);
});

t('돌린 뒤 **화면 실행을 비우고 그 사실을 말한다**', () => {
  const fn = cut(dock, 'function Replicate()', '\n/*', '반복 실행 칸');
  assert.ok(fn.includes('resetRun();'), '섞인 값을 남긴다');
  assert.ok(fn.includes('비워졌습니다'), '말없이 비우면 「내 기록이 왜 사라졌지」가 된다');
});

t('나간 것이 없으면 **0 ± 0 이라고 안 한다** — 고장 난 것처럼 보인다', () => {
  const fn = cut(dock, 'function Replicate()', '\n/*', '반복 실행 칸');
  assert.match(fn, /out\.mean > 0 \? \(/, '0 을 그대로 찍는다');
  assert.ok(fn.includes('밖으로 나간 것이 없습니다'), '0 인 이유를 안 말한다');
  /* 「± 가 크다」는 값이 있을 때만 할 말이다 */
  const zero = fn.slice(fn.indexOf('밖으로 나간 것이 없습니다'));
  assert.equal(zero.includes('± 가 큰 것은'), false, '0 인 판에서도 ± 이야기를 한다');
});
