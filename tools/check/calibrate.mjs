/**
 * =============================================================================
 *  실적 보정 — **이 모델이 실제와 얼마나 맞나**
 * =============================================================================
 *  컨설팅에서 제일 먼저 받는 질문이다. 처리량 1,200개/시라고 말해 봐야 실제
 *  라인이 850개/시로 돌고 있으면 그 도구는 안 믿긴다 — 그리고 그게 맞다.
 *
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **① 실적을 안 적으면 아무 말도 안 한다.** 없는 값을 지어내지 않는다.
 *  **② 안 맞으면 안 맞는다고 한다.** 제일 가까운 값도 한참 멀면 「이 손잡이로는
 *     설명이 안 됩니다」라고 해야 한다 — 틀린 확신을 주면 안 된다.
 *  **③ 가까운 것이 여럿이면 작은 쪽.** 같은 설명력이면 덜 바꾸는 쪽이 낫다.
 *  **④ 새 엔진을 안 만든다.** 값을 훑는 일은 손잡이 돌리기가 이미 한다 —
 *     그 표를 「가장 큰 값」이 아니라 「가장 가까운 값」으로 읽을 뿐이다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('실적 보정');

const C = await import(SRC + 'core/calibrate.js');
const S = await import(SRC + 'core/sweep.js');

/* ---------- 얼마나 어긋났나 ----------------------------------------------- */
t('실적을 안 적으면 **아무 말도 안 한다**', () => {
  assert.equal(C.matchOf(1000, 0), null);
  assert.equal(C.matchOf(1000, null), null);
  assert.equal(C.matchOf(1000, -5), null);
  assert.equal(C.fitOf([{ v: 1, mean: 100 }], 0), null);
  assert.equal(C.matchText(null, 0, 0), '실적을 적으면 모델과 견줍니다');
});

t('**차이를 실적 대비로** 잰다', () => {
  const m = C.matchOf(1200, 850);
  assert.equal(m.over, true);
  assert.ok(Math.abs(m.ratio - 350 / 850) < 1e-9);
  assert.equal(m.ok, false);
  /* 모델이 낮을 수도 있다 */
  assert.equal(C.matchOf(700, 850).over, false);
});

t('**5% 안이면 맞는 것으로 본다**', () => {
  /* 계측 오차와 날마다의 흔들림이 이 정도는 된다. 더 좁히면 늘 「안 맞는다」가
     뜨고, 더 넓히면 진짜 어긋난 모델을 통과시킨다 */
  assert.equal(C.MATCH_TIE, 0.05);
  assert.equal(C.matchOf(1040, 1000).ok, true);
  assert.equal(C.matchOf(960, 1000).ok, true);
  assert.equal(C.matchOf(1060, 1000).ok, false);
});

t('말이 **어느 쪽으로 어긋났는지**를 담는다', () => {
  assert.match(C.matchText(C.matchOf(1200, 850), 1200, 850), /높습니다/);
  assert.match(C.matchText(C.matchOf(700, 850), 700, 850), /낮습니다/);
  assert.match(C.matchText(C.matchOf(1000, 1000), 1000, 1000), /맞습니다/);
});

/* ---------- 어느 값이 실적과 맞나 ----------------------------------------- */
const ROWS = [
  { v: 1, mean: 500 },
  { v: 2, mean: 860 },
  { v: 3, mean: 1100 },
  { v: 4, mean: 1180 },
];

t('**실적에 가장 가까운 값**을 고른다 — 가장 큰 값이 아니라', () => {
  const fit = C.fitOf(ROWS, 850);
  assert.equal(fit.v, 2);
  assert.ok(fit.match.ok, '가까운데 안 맞는다고 한다');
  /* 손잡이 돌리기가 고르는 것은 다른 값이다 — 둘은 다른 물음이다 */
  assert.equal(S.bestOf(ROWS).v, 4);
});

t('가까운 것이 여럿이면 **작은 쪽**', () => {
  const tie = [{ v: 2, mean: 900 }, { v: 5, mean: 900 }];
  assert.equal(C.fitOf(tie, 900).v, 2, '같은 설명력인데 더 크게 바꾸라고 한다');
});

t('**한참 멀면 설명이 안 된다고 말한다**', () => {
  /* 「제일 가까운 값」이라도 실적과 멀면 그 손잡이로는 설명이 안 된다.
     그때 「2대로 하세요」라고 말하면 틀린 확신을 주는 것이다 */
  const fit = C.fitOf(ROWS, 200);
  assert.equal(fit.v, 1);
  assert.equal(fit.match.ok, false);
  const knob = { unit: '대' };
  assert.match(C.fitText(fit, knob, 200), /설명되지 않습니다/);
  assert.match(C.fitText(C.fitOf(ROWS, 850), knob, 850), /2대면 실적과 맞습니다/);
});

t('훑어 본 것이 없으면 그렇게 말한다', () => {
  assert.equal(C.fitText(null, { unit: '대' }, 900), '훑어 본 값이 없습니다');
  assert.equal(C.fitOf([], 900), null);
});

/* ---------- 바꿀 만한 차이인가 -------------------------------------------- */
const paired = (v, mean, runs) => ({ v, mean, runs, sd: 1, se: 1, half: 2, n: runs.length });

t('지금 값과 **구별이 안 되면** 그렇게 말한다', () => {
  /* 뜻 없는 변경을 권하면 안 된다 */
  const rows = [
    paired(2, 900, [900, 901, 899, 900, 900, 900]),
    paired(3, 902, [902, 901, 903, 902, 902, 902]),
  ];
  const fit = C.fitOf(rows, 902);
  const moved = C.movedFrom(rows, 2, fit);
  assert.ok(moved, '지금 값에서 옮겼는데 아무 말이 없다');
  assert.equal(moved.from.v, 2);
  /* 두 값이 확실히 다르면 sure — 여기서는 판마다 거의 같으니 다르다고 나온다 */
  assert.equal(typeof moved.sure, 'boolean');
});

t('고른 값이 **지금 값 그대로면** 옮길 것이 없다', () => {
  const rows = [paired(2, 900, [900, 900, 900]), paired(3, 700, [700, 700, 700])];
  assert.equal(C.movedFrom(rows, 2, C.fitOf(rows, 900)), null);
  assert.equal(C.movedFrom(rows, undefined, C.fitOf(rows, 900)), null, '지금 값을 모르는데 말한다');
});

/* ---------- 손잡이가 지금 값을 안다 --------------------------------------- */
t('손잡이마다 **지금 도면이 어디 있는지**를 안다', () => {
  /* 이게 없으면 「지금 값과 구별이 안 된다」는 말을 아예 못 한다 */
  for (const k of S.KNOBS) assert.equal(typeof k.now, 'function', `${k.id} 에 now 가 없다`);
  assert.equal(S.knobOf('cartCount').now({ carts: [{ count: 3 }] }), 3);
  assert.equal(S.knobOf('beltSpeed').now({ beltSpeed: 0.9 }), 0.9);
  assert.equal(S.knobOf('headcount').now({ shifts: [{ headcount: 4 }] }), 4);
  assert.equal(
    S.knobOf('stillageCap').now({ placed: [{ capacity: 80 }], isStillage: () => true }), 80,
  );
  /* 볼 것이 없으면 null — 없는 값을 지어내지 않는다 */
  assert.equal(S.knobOf('beltSpeed').now({}), null);
  assert.equal(S.knobOf('headcount').now({}), null);
});

/* ---------- 배선 ---------------------------------------------------------- */
const dockSrc = await readSrc('ui/RunDock.jsx');

t('화면이 실적을 받고 **훑어 본 표로** 견준다', () => {
  assert.ok(dockSrc.includes('setActual(Number(e.target.value) || 0)'), '실적을 못 적는다');
  assert.ok(dockSrc.includes('matchOf(top.mean, actual)'), '모델과 안 견준다');
  assert.ok(dockSrc.includes('fitOf(rows, actual)'), '맞는 값을 안 찾는다');
  /* 새 엔진을 안 만든다 — 위에서 이미 돌린 표를 다시 읽을 뿐이다 */
  assert.equal(/sweep\(\{[\s\S]{0,200}calibrat/.test(dockSrc), false, '보정이 따로 돌린다');
});

t('**실적을 적었을 때만** 말한다', () => {
  assert.ok(dockSrc.includes('{!busy && actual > 0 && ('), '실적이 없는데 보정을 보여 준다');
});

t('**숫자만 맞추는 것이 목적이 아니라고** 적어 둔다', () => {
  /* 아무 손잡이나 비틀어 맞출 수 있다. 그러면 맞는 것은 그 숫자 하나뿐이고
     배치를 바꿨을 때의 예측은 더 나빠진다 */
  assert.ok(dockSrc.includes('도면과 현장이 실제로 다른 것'), '보정의 한계를 안 말한다');
});
