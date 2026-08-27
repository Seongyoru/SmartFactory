/**
 * =============================================================================
 *  디스패칭 — **다음에 무엇을 만들까**
 * =============================================================================
 *  품종을 여럿 든 설비는 로트를 채울 때마다 고를 것이 생긴다. 규칙을 바꾸면
 *  **같은 설비로 같은 개수를 만들어도** 납기를 맞추기도 하고 놓치기도 한다.
 *
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **① 이미 그린 도면이 안 바뀐다.** 기본은 「차례대로」다.
 *  **② 답을 못 내면 차례대로.** 오더가 없거나 견줄 것이 없는데 아무거나 고르면
 *     같은 도면이 매번 다르게 돌아 견줄 수가 없다.
 *  **③ 굶는 품종이 없다.** 같은 값이면 차례대로 가른다 — 안 그러면 늘 첫 자리가
 *     이겨서 뒤쪽 품종을 영영 안 만든다.
 *  **④ 두 길이 같은 값을 본다.** 화면과 헤드리스가 각자 오더를 읽으면 눈으로 본
 *     순서와 반복 실행의 순서가 갈린다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('디스패칭');

const D = await import(SRC + 'core/dispatch.js');
const O = await import(SRC + 'core/orders.js');
const P = await import(SRC + 'core/process.js');

const KINDS = ['PART_R', 'PART_G', 'PART_B'];

/* ---------- 값 읽기 ------------------------------------------------------- */
t('규칙은 **기본이 차례대로** — 이미 그린 도면은 안 바뀐다', () => {
  assert.equal(D.ruleOf({}, {}), D.RULE.ORDER);
  assert.equal(D.ruleOf({ dispatch: 'due' }, {}), D.RULE.DUE);
  assert.equal(D.ruleOf({ dispatch: 'behind' }, {}), D.RULE.BEHIND);
  /* 손으로 고친 도면에 없는 규칙이 적혀 있어도 차례대로 */
  assert.equal(D.ruleOf({ dispatch: 'spt' }, {}), D.RULE.ORDER);
});

/* ---------- 차례대로 ------------------------------------------------------ */
t('차례대로는 **돌고 돈다**', () => {
  assert.equal(D.nextSlot(0, KINDS), 1);
  assert.equal(D.nextSlot(1, KINDS), 2);
  assert.equal(D.nextSlot(2, KINDS), 0);
  /* 품종이 하나뿐이면 고를 것이 없다 */
  assert.equal(D.nextSlot(0, ['PART_R']), 0);
});

t('오더가 없으면 **어느 규칙이든 차례대로**', () => {
  for (const rule of [D.RULE.DUE, D.RULE.BEHIND]) {
    assert.equal(D.nextSlot(0, KINDS, rule, () => null), 1, rule);
    assert.equal(D.nextSlot(0, KINDS, rule, null), 1, rule);
  }
});

/* ---------- 납기 먼저 ----------------------------------------------------- */
t('**납기가 급한 것**을 고른다', () => {
  const info = (k) => ({
    PART_R: { due: 900, ratio: 0.1 },
    PART_G: { due: 120, ratio: 0.9 },     // 가장 급하다
    PART_B: { due: 600, ratio: 0.5 },
  })[k] ?? null;
  assert.equal(D.nextSlot(0, KINDS, D.RULE.DUE, info), 1);
  /* 지금 만들고 있는 것이 가장 급해도 **다시 그것을 고른다** — 로트를 또 태운다 */
  assert.equal(D.nextSlot(1, KINDS, D.RULE.DUE, info), 1);
});

t('**다 찬 오더는 안 본다** — 끝난 것을 계속 만들면 남은 것이 안 끝난다', () => {
  const info = (k) => (k === 'PART_G' ? null : { due: 900, ratio: 0.2 });
  /* PART_G 가 가장 급했더라도 다 찼으면(null) 안 고른다 */
  assert.notEqual(D.nextSlot(0, KINDS, D.RULE.DUE, info), 1);
});

/* ---------- 밀린 것 먼저 --------------------------------------------------- */
t('**가장 뒤처진 것**을 고른다', () => {
  const info = (k) => ({
    PART_R: { due: Infinity, ratio: 0.8 },
    PART_G: { due: Infinity, ratio: 0.9 },
    PART_B: { due: Infinity, ratio: 0.1 },   // 가장 밀렸다
  })[k] ?? null;
  assert.equal(D.nextSlot(0, KINDS, D.RULE.BEHIND, info), 2);
  assert.equal(D.nextSlot(2, KINDS, D.RULE.BEHIND, info), 2);
});

t('납기를 안 정한 오더는 **급하지 않다**', () => {
  const info = (k) => (k === 'PART_R'
    ? { due: Infinity, ratio: 0.1 }
    : { due: 300, ratio: 0.9 });
  /* 납기가 있는 쪽이 이긴다 */
  assert.notEqual(D.nextSlot(0, KINDS, D.RULE.DUE, info), 0);
  /* 밀린 것 먼저로 보면 반대다 — 규칙이 다르면 답도 달라야 한다 */
  assert.equal(D.nextSlot(0, KINDS, D.RULE.BEHIND, info), 0);
});

t('**같은 값이면 차례대로** — 굶는 품종이 없어야 한다', () => {
  const same = () => ({ due: 300, ratio: 0.5 });
  /* 늘 첫 자리가 이기면 뒤쪽 품종을 영영 안 만든다 */
  assert.equal(D.nextSlot(0, KINDS, D.RULE.DUE, same), 1);
  assert.equal(D.nextSlot(1, KINDS, D.RULE.DUE, same), 2);
  assert.equal(D.nextSlot(2, KINDS, D.RULE.DUE, same), 0);
});

/* ---------- 오더에서 값을 뽑는다 ------------------------------------------ */
const ORDERS = [
  { uid: 'O1', kind: 'PART_R', qty: 100, dueMin: 30, at: 'ship' },
  { uid: 'O2', kind: 'PART_G', qty: 100, dueMin: 10, at: 'ship' },
];

t('오더에서 **남은 납기와 진척**을 뽑는다', () => {
  const info = O.orderInfoOf(ORDERS, { shipped: { PART_R: 50 } }, 300);
  assert.equal(info('PART_R').due, 30 * 60 - 300);
  assert.equal(info('PART_R').ratio, 0.5);
  assert.equal(info('PART_G').due, 10 * 60 - 300);
  assert.equal(info('PART_G').ratio, 0);
  assert.equal(info('PART_B'), null, '오더가 없는 종류에 값을 준다');
});

t('**다 찬 오더는 목록에서 빠진다**', () => {
  const info = O.orderInfoOf(ORDERS, { shipped: { PART_R: 100 } }, 0);
  assert.equal(info('PART_R'), null, '다 찼는데 계속 만들라고 한다');
  assert.ok(info('PART_G'));
});

t('오더가 없으면 **아무 값도 안 준다**', () => {
  assert.equal(O.orderInfoOf([], {}, 0)('PART_R'), null);
});

t('한 종류에 오더가 여럿이면 **더 급한 쪽**', () => {
  const two = [
    { uid: 'A', kind: 'PART_R', qty: 100, dueMin: 60, at: 'ship' },
    { uid: 'B', kind: 'PART_R', qty: 100, dueMin: 10, at: 'ship' },
  ];
  assert.equal(O.orderInfoOf(two, {}, 0)('PART_R').due, 600);
});

/* ---------- 굴려 본다 ----------------------------------------------------- */
/** 로트를 채울 때마다 무엇을 골랐는지 — 실제로 `runMachine` 을 거친다 */
const sequence = (rule, info, rounds = 6) => {
  P.resetWork();
  const seen = [];
  for (let i = 0; i < rounds * 40; i++) {
    P.runMachine('M', 1, {
      cycleSec: 1, room: 9999, lot: 2, kinds: 3,
      pay: () => true,
      pickSlot: (cur, many) => D.nextSlot(cur, KINDS.slice(0, many), rule, info),
    });
    const s = P.slotOf('M');
    if (seen[seen.length - 1] !== s) seen.push(s);
  }
  return seen;
};

t('**굴려도 규칙대로** 고른다 — 차례대로', () => {
  /* 첫 값은 **시작 자리(0)** 다 — 아직 아무것도 안 골랐을 때의 상태다 */
  const seq = sequence(D.RULE.ORDER, null);
  assert.deepEqual(seq.slice(0, 7), [0, 1, 2, 0, 1, 2, 0], `${seq.join(',')}`);
});

t('**굴려도 규칙대로** 고른다 — 급한 것만 계속', () => {
  /* 두 번째 품종만 급하고 진척이 안 바뀌면 계속 그것만 만든다.
     실제 라인에서는 만들수록 진척이 차서 다른 것으로 넘어간다 */
  const info = (k) => (k === 'PART_G' ? { due: 60, ratio: 0 } : { due: 9999, ratio: 0 });
  const seq = sequence(D.RULE.DUE, info);
  /* 시작 자리(0)에서 급한 것(1)으로 넘어간 뒤 **거기서 안 움직인다** */
  assert.deepEqual(seq, [0, 1], `${seq.join(',')}`);
  /* 같은 도면을 차례대로로 돌리면 셋을 다 돈다 — 규칙이 답을 바꿔야 뜻이 있다 */
  assert.ok(sequence(D.RULE.ORDER, info).length > 3, '규칙을 바꿔도 결과가 같다');
});

/* ---------- 배선 ---------------------------------------------------------- */
const simSrc = await readSrc('core/sim.js');
const lineupSrc = await readSrc('core/lineup.js');
const repSrc = await readSrc('core/replicate.js');
const sceneSrc = await readSrc('scene/EditorScene.jsx');
const inspSrc = await readSrc('ui/Inspector.jsx');
const procSrc = await readSrc('core/process.js');

t('굴리는 쪽이 규칙을 넘긴다', () => {
  assert.ok(lineupSrc.includes('rule: ruleOf(p, item)'), '설비 목록이 규칙을 안 싣는다');
  assert.ok(simSrc.includes('pickSlot: (cur) => nextSlot(cur, many.map((k) => k.out), m.rule, d.orderInfo)'),
    'sim 이 규칙을 안 쓴다');
  assert.ok(procSrc.includes('pickSlot ? pickSlot(slotOf(uid), many) : (slotOf(uid) + 1) % many'),
    '공정이 규칙을 안 본다');
});

t('두 길이 **같은 함수**로 오더를 읽는다', () => {
  /* 각자 계산하면 눈으로 본 순서와 반복 실행의 순서가 갈린다 */
  assert.ok(repSrc.includes('orderInfo: orderInfoOf('), '헤드리스가 오더를 안 읽는다');
  assert.ok(sceneSrc.includes('orderInfoOf(orders, { shipped: ship, arrivedOf }, elapsedSec)'),
    '화면이 오더를 안 읽는다');
  /* 진척은 매 틱 달라진다 — 한 번 만들어 두면 처음에 밀렸던 것만 계속 만든다 */
  assert.ok(repSrc.includes('return (elapsed = 0) => {'), '헤드리스가 오더를 한 번만 읽는다');
});

t('화면이 규칙을 받고, **품종이 여럿일 때만** 보여 준다', () => {
  assert.ok(inspSrc.includes("patch: { dispatch: e.target.value }"), '규칙을 저장 안 한다');
  assert.ok(inspSrc.includes('{kinds > 1 && ('), '품종이 하나인 설비에도 고르기가 뜬다');
  /* 규칙마다 무슨 뜻인지 적어 준다 — 이름만으로는 EDD 를 못 읽는다 */
  assert.ok(inspSrc.includes('RULE_HINT[rule]'), '규칙이 무슨 뜻인지 안 말한다');
});

t('있지도 않은 선택지를 두지 않는다', () => {
  /* 한 설비의 품종들은 공정 시간이 같아서 SPT 로 고를 것이 없다 */
  assert.deepEqual(Object.values(D.RULE), ['order', 'due', 'behind']);
  assert.equal(/SPT|짧은 것 먼저/.test(inspSrc), false, '고를 수 없는 규칙을 화면에 뒀다');
});

/* ---------- 되돌리기가 안 물어 다시 쓴 것 --------------------------------- */
const Rep = await import(SRC + 'core/replicate.js');
const Sim = await import(SRC + 'core/sim.js');
t('**남은 납기가 시간에 따라 준다** — 시계를 안 넘기면 영영 안 급해진다', () => {
  /* 배선을 글자로만 보면 `elapsed` 대신 0 을 넣어도 안 걸린다. 세계를 두 시점에
     불러 값이 실제로 달라지는지를 본다. */
  /* **앞 검사가 출하해 둔 것을 지운다.** 검사는 한 프로세스에서 다 도므로
     재고가 남아 있으면 이 오더가 이미 다 찬 것으로 보인다 — 실제로 그렇게
     「오더를 못 읽는다」는 거짓 실패를 봤다. */
  Sim.resetRun();
  const world = Rep.lineWorld({
    beltFlows: [], machines: [], placed: [], itemOf: () => null,
    orders: [{ uid: 'O', kind: 'PART_R', qty: 100, dueMin: 10, at: 'ship' }],
  });
  const early = world(0).orderInfo('PART_R');
  const late = world(300).orderInfo('PART_R');
  assert.ok(early && late, '오더를 못 읽는다');
  assert.equal(early.due, 600);
  assert.equal(late.due, 300, '시간이 흘렀는데 납기가 그대로다 — 시계를 안 넘긴다');
});

/* ---------- 화면이 오더를 **넘기는가** ------------------------------------- *
 *  `lineup.js:294` 가 `d.orders` 를 받고 `replicate.js` 가 그것으로 `orderInfo`
 *  를 만든다. 배관은 끝까지 깔려 있는데, **마지막 한 칸**을 안 이으면 오더가
 *  늘 빈 배열이 되어 `orderInfoOf` 가 `() => null` 을 돌려주고, 디스패칭 규칙이
 *  조용히 「차례대로」가 된다.
 *
 *  이 실패는 **아무것도 안 터진다.** 라인은 잘 돌고 값도 그럴듯하다. 다만
 *  화면에서 보던 라인과 「반복 실행 · 민감도」가 **서로 다른 라인**이 된다.
 *  그래서 값이 아니라 배선을 못 박는다.
 * -------------------------------------------------------------------------- */

const worldSrc = await readSrc('ui/useLineWorld.js');
const dockSrc = await readSrc('ui/RunDock.jsx');

t('화면 없이 굴리는 world 가 오더를 들고 간다', () => {
  assert.match(worldSrc, /orders: state\.orders,/);
});

t('도면이 그대로여도 **오더가 바뀌면** world 를 다시 만든다', () => {
  /* useMemo 의 deps 에 안 넣으면 오더를 고쳐도 옛 world 로 돌린다 —
     화면은 새 규칙으로 돌고 반복 실행만 옛 오더로 도는, 가장 헷갈리는 어긋남 */
  assert.match(worldSrc, /state\.shifts, state\.orders, itemOf, version\]/);
});

t('손잡이 돌리기와 민감도도 오더를 들고 간다 — 두 곳 다', () => {
  const hits = dockSrc.split('shifts: state.shifts, orders: state.orders,').length - 1;
  assert.equal(hits, 2, `${hits}곳 — 토네이도와 민감도 둘 다여야 한다`);
});

t('배치 비교도 오더를 들고 간다 — 규칙을 바꾼 효과가 보이려면', () => {
  assert.match(inspSrc, /orders: state\.orders,/);
});

t('오더가 없으면 규칙이 **조용히 차례대로가 된다** — 위 배선의 근거', () => {
  /* 이 값이 이 검사들의 이유다. 넘기든 안 넘기든 아무것도 안 터지므로,
     「안 넘기면 이렇게 된다」를 값으로 남겨 둔다. */
  const none = O.orderInfoOf([], {}, 0);
  assert.equal(none('PART_R'), null);
  assert.equal(D.nextSlot(0, KINDS, D.RULE.DUE, none), D.nextSlot(0, KINDS, D.RULE.ORDER));
  assert.equal(D.nextSlot(1, KINDS, D.RULE.BEHIND, none), D.nextSlot(1, KINDS, D.RULE.ORDER));
});

/* ---------- 규칙이 **먹일 것 없이** 돌 때 ---------------------------------- *
 *  「납기 먼저」를 골라 두고 오더에 납기를 안 넣으면 규칙은 아무것도 안 하고
 *  조용히 「차례대로」가 된다. 라인은 잘 돌고 값도 그럴듯하다.
 *
 *  실제로 그 상태로 한참 시험하다 「납기 먼저는 고장인가」로 이어졌다. 고장이
 *  아니라 **먹일 것이 없었다.** 같은 오더인데 「밀린 것 먼저」만 돌던 것도 같은
 *  까닭이다 — 진척은 0 이라도 견줄 수 있고, 남은 납기는 Infinity 라 못 견준다.
 * -------------------------------------------------------------------------- */

t('납기 없는 오더 — 납기 먼저가 **왜 안 도는지** 말한다', () => {
  const o = [{ uid: 'O', kind: 'PART_R', qty: 100, dueMin: 0, at: 'ship' }];
  const say = O.ruleGap(D.RULE.DUE, o, ['PART_R', 'PART_G']);
  assert.ok(say, '아무 말도 안 한다');
  assert.match(say, /납기/);
});

t('같은 오더로 밀린 것 먼저는 멀쩡하다 — 그래서 헷갈린다', () => {
  const o = [{ uid: 'O', kind: 'PART_R', qty: 100, dueMin: 0, at: 'ship' }];
  /* 진척은 0 이라도 견줄 수 있다. 한 품종에만 걸린 것은 따로 알린다 */
  const say = O.ruleGap(D.RULE.BEHIND, o, ['PART_R', 'PART_G']);
  assert.equal(/납기/.test(say ?? ''), false, '납기 얘기를 하면 안 된다');
});

t('그 말이 참인지 값으로 — 납기 0 이면 정말 차례대로다', () => {
  const kinds = ['PART_R', 'PART_G'];
  const info = O.orderInfoOf([{ uid: 'O', kind: 'PART_G', qty: 100, dueMin: 0, at: 'ship' }], {}, 0);
  for (let c = 0; c < 4; c += 1) {
    assert.equal(D.nextSlot(c, kinds, D.RULE.DUE, info), D.nextSlot(c, kinds, D.RULE.ORDER));
  }
  /* 밀린 것 먼저는 다르다 — 견줄 값이 있다 */
  assert.notEqual(
    [0, 1, 2, 3].map((c) => D.nextSlot(c, kinds, D.RULE.BEHIND, info)).join(),
    [0, 1, 2, 3].map((c) => D.nextSlot(c, kinds, D.RULE.ORDER)).join(),
  );
});

t('납기는 넣었는데 오더가 한 품종뿐이면 **그것을** 말한다', () => {
  /* 틀린 것은 아니다. 다만 「왜 늘 이것만 만들지」의 답이라 말해 준다 */
  const o = [{ uid: 'O', kind: 'PART_R', qty: 100, dueMin: 10, at: 'ship' }];
  assert.match(O.ruleGap(D.RULE.DUE, o, ['PART_R', 'PART_G']), /한 품종에만/);
});

t('두 품종에 납기가 다 걸리면 할 말이 없다 — 그때가 규칙이 온전히 도는 때다', () => {
  const o = [
    { uid: 'A', kind: 'PART_R', qty: 100, dueMin: 10, at: 'ship' },
    { uid: 'B', kind: 'PART_G', qty: 100, dueMin: 30, at: 'ship' },
  ];
  assert.equal(O.ruleGap(D.RULE.DUE, o, ['PART_R', 'PART_G']), null);
  /* 그리고 실제로 급한 쪽을 고른다 */
  const info = O.orderInfoOf(o, {}, 0);
  assert.equal(D.nextSlot(0, ['PART_R', 'PART_G'], D.RULE.DUE, info), 0);   // R 이 10분
});

t('오더가 아예 없으면 그것도 말한다', () => {
  assert.match(O.ruleGap(D.RULE.DUE, [], ['PART_R']), /오더가 없습니다/);
});

t('차례대로는 오더를 안 보므로 할 말이 없다', () => {
  assert.equal(O.ruleGap(D.RULE.ORDER, [], ['PART_R']), null);
});

t('화면이 그 말을 실제로 띄운다', () => {
  assert.match(inspSrc, /ruleGap\(rule, state\.orders, kindNames\)/, '인스펙터가 안 묻는다');
});
