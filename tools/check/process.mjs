/**
 * 공정 시간 — 설비가 한 개를 만드는 데 걸리는 시간.
 *  이 모듈이 라인의 처리량을 정한다. 배속을 올렸을 때 결과가 달라지거나, 재료가
 *  샌다면 여기서 난다.
 */
import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

group('공정 시간');

const P = await import(SRC + 'core/process.js');
const B = await import(SRC + 'core/bom.js');
const { isUtility } = await import(SRC + 'data/library.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

/* ---------- 값 읽기 ---------- */
t('자리에 적은 값이 라이브러리 기본값을 이긴다', () => {
  assert.equal(P.cycleOf({ cycleSec: 3 }, { cycleSec: 12 }), 3);
  assert.equal(P.cycleOf({}, { cycleSec: 12 }), 12);
  assert.equal(P.cycleOf({}, {}), P.DEFAULT_CYCLE);
});
t('0 이나 음수·쓰레기값은 기본값으로 돌린다', () => {
  assert.equal(P.cycleOf({ cycleSec: 0 }, {}), P.DEFAULT_CYCLE);
  assert.equal(P.cycleOf({ cycleSec: -5 }, {}), P.DEFAULT_CYCLE);
  assert.equal(P.cycleOf({ cycleSec: 'abc' }, {}), P.DEFAULT_CYCLE);
  assert.equal(P.cycleOf(null, null), P.DEFAULT_CYCLE);
});
t('편차는 0 ~ 상한 사이로 자른다', () => {
  assert.equal(P.varOf({ cycleVar: 0.2 }, {}), 0.2);
  assert.equal(P.varOf({ cycleVar: -1 }, {}), 0);
  assert.equal(P.varOf({ cycleVar: 9 }, {}), P.VAR_MAX);
  assert.equal(P.varOf({}, {}), 0);
});

/* ---------- 능력 환산 ---------- */
t('초/개 → 개/분', () => {
  near(P.perMinute(6), 10);
  near(P.perMinute(12), 5);
  assert.equal(P.perMinute(0), 0);
});
t('벨트 수송 능력 — 간격·속도·층수', () => {
  // 3m 간격, 0.6 m/s → 5초에 한 덩어리, 한 덩어리 3층 → 36 개/분
  near(P.beltPerMinute(3, 0.6, 3), 36);
  near(P.beltPerMinute(3, 0.6, 1), 12);
  near(P.beltPerMinute(1.5, 0.6, 3), 72);       // 간격 절반 → 두 배
});
t('말이 안 되는 값을 넣어도 0 으로 나누지 않는다', () => {
  assert.ok(Number.isFinite(P.beltPerMinute(0, 0, 0)));
  assert.ok(P.beltPerMinute(0, 0, 0) > 0);
});

/* ---------- 편차 ---------- */
t('편차 0 이면 늘 같은 시간', () => {
  near(P.drawCycle(6, 0, () => 0.9), 6);
  near(P.drawCycle(6, 0, () => 0.1), 6);
});
t('편차는 ±비율 안에서만 흔들린다', () => {
  near(P.drawCycle(10, 0.2, () => 0), 8);        // rand 0 → -20%
  near(P.drawCycle(10, 0.2, () => 1), 12);       // rand 1 → +20%
  near(P.drawCycle(10, 0.2, () => 0.5), 10);
});
t('아무리 흔들려도 0 이하로는 안 간다', () => {
  assert.ok(P.drawCycle(0.05, 0.5, () => 0) > 0);
});

/* ---------- 한 프레임 굴리기 ---------- */
const run = (uid, dt, opt = {}) =>
  P.runMachine(uid, dt, { cycleSec: 6, room: 99, ...opt });

t('공정 시간이 차야 한 개가 나온다', () => {
  P.resetWork();
  assert.equal(run('A', 5), 0);
  assert.equal(run('A', 0.9), 0);
  assert.equal(run('A', 0.2), 1);               // 6.1초째
});
t('남은 시간을 이어서 센다 — 프레임을 잘게 쪼개도 결과가 같다', () => {
  P.resetWork();
  let a = 0;
  for (let i = 0; i < 600; i++) a += run('A', 0.1);
  P.resetWork();
  let b = 0;
  for (let i = 0; i < 6; i++) b += run('B', 10);
  assert.equal(a, 10);
  assert.equal(a, b, `잘게 ${a} · 굵게 ${b}`);
});
t('한 프레임에 여러 개가 끝나도 안 빠뜨린다 (높은 배속)', () => {
  P.resetWork();
  assert.equal(run('A', 30), 5);                // 6초 × 5
});
t('출력 자리가 없으면 시작도 안 한다', () => {
  P.resetWork();
  assert.equal(run('A', 100, { room: 0 }), 0);
  assert.equal(P.hasWork('A'), false, '자리도 없는데 걸어 놨다');
});
t('자리만큼만 만들고 남는 시간은 버린다', () => {
  P.resetWork();
  assert.equal(run('A', 100, { room: 2 }), 2);
});

/* ---------- 재료 ---------- */
t('재료는 **시작할 때** 낸다 — 완성될 때가 아니다', () => {
  P.resetWork();
  const paid = [];
  run('A', 1, { pay: () => { paid.push('냈다'); return true; } });
  assert.equal(paid.length, 1, '한 개도 안 끝났는데 재료를 안 냈다');
});
t('재료를 못 내면 그 자리에서 멈춘다 (굶음)', () => {
  P.resetWork();
  assert.equal(run('A', 100, { pay: () => false }), 0);
  assert.equal(P.hasWork('A'), false);
});
t('재료를 못 내도 **먹지는 않는다** — 두 개 만들 재료로 두 개만', () => {
  P.resetWork();
  let left = 2;
  const pay = () => (left > 0 ? (left--, true) : false);
  assert.equal(run('A', 100, { pay }), 2);
  assert.equal(left, 0);
});
t('만든 개수만큼만 재료를 낸다 — 새지 않는다', () => {
  P.resetWork();
  let paid = 0;
  let made = 0;
  for (let i = 0; i < 500; i++) made += run('A', 0.5, { pay: () => { paid++; return true; } });
  /* 진행 중인 한 개는 이미 재료를 냈다 — 그래서 낸 것이 하나 더 많을 수 있다 */
  assert.ok(paid === made || paid === made + 1, `낸 ${paid} · 만든 ${made}`);
});

/* ---------- 진행률 ---------- */
t('진행률은 0 ~ 1', () => {
  P.resetWork();
  run('A', 3);                                   // 6초짜리의 절반
  near(P.progressOf('A'), 0.5);
  assert.equal(P.progressOf('없는설비'), 0);
});
t('다시 재기가 걸어 둔 것을 지운다', () => {
  P.resetWork();
  run('A', 3);
  assert.ok(P.hasWork('A'));
  P.resetWork();
  assert.equal(P.hasWork('A'), false);
});
t('설비 하나만 지울 수도 있다', () => {
  P.resetWork();
  run('A', 3);
  run('B', 3);
  P.resetWork('A');
  assert.equal(P.hasWork('A'), false);
  assert.ok(P.hasWork('B'));
});

/* ---------- 화면에 뜨는 숫자 --------------------------------------------------
     한 화면에 개/분 이 두 번 뜨는데 값이 달랐다. 인스펙터의 「출하」 가 층수를
     빠뜨린 채 손으로 60 ÷ (간격 ÷ 속도) 를 계산하고 있었기 때문이다 — 같은
     이름으로 다른 값을 보여 주면 사용자는 도구를 못 믿는다. 환산은 한 곳에서만.
--------------------------------------------------------------------------- */
const inspector = await readSrc('ui/Inspector.jsx');
const persistence = await readSrc('core/persistence.js');
const store = await readSrc('core/store.jsx');
const scene = await readSrc('scene/EditorScene.jsx');
const lineup = await readSrc('core/lineup.js');

t('인스펙터가 개/분 을 손으로 계산하지 않는다', () => {
  /* 60 을 곱하거나 나눠서 분당 수를 만드는 식이 남아 있으면 안 된다 */
  const hand = inspector.match(/60\s*\/\s*\(\(?placed\.|\*\s*60\s*\)?\s*\)?\s*개\/분/g) ?? [];
  assert.deepEqual(hand, [], `손으로 계산한 자리가 남았다: ${hand.join(' · ')}`);
  assert.ok(inspector.includes('beltPerMinute('), 'beltPerMinute 을 안 쓴다');
  assert.ok(inspector.includes('perMinute(cycleSec)'), 'perMinute 을 안 쓴다');
});
t('층수를 빠뜨리지 않는다 — 덩어리가 아니라 **개**를 센다', () => {
  const bundlesPerMin = 60 / (3 / 0.6);          // 12 덩어리/분
  near(P.beltPerMinute(3, 0.6, 3), bundlesPerMin * 3);
  assert.notEqual(P.beltPerMinute(3, 0.6, 3), bundlesPerMin);
});

/* 인스펙터 맨 위의 숫자를 **소스에서 떼어** 실제로 계산해 본다 */
const panel = new Function(
  'placed', 'item', 'state', 'itemOf', 'beltSpeed', 'useMemo',
  'isUtility', 'cycleOf', 'varOf', 'perMinute', 'beltPerMinute', 'spacingFor', 'spacingClamped',
  'lotOf', 'setupOf', 'effectiveCycle', 'shapeOf', 'recipesOf',
  `${cut(
    inspector,
    'const cycleSec = cycleOf(placed, item);',
    'const beltIsLimit = !!outLink && spacingClamped(cycleSec, bundle, beltV);',
  )}\nreturn { cycleSec, cycleVar, bundle, gap, machineRate, beltV, beltRate, rate, beltIsLimit, lot, setupSec, effCycle, shape, kinds };`,
);

const show = (placed, links = [], items = {}) =>
  panel(
    placed, items[placed.itemId] ?? {}, { links }, (id) => items[id] ?? {}, 0.6,
    (fn) => fn(), isUtility, P.cycleOf, P.varOf, P.perMinute, P.beltPerMinute,
    P.spacingFor, P.spacingClamped, P.lotOf, P.setupOf, P.effectiveCycle, P.shapeOf, B.recipesOf,
  );

const BELT = { CONV: { id: 'CONV' } };
const belt = (uid) => ({ uid: 'L1', itemId: 'CONV', from: { uid } });

t('벨트가 없으면 설비 능력이 그대로 처리량이다', () => {
  const r = show({ uid: 'M', cycleSec: 6, outputCount: 3 });
  near(r.rate, 10);
  assert.equal(r.beltIsLimit, false);
});
t('간격이 자동이라 벨트가 설비를 그대로 따라온다', () => {
  const r = show({ uid: 'M', cycleSec: 6, outputCount: 3 }, [belt('M')], BELT);
  near(r.gap, 10.8);                     // 0.6 m/s × (6초 × 3개)
  near(r.machineRate, 10);
  near(r.beltRate, 10);                  // 예전에는 36 이라 적어 놓고 실제는 못 냈다
  near(r.rate, 10);
  assert.equal(r.beltIsLimit, false);
});
t('설비가 아주 빠를 때만 벨트가 한계다 (최소 간격에 걸린다)', () => {
  const r = show({ uid: 'M', cycleSec: 0.5, outputCount: 1 }, [belt('M')], BELT);
  near(r.gap, P.MIN_GAP);
  assert.equal(r.beltIsLimit, true);
  assert.ok(r.rate < r.machineRate, '한계인데 처리량이 안 깎였다');
});
t('그 벨트의 속도를 쓴다 — 전역 기본값이 아니라', () => {
  const p = { uid: 'M', cycleSec: 6, outputCount: 3 };
  const r = show(p, [{ ...belt('M'), speed: 3 }], BELT);
  near(r.beltV, 3);
  near(r.gap, 54);                       // 3 m/s × 18초
  near(r.rate, 10);                      // 속도가 달라도 능력은 그대로
});
t('저장 안 되던 벨트 속도 — 도면 저장 목록에 들어 있다', () => {
  assert.ok(persistence.includes('beltSpeed: state.beltSpeed'), 'layoutSnapshot 에 없다');
  assert.ok(/DOC_KEYS = \[[^\]]*'beltSpeed'/.test(store), 'DOC_KEYS 에 없다');
});
t('저장 목록 두 벌이 어긋나지 않는다', () => {
  /* layoutSnapshot 이 담는 키와 자동 저장이 지켜보는 키는 **같아야 한다.**
     예전에 openings·shifts 가, 이번엔 beltSpeed 가 한쪽에만 있어서 조용히
     저장이 안 됐다. 둘 다 손으로 적는 목록이라 또 어긋난다. */
  const snap = cut(persistence, 'export const layoutSnapshot = (state) => ({', '});')
    .match(/^\s{2}(\w+):/gm).map((s) => s.trim().replace(':', ''));
  const keys = store.match(/DOC_KEYS = \[([^\]]*)\]/)[1]
    .match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));
  assert.deepEqual([...snap].sort(), [...keys].sort(),
    `snapshot ${snap.join(',')} ≠ DOC_KEYS ${keys.join(',')}`);
});
t('남의 설비에 물린 벨트는 안 본다', () => {
  const r = show({ uid: 'M', cycleSec: 6, outputCount: 3, spawnGap: 3 }, [belt('다른설비')], BELT);
  near(r.rate, 10);
  assert.equal(r.beltV, 0.6);
});

/* ---------- 배속을 바꿔도 같은 결과 ---------- */
t('배속이 달라도 같은 시간에 같은 개수가 나온다', () => {
  const total = 600;                             // 시뮬 600초
  const counts = [0.05, 0.5, 2].map((dt) => {
    P.resetWork();
    let n = 0;
    for (let i = 0; i < total / dt; i++) n += P.runMachine('X', dt, { cycleSec: 7, room: 99 });
    return n;
  });
  assert.deepEqual(counts, [counts[0], counts[0], counts[0]], `배속마다 다르다: ${counts}`);
  assert.equal(counts[0], Math.floor(total / 7));
});

/* ---------- 간격은 정하는 값이 아니라 따라 나오는 값 ------------------------
     슬라이더였을 때는 맞출 방법이 없었다. 촘촘히 할수록 좋은 게 아니라 톱니처럼
     오르내렸다 — 벨트 칸이 빈 채로 먼저 지나가면 다음 칸을 통째로 기다린다.
--------------------------------------------------------------------------- */
t('간격 = 벨트속도 × 한 덩어리 만드는 시간', () => {
  near(P.bundleSeconds(0.5, 8), 4);
  near(P.spacingFor(0.5, 8, 0.95), 3.8);
  near(P.spacingFor(6, 3, 0.6), 10.8);
});
t('그 간격이면 벨트 능력이 설비 능력과 같아진다 — 어느 쪽도 안 논다', () => {
  for (const [c, n, v] of [[0.5, 8, 0.95], [6, 3, 0.6], [12, 1, 1.4], [3, 4, 0.8]]) {
    near(P.beltPerMinute(P.spacingFor(c, n, v), v, n), P.perMinute(c), 1e-9);
  }
});
t('설비가 너무 빠르면 최소 간격에 걸린다 — 그때가 진짜 벨트 한계다', () => {
  assert.equal(P.spacingFor(0.5, 1, 0.6), P.MIN_GAP);      // 0.3 → 0.4 로 올라간다
  assert.equal(P.spacingClamped(0.5, 1, 0.6), true);
  assert.equal(P.spacingClamped(0.5, 8, 0.95), false);
});
t('걸렸을 때는 벨트 능력이 설비보다 **작다** (그래서 막힌다)', () => {
  const [c, n, v] = [0.5, 1, 0.6];
  assert.ok(P.beltPerMinute(P.spacingFor(c, n, v), v, n) < P.perMinute(c));
});
t('벨트가 느려지면 간격도 같이 좁아진다 — 능력은 그대로', () => {
  near(P.beltPerMinute(P.spacingFor(6, 3, 0.3), 0.3, 3), P.perMinute(6));
  near(P.beltPerMinute(P.spacingFor(6, 3, 2.0), 2.0, 3), P.perMinute(6));
});

/* ---------- 뷰포트 게이지 --------------------------------------------------
     설비 위에 뜨는 진행 막대. 공정이 길면 이게 "돌고 있다" 는 유일한 신호다.
--------------------------------------------------------------------------- */
const tag = await readSrc('scene/StockTag.jsx');

t('게이지는 리렌더 없이 그린다 — DOM 폭만 직접 만진다', () => {
  assert.ok(tag.includes('useFrame('), 'useFrame 이 없다');
  assert.ok(/style\.width\s*=/.test(tag), '폭을 직접 안 만진다');
  assert.equal(/useState\s*\(/.test(tag), false,
    '진행률을 상태로 들면 설비 한 대당 초당 60번 리렌더가 걸린다');
});
t('게이지가 뷰포트에 있다 — 인스펙터가 아니라', () => {
  assert.ok(tag.includes("from '@react-three/drei'"), '3D 씬 안이 아니다');
  assert.ok(tag.includes('bundleProgress('), '덩어리 진행률을 안 읽는다');
});
t('진행률이 0 → 1 을 반복해서 쓸어 간다', () => {
  P.resetWork();
  const seen = [];
  for (let i = 0; i < 40; i++) {
    P.runMachine('G', 0.5, { cycleSec: 6, room: 99 });
    seen.push(P.progressOf('G'));
  }
  assert.ok(seen.every((v) => v >= 0 && v <= 1), '0~1 을 벗어났다');
  /* 한 개가 끝나면 0 으로 떨어졌다가 다시 오른다 */
  let drops = 0;
  for (let i = 1; i < seen.length; i++) if (seen[i] < seen[i - 1]) drops++;
  assert.ok(drops >= 2, `게이지가 안 돌아간다 (떨어진 횟수 ${drops})`);
});
t('막혀 서 있으면 게이지가 비어 있다 — 안 돌고 있다는 뜻이다', () => {
  P.resetWork();
  P.runMachine('H', 100, { cycleSec: 6, room: 1 });     // 한 개 만들고 자리가 참
  P.runMachine('H', 100, { cycleSec: 6, room: 0 });     // 막힘
  assert.equal(P.progressOf('H'), 0);
});

/* ---------- 출력 자리 — 멀쩡한 설비가 깜빡이면 안 된다 --------------------
     한 덩어리치만 두면 다 만든 순간부터 벨트 칸이 올 때까지 설비가 선다.
     개수도 손해지만 화면이 거짓말을 하는 게 더 문제다 — 1초에 한 번씩 붉게
     깜빡이면 사용자가 없는 고장을 쫓는다.
--------------------------------------------------------------------------- */
t('출력 자리는 한 덩어리 + 한 개', () => {
  assert.equal(P.OUT_SPARE, 1);
  assert.equal(P.outputCapFor(2), 3);
  assert.equal(P.outputCapFor(8), 9);
  assert.equal(P.outputCapFor(0), 2);            // 말이 안 되는 값도 한 덩어리 + 1
});
t('설비 목록을 만드는 쪽이 그 값을 쓴다 — 손으로 적어 두면 또 어긋난다', () => {
  /* 예전에는 EditorScene 의 useMemo 안에 있었다 — core/lineup.js 로 옮겼다 */
  assert.ok(lineup.includes('cap: outputCapFor('), 'outputCapFor 를 안 쓴다');
});

t('한 칸만 더 주면 되고, 더 줘도 나아지지 않는다', () => {
  /* 두 배로 두면 화면의 「8개씩」과 「0/16」이 안 맞아 값이 두 배로 먹혔다고 읽힌다.
     붙들려 있는 재고도 그만큼 는다. 한 칸이면 충분하다는 것이 근거다. */
  assert.equal(P.outputCapFor(8), 9);
  assert.ok(P.outputCapFor(8) < 8 * 2);
});
t('자투리를 버리는 배선이 씬에 있다', () => {
  assert.ok(scene.includes('getMade(m.uid) % m.per'), '자투리 계산이 없다');
  assert.ok(scene.includes('lastPer'), '직전 값을 안 기억한다');
});

/* ---------- 게이지는 **덩어리** 단위 -----------------------------------------
     한 개짜리로 재면 3층 설비의 게이지가 세 번 차올랐다 떨어지는 동안 벨트로는
     아무것도 안 나간다. 1초/개 × 3층이면 3초짜리 게이지가 맞다.
--------------------------------------------------------------------------- */
t('1초/개 × 3층 → 3초짜리 게이지', () => {
  P.resetWork();
  const seen = [];
  for (let i = 0; i < 12; i++) {
    P.runMachine('B1', 0.25, { cycleSec: 1, room: 99 });
    /* 실제로는 벨트가 3개를 실어 가지만, 여기서는 게이지 자체만 본다 */
    const made = Math.min(3, Math.floor((i + 1) * 0.25));
    seen.push(P.bundleProgress('B1', 3, made));
  }
  near(seen[3], 1 / 3, 1e-6);          // 1초 → 3분의 1
  near(seen[5], 0.5, 1e-6);            // 1.5초 → 절반
  near(seen[11], 1, 1e-6);             // 3초 → 가득
});
t('덩어리를 다 만들면 가득 찬 채로 기다린다', () => {
  P.resetWork();
  assert.equal(P.bundleProgress('B2', 3, 3), 1);
  assert.equal(P.bundleProgress('B2', 3, 4), 1);   // 여유칸까지 차도 1 을 안 넘는다
});
t('만든 개수 + 지금 만드는 한 개 — 둘을 함께 센다', () => {
  P.resetWork();
  P.runMachine('B3', 0.5, { cycleSec: 1, room: 99 });   // 한 개의 절반
  near(P.bundleProgress('B3', 4, 2), (2 + 0.5) / 4);
});
t('말이 안 되는 값이 와도 0~1 을 안 벗어난다', () => {
  P.resetWork();
  assert.equal(P.bundleProgress('없음', 0, 0), 0);
  assert.equal(P.bundleProgress('없음', 3, -5), 0);
  assert.equal(P.bundleProgress('없음', 3, 99), 1);
});

/* ---------- 공정 시간을 바꾸면 **걸려 있던 것에도 바로** 먹힌다 --------------
     120초 → 0.5초 로 바꿔도 이미 걸려 있던 작업이 120초를 다 쓰고 나서야 새 값이
     먹혔다. 게이지도 그동안 멈춰 있었다(1 − 남은시간/0.5 가 한참 음수라 0% 에
     붙는다) — 돌고 있는지조차 알 수 없었다. 남은 시간을 **초로** 들고 있어서다.
--------------------------------------------------------------------------- */
t('공정 시간을 줄이면 남은 시간도 같은 비율로 준다', () => {
  P.resetWork();
  for (let i = 0; i < 20; i++) P.runMachine('C1', 0.5, { cycleSec: 120, room: 99 });
  near(P.progressOf('C1'), 10 / 120, 1e-6);      // 10초 돌렸다 = 8.3%

  /* 여기서 0.5초로 바꾼다. 남은 91.7% × 0.5초 ≈ 0.46초면 끝나야 한다 */
  let made = 0;
  for (let i = 0; i < 5; i++) made += P.runMachine('C1', 0.1, { cycleSec: 0.5, room: 99 });
  assert.equal(made, 1, `0.5초 안에 안 끝났다 — 옛 시간을 그대로 쓰고 있다`);
});
t('바꾼 뒤로는 새 시간으로 계속 나온다', () => {
  P.resetWork();
  P.runMachine('C2', 60, { cycleSec: 120, room: 99 });        // 절반 진행
  let made = 0;
  for (let i = 0; i < 100; i++) made += P.runMachine('C2', 0.1, { cycleSec: 0.5, room: 99 });
  /* 10초 동안: 첫 개(남은 절반 = 0.25초) + 0.5초마다 하나 → 스무 개 안팎 */
  assert.ok(made >= 19 && made <= 21, `10초에 ${made}개 — 0.5초 간격이 아니다`);
});
t('게이지가 멈추지 않는다 — 바꾼 직후에도 0~1 안에서 흐른다', () => {
  P.resetWork();
  for (let i = 0; i < 20; i++) P.runMachine('C3', 0.5, { cycleSec: 120, room: 99 });
  const seen = [];
  for (let i = 0; i < 4; i++) {
    P.runMachine('C3', 0.1, { cycleSec: 0.5, room: 99 });
    seen.push(P.progressOf('C3'));
  }
  assert.ok(seen.every((v) => v > 0 && v <= 1), `게이지가 0 에 붙었다: ${seen.join(', ')}`);
  assert.ok(seen[3] > seen[0], '게이지가 안 움직인다');
});
t('공정 시간을 늘리면 반대로 남은 시간이 는다', () => {
  P.resetWork();
  P.runMachine('C4', 3, { cycleSec: 6, room: 99 });           // 6초짜리의 절반
  near(P.progressOf('C4'), 0.5);
  /* 60초짜리로 바꾸면 남은 절반은 30초다 — 10초로는 안 끝난다 */
  assert.equal(P.runMachine('C4', 10, { cycleSec: 60, room: 99 }), 0);
  assert.equal(P.runMachine('C4', 21, { cycleSec: 60, room: 99 }), 1);
});
t('편차는 개마다 뽑은 것을 유지한다 — 공정 시간만 갈아탄다', () => {
  P.resetWork();
  const rand = () => 1;                                        // 늘 +최대 편차
  P.runMachine('C5', 1, { cycleSec: 10, cycleVar: 0.2, room: 99, rand });
  near(P.progressOf('C5'), 1 / 12, 1e-6);                      // 12초짜리로 뽑혔다
  /* 공정 시간을 5초로 바꾸면 이번 개는 5 × 1.2 = 6초짜리가 된다 */
  assert.equal(P.runMachine('C5', 5.4, { cycleSec: 5, cycleVar: 0.2, room: 99, rand }), 0);
  assert.equal(P.runMachine('C5', 0.2, { cycleSec: 5, cycleVar: 0.2, room: 99, rand }), 1);
});
