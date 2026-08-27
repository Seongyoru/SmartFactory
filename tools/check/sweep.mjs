/**
 * =============================================================================
 *  손잡이 돌리기 — 「얼마가 좋은가」
 * =============================================================================
 *  「카트를 몇 대 두면 되나?」 지금까지는 값을 손으로 바꾸고 다시 돌리기를
 *  되풀이해야 답할 수 있었다.
 *
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **「더 늘려도 안 는다」를 구간으로 말해야 한다.** 표만 내면 사람이 눈으로
 *  0.3 개/시 차이를 「늘었다」고 읽고, 필요 없는 카트를 두 대 더 산다.
 *  실제로 잰 값이 그랬다 — 2대 1282 ± 209 · 4대 1284 ± 207.
 *  「최고는 4대」라고 말하면 안 되는 자리다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('손잡이 돌리기');

const S = await import(SRC + 'core/sweep.js');

/** 흔들림까지 담은 가짜 결과 — 곡선 모양만 보면 되는 검사들 */
const row = (v, mean, half = 0) => ({ v, mean, half, se: half / 2.5, n: 6, sd: half });

/* ---------- 손잡이 고르기 -------------------------------------------------- */
t('없는 손잡이는 **없다고 한다**', () => {
  /* 카트가 없는 도면에서 대수를 돌리면 전부 같은 값이 나온다. 그걸 표로 내면
     「늘려도 소용없다」로 읽히는데, 실제로는 돌릴 것이 없는 것이다. */
  const empty = { placed: [], links: [], carts: [], shifts: [] };
  assert.deepEqual(S.knobsFor(empty), [], '없는 도면에 손잡이가 있다');
  assert.equal(S.sweep({ knob: 'cartCount', layout: empty }).why, 'not-here');
  assert.equal(S.sweep({ knob: '없는것', layout: empty }).why, 'no-knob');
});

t('도면에 있는 손잡이만 고른다', () => {
  const d = { placed: [], links: [{ uid: 'L' }], carts: [{ uid: 'C' }], shifts: [] };
  const ids = S.knobsFor(d).map((k) => k.id);
  assert.ok(ids.includes('cartCount'), '카트가 있는데 대수를 못 돌린다');
  assert.ok(ids.includes('beltSpeed'), '벨트가 있는데 속도를 못 돌린다');
  assert.equal(ids.includes('headcount'), false, '교대조가 없는데 정원을 돌린다');
  assert.equal(ids.includes('lotSize'), false, '전환이 없는데 로트를 돌린다');
});

t('로트와 전환은 **서로가 있어야** 뜻이 있다', () => {
  const withSetup = { placed: [{ uid: 'P', setupSec: 300 }] };
  const withLot = { placed: [{ uid: 'P', lotSize: 20 }] };
  assert.ok(S.knobsFor(withSetup).some((k) => k.id === 'lotSize'), '전환이 있는데 로트를 못 돌린다');
  assert.ok(S.knobsFor(withLot).some((k) => k.id === 'setupSec'), '로트가 있는데 전환을 못 돌린다');
});

/* ---------- 도면을 안 건드린다 -------------------------------------------- */
t('**원본 도면을 안 건드린다** — 돌려 보기가 도면을 바꾸면 안 된다', () => {
  const layout = {
    placed: [{ uid: 'P', lotSize: 20, setupSec: 300 }],
    carts: [{ uid: 'C', count: 1 }],
    links: [{ uid: 'L' }], shifts: [{ headcount: 2 }], beltSpeed: 0.6,
  };
  const snap = JSON.stringify(layout);
  for (const k of S.KNOBS) {
    const next = k.patch(layout, k.values(layout)[1]);
    assert.notEqual(next, layout, `${k.id} 가 같은 객체를 돌려준다`);
  }
  assert.equal(JSON.stringify(layout), snap, '원본이 바뀌었다');
});

t('손잡이가 실제로 그 값을 바꾼다', () => {
  const layout = {
    placed: [{ uid: 'P', lotSize: 20, setupSec: 300, capacity: 10 }],
    carts: [{ uid: 'C', count: 1 }], links: [{ uid: 'L' }],
    shifts: [{ headcount: 2 }], beltSpeed: 0.6,
    isStillage: () => true,
  };
  assert.equal(S.knobOf('cartCount').patch(layout, 5).carts[0].count, 5);
  assert.equal(S.knobOf('stillageCap').patch(layout, 99).placed[0].capacity, 99);
  assert.equal(S.knobOf('lotSize').patch(layout, 7).placed[0].lotSize, 7);
  assert.equal(S.knobOf('setupSec').patch(layout, 11).placed[0].setupSec, 11);
  assert.equal(S.knobOf('beltSpeed').patch(layout, 1.5).beltSpeed, 1.5);
  assert.equal(S.knobOf('headcount').patch(layout, 4).shifts[0].headcount, 4);
});

/* ---------- 무릎 (이 파일에서 제일 중요한 것) ----------------------------- */
t('**흔들림 안에서 오른 것은 「늘었다」고 안 한다**', () => {
  /* 실제로 잰 값이다 — 카트 2대 1282 ± 209 · 4대 1284 ± 207.
     눈으로는 4대가 최고지만 두 대를 더 살 이유가 못 된다. */
  const rows = [row(1, 825, 44), row(2, 1282, 209), row(3, 1282, 210), row(4, 1284, 207), row(6, 1283, 210)];
  assert.equal(S.kneeOf(rows).v, 2, '무릎을 잘못 짚는다');
  assert.equal(S.bestOf(rows).v, 4, '최고는 4대가 맞다');
  assert.match(S.kneeText(S.kneeOf(rows), S.knobOf('cartCount')), /2대면 충분합니다/);
});

t('계속 늘고 있으면 **무릎이 없다고 한다**', () => {
  const rows = [row(1, 100, 2), row(2, 200, 2), row(3, 300, 2), row(4, 400, 2)];
  assert.equal(S.kneeOf(rows), null, '아직 오르는 중인데 무릎이라고 한다');
  assert.match(S.kneeText(null, S.knobOf('cartCount')), /더 큰 값도 볼 만합니다/);
});

t('**한 칸 겹쳤다고 바로 자르지 않는다** — 그다음부터 쭉 평평해야 무릎이다', () => {
  /* 2와 3이 우연히 비슷해도 4에서 크게 오르면 무릎이 아니다. 한 칸만 보면
     아직 한참 오를 곡선을 여기서 잘라 버린다. */
  const rows = [row(1, 100, 5), row(2, 200, 5), row(3, 203, 5), row(4, 400, 5), row(6, 402, 5)];
  assert.equal(S.kneeOf(rows).v, 4, `한 칸 겹친 데서 잘랐다 (${S.kneeOf(rows)?.v})`);
});

t('표가 한 줄이면 무릎을 말하지 않는다', () => {
  assert.equal(S.kneeOf([row(1, 100, 5)]), null);
  assert.equal(S.kneeOf([]), null);
  assert.equal(S.kneeOf(null), null);
});

t('내려가는 곡선에서도 **맨 앞이 무릎**이다', () => {
  /* 로트를 키우면 전환이 싸지지만 재공이 는다 — 뒤로 갈수록 나빠질 수 있다.
     그때는 「더 늘려도 안 는다」가 첫 칸에서 이미 참이다. */
  const rows = [row(5, 500, 5), row(10, 400, 5), row(20, 300, 5)];
  assert.equal(S.kneeOf(rows).v, 5);
});

/* ---------- 실제로 돌려 본다 ---------------------------------------------- */
t('돌려 보면 표가 나온다 — 그리고 **씨앗이 같아 두 번이 같다**', () => {
  /* world 는 가짜로 둔다 — 여기서 보는 것은 sweep 의 뼈대지 라인이 아니다.
     (라인까지 통째로 도는 것은 `lineflow.mjs` 가 본다) */
  let call = 0;
  const build = (layout) => ({
    world: () => ({ machines: [], equips: [], halted: [] }),
    flow: null,
    at: layout.carts[0].count,
  });
  const run = () => S.sweep({
    knob: 'cartCount',
    layout: { carts: [{ uid: 'C', count: 1 }] },
    build,
    pick: () => { call += 1; return 100; },
    seconds: 1, reps: 3,
  });
  const a = run();
  const b = run();
  assert.equal(a.ok, true, `못 돌렸다 (${a.why})`);
  assert.equal(a.rows.length, 6, '값 여섯을 다 안 돌렸다');
  assert.deepEqual(a.rows.map((x) => [x.v, x.mean]), b.rows.map((x) => [x.v, x.mean]), '두 번이 다르다');
  assert.equal(call, 36, `판 수가 다르다 (${call})`);
});

t('아무것도 안 나가면 **표를 내지 않고 이유를 말한다**', () => {
  const r = S.sweep({
    knob: 'cartCount',
    layout: { carts: [{ uid: 'C', count: 1 }] },
    build: () => ({ world: () => ({}), flow: null }),
    pick: () => 0,
    seconds: 1, reps: 2,
  });
  assert.equal(r.ok, false);
  assert.equal(r.why, 'all-zero', '0 만 나오는데 표를 낸다');
});

t('값이 너무 많으면 자른다 — 표를 읽는 대신 훑게 된다', () => {
  const r = S.sweep({
    knob: 'cartCount',
    layout: { carts: [{ uid: 'C', count: 1 }] },
    values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    build: () => ({ world: () => ({}), flow: null }),
    pick: () => 10,
    seconds: 1, reps: 2,
  });
  assert.equal(r.rows.length, S.MAX_VALUES);
  assert.ok(S.MAX_VALUES <= 8, '한 화면에 안 들어간다');
});

/* ---------- 배선 ---------------------------------------------------------- */
const src = await readSrc('core/sweep.js');

t('판정은 **Welch 를 다시 안 짠다** — 배치 비교와 같은 잣대여야 한다', () => {
  assert.ok(src.includes("import { differs, pairedDiffers, replicate } from './replicate.js';"), '남의 것을 안 쓴다');
  assert.equal(/Math\.sqrt\(.*se.*\*\*\s*2/.test(src), false, '판정을 여기서 다시 짰다');
});

t('씨앗을 값마다 **같게** 준다 (common random numbers)', () => {
  assert.ok(src.includes('seed: d.seed ?? 1'), '값마다 다른 씨앗을 준다');
  assert.ok(src.includes('common random numbers'), '왜 그런지가 안 적혀 있다');
});

t('**짝지어 견준다** — 같은 난수를 먹였으니 판끼리 짝이 맞는다', () => {
  /* 남남으로 보면(Welch) ± 가 넓어 못 가른다. 실제로 적치대 691 → 821 을
     「안 늘었다」고 해서 화면이 **「10개면 충분합니다」**라고 거짓말을 했다. */
  assert.ok(src.includes('pairedDiffers(rows[i], rows[j])'), '짝을 안 짓는다');
  assert.ok(src.includes('runs: r.runs'), '판별 값을 안 들고 간다 — 짝을 지을 수가 없다');

  const mk = (b) => [b - 40, b - 20, b, b + 20, b + 40, b + 10];
  const withRuns = (v, mean, half) => ({ v, mean, half, se: half / 2.5, n: 6, sd: half, runs: mk(mean) });
  const rows = [withRuns(10, 691, 135), withRuns(40, 788, 68), withRuns(80, 821, 62), withRuns(160, 821, 62)];
  assert.equal(S.kneeOf(rows).v, 80, '짝을 지어도 오르는 곡선을 평평하다고 한다');
});

t('**통계적으로 다른 것과 할 만한 것은 다르다**', () => {
  /* 짝을 지으면 판정이 아주 예민해진다 — 좋은 일이지만 너무 예민하다.
     카트 2대 1276 · 4대 1281 에서 0.4% 를 「늘었다」고 잡아 **트럭을 두 대
     더 사라**고 했다. 2% 문턱을 둔다. */
  const mk = (b) => [b - 40, b - 20, b, b + 20, b + 40, b + 10];
  const r = (v, mean, half) => ({ v, mean, half, se: half / 2.5, n: 6, sd: half, runs: mk(mean) });
  const rows = [r(1, 788, 68), r(2, 1276, 310), r(4, 1281, 311), r(8, 1281, 315)];
  assert.equal(S.kneeOf(rows).v, 2, '0.4% 차이로 두 대를 더 사라고 한다');
  assert.ok(S.SWEEP_TIE > 0 && S.SWEEP_TIE < 0.1, `문턱이 이상하다 (${S.SWEEP_TIE})`);

  /* 문턱을 넘으면 제대로 잡는다 */
  const big = [r(1, 100, 5), r(2, 130, 5)];
  assert.equal(S.kneeOf(big), null, '30% 나 늘었는데 평평하다고 한다');
});

t('손잡이 설명이 **무엇을 알게 되나**로 적혀 있다', () => {
  for (const k of S.KNOBS) {
    assert.ok(k.label && k.unit && k.why, `${k.id} 에 설명이 없다`);
    assert.ok(k.why.length > 15, `${k.id} 의 설명이 너무 짧다`);
  }
});

/* ---------- 화면 ---------------------------------------------------------- */
const dock = await readSrc('ui/RunDock.jsx');

t('네 번째 탭이 붙었다 — 그리고 **한 값씩 잘라 돌린다**', () => {
  assert.ok(dock.includes("['sweep', '민감도']"), '탭이 없다');
  const fn = dock.slice(dock.indexOf('function Sweep()'), dock.indexOf('const TABS ='));
  assert.ok(fn.includes('values: [values[i]]'), '한 덩어리로 돌린다 — 화면이 멈춘다');
  assert.ok(fn.includes('setTimeout(tick, 0)'), '조각 사이에 숨을 안 쉰다');
  assert.ok(fn.includes('setRows([...acc])'), '중간 결과를 안 보여 준다');
});

t('굳힌 뒤에 비운다 — 순서가 바뀌면 담은 값이 0 이 된다', () => {
  const fn = dock.slice(dock.indexOf('function Sweep()'), dock.indexOf('const TABS ='));
  const run = fn.indexOf('const r = sweep({');
  const reset = fn.indexOf('resetRun();');
  assert.ok(run > 0 && reset > run, 'resetRun 이 sweep 보다 먼저다');
});

t('화면이 **무릎을 앞세운다** — 최고가 아니라', () => {
  const fn = dock.slice(dock.indexOf('function Sweep()'), dock.indexOf('const TABS ='));
  assert.ok(fn.includes('kneeText(knee, k)'), '무릎을 안 말한다');
  assert.ok(dock.includes('필요 없는'), '왜 최고를 안 쓰는지 화면이 안 말한다');
});

t('돌릴 손잡이가 없으면 **없다고 한다**', () => {
  const fn = dock.slice(dock.indexOf('function Sweep()'), dock.indexOf('const TABS ='));
  assert.ok(fn.includes('돌려 볼 손잡이가 없습니다'), '빈 화면을 보여 준다');
});

t('나간 것이 없으면 **0 만 늘어놓지 않는다**', () => {
  const fn = dock.slice(dock.indexOf('function Sweep()'), dock.indexOf('const TABS ='));
  assert.ok(fn.includes("setWhy('all-zero')"), '0 만 나오는 것을 안 가른다');
  assert.ok(fn.includes('출하 경로를 놓아야 잡힙니다'), '왜 0 인지 안 말한다');
});

t('세계는 **같은 자리**에서 만든다 — 화면과 갈리면 안 된다', () => {
  const fn = dock.slice(dock.indexOf('function Sweep()'), dock.indexOf('const TABS ='));
  assert.ok(fn.includes('worldOf({ ...d, itemOf, specOf })'), 'core 의 worldOf 를 안 쓴다');
  assert.equal(/beltFlowsOf|machinesOf|lineFlow\(/.test(fn), false, '세계를 여기서 다시 만든다');
});
