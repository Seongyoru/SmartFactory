/**
 * =============================================================================
 *  로트 전환 (셋업) — 몇 개마다 얼마를 쉬는가
 * =============================================================================
 *  설비는 계속 같은 것만 뽑지 않는다. 몇 개 만들고 나면 날을 갈고, 금형을
 *  바꾸고, 청소를 한다. 그동안은 아무것도 안 나온다.
 *
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **「돌리기 전 계산」과 「돌려 본 결과」가 같아야 한다.** 천장(`balance`)이
 *  전환을 셈에 안 넣으면 사람은 시뮬이 틀렸다고 여긴다 — 실제로 라인이 천장의
 *  절반밖에 안 나오는데 이유를 화면 어디에서도 못 찾게 된다.
 *
 *  그리고 이 시간은 **가동률(A)** 에서 빠진다. 고장·무인과 같은 자리다 —
 *  「돌 수 있었는데 못 돈」 것이 아니라 애초에 못 도는 시간이기 때문이다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('로트 전환');

const P = await import(SRC + 'core/process.js');
const M = await import(SRC + 'core/metrics.js');
const B = await import(SRC + 'core/balance.js');

const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

/* ---------- 값 읽기 ------------------------------------------------------- */
t('안 정하면 **전환이 없다** — 이미 그린 도면이 안 바뀐다', () => {
  assert.equal(P.lotOf({}, {}), 0);
  assert.equal(P.setupOf({}, {}), 0);
  assert.equal(P.effectiveCycle(6, 0, 0), 6);
  assert.equal(P.effectiveCycle(6, 0, 300), 6, '로트를 안 정했는데 전환이 붙는다');
  assert.equal(P.effectiveCycle(6, 20, 0), 6, '전환 시간이 0 인데 느려진다');
});

t('실질 공정 = 공정 + 전환/로트', () => {
  /* 20개마다 300초면 한 개당 15초가 얹힌다 — 로트가 작을수록 비싸다 */
  near(P.effectiveCycle(6, 20, 300), 21);
  near(P.effectiveCycle(6, 10, 300), 36);
  near(P.effectiveCycle(6, 60, 300), 11);
});

/* ---------- 실제로 그만큼 안 나오는가 ------------------------------------- */
const run = (opt, seconds, dt = 0.1) => {
  P.resetWork();
  let made = 0;
  let setupSec = 0;
  for (let t0 = 0; t0 < seconds; t0 += dt) {
    made += P.runMachine('X', dt, { cycleSec: 6, room: 99, ...opt });
    setupSec += P.setupTook('X');
  }
  return { made, setupSec, perHour: (made * 3600) / seconds };
};

t('전환을 넣으면 **덜 나온다**', () => {
  const free = run({}, 1800);
  const lot = run({ lot: 20, setupSec: 300 }, 1800);
  assert.equal(free.setupSec, 0, '전환을 안 걸었는데 시간이 든다');
  assert.ok(lot.made < free.made, `전환을 걸었는데 안 줄었다 (${lot.made} vs ${free.made})`);
  assert.ok(lot.setupSec > 0, '전환 시간이 안 잡힌다');
});

t('오래 돌리면 **천장에 수렴한다** — 계산과 실측이 만난다', () => {
  /* 이 검사가 이 기능의 값을 지킨다. 갈리면 사람이 시뮬을 안 믿는다. */
  const ceil = 3600 / P.effectiveCycle(6, 20, 300);          // 171.4 개/시
  const got = run({ lot: 20, setupSec: 300 }, 180_000).perHour;
  assert.ok(Math.abs(got - ceil) / ceil < 0.02, `천장 ${ceil.toFixed(1)} 인데 ${got.toFixed(1)} 이 나온다`);
});

t('**짧게 돌리면 천장보다 높게 나온다** — 마지막 전환을 안 치러서다', () => {
  /* 알고 두는 것이다. 이걸 모르면 「천장을 넘었다」를 버그로 쫓게 된다.
     배치 비교의 「너무 짧음」 경고가 이 경우도 함께 덮는다. */
  const ceil = 3600 / P.effectiveCycle(6, 20, 300);
  assert.ok(run({ lot: 20, setupSec: 300 }, 1800).perHour > ceil, '전제가 바뀌었다');
  assert.ok(run({ lot: 20, setupSec: 300 }, 18_000).perHour < run({ lot: 20, setupSec: 300 }, 1800).perHour,
    '오래 돌려도 안 내려온다');
});

t('로트를 키우면 전환이 싸진다 · 전환을 빠르게 해도 싸진다', () => {
  const small = run({ lot: 10, setupSec: 300 }, 180_000).perHour;
  const big = run({ lot: 60, setupSec: 300 }, 180_000).perHour;
  const fast = run({ lot: 10, setupSec: 60 }, 180_000).perHour;
  assert.ok(big > small, '로트를 키웠는데 안 나아진다');
  assert.ok(fast > small, '전환을 빠르게 했는데 안 나아진다 (SMED)');
});

t('전환 중에는 **한 개도 안 나온다**', () => {
  P.resetWork();
  /* 로트 하나를 채운다 (2개 × 6초) */
  let made = 0;
  for (let i = 0; i < 130; i++) made += P.runMachine('S1', 0.1, { cycleSec: 6, room: 99, lot: 2, setupSec: 60 });
  assert.equal(made, 2, `로트를 넘겼다 (${made}개)`);
  assert.equal(P.inSetup('S1'), true, '전환에 안 들어갔다');
  /* 전환이 끝날 때까지 아무것도 안 나온다 */
  let more = 0;
  for (let i = 0; i < 300; i++) more += P.runMachine('S1', 0.1, { cycleSec: 6, room: 99, lot: 2, setupSec: 60 });
  assert.equal(more, 0, `전환 중에 ${more}개가 나왔다`);
});

t('자리가 없으면 전환도 안 돈다 — **막힌 것이 막힘으로 보여야 한다**', () => {
  /* 막힌 설비가 「전환 중」으로 찍히면 정작 막힌 것이 화면에서 사라진다.
     어차피 자리가 나야 다음 로트를 시작하므로 미뤄도 값이 안 달라진다. */
  P.resetWork();
  for (let i = 0; i < 130; i++) P.runMachine('S2', 0.1, { cycleSec: 6, room: 99, lot: 2, setupSec: 60 });
  assert.equal(P.inSetup('S2'), true);
  const before = P.setupTook('S2');
  P.runMachine('S2', 10, { cycleSec: 6, room: 0, lot: 2, setupSec: 60 });   // 막힘
  assert.equal(P.setupTook('S2'), 0, '막혔는데 전환 시간이 흐른다');
  void before;
});

t('되돌리면 로트 셈도 처음부터', () => {
  P.resetWork();
  for (let i = 0; i < 130; i++) P.runMachine('S3', 0.1, { cycleSec: 6, room: 99, lot: 2, setupSec: 60 });
  assert.ok(P.inSetup('S3'));
  P.resetWork();
  assert.equal(P.inSetup('S3'), false, '전환이 남아 있다');
  assert.equal(P.lotMade('S3'), 0, '로트 셈이 남아 있다');
});

/* ---------- 천장이 이것을 본다 -------------------------------------------- */
const bal = (over = {}) => B.lineBalance({
  placed: [{ uid: 'M', name: '설비', itemId: 'EQ', cycleSec: 6, ...over }],
  links: [], carts: [],
  itemOf: () => ({ id: 'EQ', category: 'equipment' }),
  specOf: () => null,
});

t('천장이 전환을 셈에 넣는다', () => {
  const free = bal();
  const lot = bal({ lotSize: 20, setupSec: 300 });
  near(free.capacity, 10);                              // 6초/개 → 10개/분
  near(lot.capacity, 60 / 21, 0.01);                    // 21초/개
  assert.ok(lot.capacity < free.capacity, '전환을 걸었는데 천장이 그대로다');
});

t('천장이 **왜 그런지**까지 말한다', () => {
  assert.match(bal().rows[0].why, /^공정 6초\/개$/);
  assert.match(bal({ lotSize: 20, setupSec: 300 }).rows[0].why, /전환 300초\/20개/);
});

/* ---------- 지표 — 가동률(A) 손실 ----------------------------------------- */
t('전환 시간은 **가동률(A)** 에서 빠진다 — 고장·무인과 같은 자리', () => {
  M.resetMetrics();
  P.resetWork();
  for (let t0 = 0; t0 < 600; t0 += 0.1) {
    P.runMachine('Y', 0.1, { cycleSec: 6, room: 99, lot: 20, setupSec: 300 });
    const s = new Set();
    if (P.setupTook('Y') > 0) s.add('Y');
    M.accumulate(0.1, null, 0, null, null, s);
  }
  const sec = M.setupTimeOf('Y');
  assert.ok(sec > 0, '전환 시간이 안 쌓인다');
  const oee = M.oeeOf('Y');
  near(oee.setupSec, sec, 0.5);
  near(oee.availability, 1 - sec / 600, 0.01);
  assert.equal(oee.performance, 1, '막히지도 굶지도 않았는데 성능이 깎였다');
});

t('되돌리면 전환 시간도 비워진다', () => {
  M.resetMetrics();
  assert.equal(M.setupTimeOf('Y'), 0);
  assert.equal(M.setupTotal(), 0);
});

t('잃은 시간 나누기에 전환이 들어간다', () => {
  M.resetMetrics();
  M.accumulate(10, null, 0, null, null, new Set(['Z']));
  const split = M.lossSplit();
  assert.ok(split, '전환만 있는데 아무것도 안 나온다');
  near(split.change, 10);
});

/* ---------- 배선 ---------------------------------------------------------- */
const simSrc = await readSrc('core/sim.js');
const lineupSrc = await readSrc('core/lineup.js');
const inspSrc = await readSrc('ui/Inspector.jsx');
const dockSrc = await readSrc('ui/RunDock.jsx');

t('굴리는 쪽이 로트를 넘긴다', () => {
  assert.ok(lineupSrc.includes('lot: lotOf(p, item)'), '설비 목록이 로트를 안 싣는다');
  assert.ok(lineupSrc.includes('setupSec: setupOf(p, item)'), '전환 시간을 안 싣는다');
  assert.ok(simSrc.includes('lot: m.lot'), 'sim 이 로트를 안 넘긴다');
  assert.ok(simSrc.includes('setupSec: m.setupSec'), 'sim 이 전환 시간을 안 넘긴다');
});

t('전환을 **서는 이유로** 센다 — 한 틱에 하나만', () => {
  assert.ok(simSrc.includes('if (setupTook(m.uid) > 0) setupNow.add(m.uid);'), '전환을 안 모은다');
  assert.ok(simSrc.includes('starvedOnly, downOnly, setupNow)'), '지표에 안 넘긴다');
  /* 고장 → 무인 → 전환 → 막힘 → 굶음. 전환이 막힘보다 앞이어야 한다 */
  const order = ['nowDown.has(uid)', "d.unmanned?.has(uid)", 'setupNow.has(uid)', 'd.jammed?.has(uid)', 'd.starved?.has(uid)'];
  let at = -1;
  for (const one of order) {
    const k = simSrc.indexOf(one);
    assert.ok(k > at, `서는 이유의 순서가 틀렸다 — ${one}`);
    at = k;
  }
});

t('화면이 로트와 전환을 받는다 — 그리고 **품종 전환이라 부르지 않는다**', () => {
  assert.ok(inspSrc.includes('label="로트 크기"'), '로트 칸이 없다');
  assert.ok(inspSrc.includes('label="전환 시간"'), '전환 시간 칸이 없다');
  assert.ok(inspSrc.includes("patch: { lotSize: v }"), '로트를 저장 안 한다');
  assert.ok(inspSrc.includes("patch: { setupSec: v }"), '전환 시간을 저장 안 한다');
  /* 한 설비가 한 가지만 만드는 모델에서 「품종 전환」은 거짓말이다.
     **주석은 빼고 본다** — 왜 그렇게 안 부르는지 적어 둔 자리까지 걸리면
     설명을 지워야 검사가 통과하는 꼴이 된다. */
  const shown = inspSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/품종 전환/.test(shown), false, '있지도 않은 품종을 바꾼다고 화면이 말한다');
});

t('실행 탭이 전환을 **따로** 보여 준다', () => {
  assert.ok(dockSrc.includes("key: 'change', label: '전환'"), '전환 줄이 없다');
  assert.ok(dockSrc.includes('split.change'), '합계에 안 넣는다');
  assert.ok(dockSrc.includes('SMED'), '푸는 방법을 안 말한다');
});

t('화면이 **실질 공정**을 말해 준다', () => {
  assert.ok(inspSrc.includes('effectiveCycle(cycleSec, lot, setupSec)'), '실질 공정을 안 낸다');
  assert.ok(inspSrc.includes('가동률(A)'), '어디서 빠지는 시간인지 안 말한다');
});

t('전환이 제일 크면 **배치 이야기를 안 한다** — 처방이 다르다', () => {
  /* 화면이 「전환 4분 · 막힘 2분」을 보여 주면서 「막힘이 큽니다 — 라인 뒤쪽을
     늘리세요」라고 했다. 라인 앞뒤를 늘려도 전환 시간은 그대로다. */
  assert.ok(dockSrc.includes('split.change > split.block && split.change > split.starve'),
    '전환이 큰 경우를 안 가른다');
  assert.ok(dockSrc.includes('로트를 키우거나'), '무엇을 하라는지 안 말한다');
  assert.ok(dockSrc.includes('라인 앞뒤를 늘려도 이 시간은 그대로입니다'),
    '배치로는 안 풀린다는 것을 안 말한다');
  /* 사람이 없는 것이 여전히 맨 위다 — 그건 배치로도 로트로도 안 풀린다 */
  assert.ok(dockSrc.indexOf('사람이 없어 선 시간이') < dockSrc.indexOf('split.change > split.block'),
    '무인보다 전환을 먼저 말한다');
});
