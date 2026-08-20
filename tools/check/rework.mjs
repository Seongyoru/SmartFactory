/**
 * =============================================================================
 *  재작업 — **불량을 버리는 대신 다시 만든다**
 * =============================================================================
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **① 이미 그린 도면이 안 바뀐다.** 재작업 시간 0 이면 예전처럼 버린다.
 *  **② 판정은 만들 때 한다.** 벨트 끝에서 걸렀더니 **카트로 나르는 설비는
 *     불량이 아예 안 나왔고**, 다 흘러간 뒤라 되돌릴 수도 없었다.
 *  **③ 살아나도 공짜가 아니다.** 재작업 시간이 설비의 능력을 갉아먹는다 —
 *     천장이 그것을 알아야 「돌리기 전 계산」과 「돌려 본 결과」가 안 갈린다.
 *  **④ 재작업이 양품률을 덮지 않는다.** 다시 만든 것도 같은 불량률을 한 번 더
 *     지난다. 안 그러면 불량률을 아무리 올려도 양품률이 100% 가 된다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';
import { itemOf, loadModels, specOf as specById } from './_models.mjs';

group('재작업');

const P = await import(SRC + 'core/process.js');
const F = await import(SRC + 'core/faults.js');
const B = await import(SRC + 'core/balance.js');
const St = await import(SRC + 'core/simStore.js');
const Lu = await import(SRC + 'core/lineup.js');
const R = await import(SRC + 'core/replicate.js');
const A = await import(SRC + 'core/area.js');
const LIB = await import(SRC + 'data/library.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

/* ---------- 값 읽기 ------------------------------------------------------- */
t('재작업 시간은 **기본이 0** — 이미 그린 도면은 버린다', () => {
  assert.equal(P.reworkOf({}, {}), 0);
  assert.equal(P.reworkOf({ reworkSec: 30 }, { reworkSec: 5 }), 30);
  assert.equal(P.reworkOf({}, { reworkSec: 5 }), 5);
});

/* ---------- 양품 개당 시간 ------------------------------------------------ */
t('**불량은 양품 개당 시간을 늘린다**', () => {
  near(P.effectiveCycle(6, 0, 0, 1), 6);                                   // 안 넘기면 그대로
  near(P.effectiveCycle(6, 0, 0, 1, { scrap: 0 }), 6);
  /* 열 개 만들어 하나를 버리면 양품 아홉 개 — 6 ÷ 0.9 */
  near(P.effectiveCycle(6, 0, 0, 1, { scrap: 0.1 }), 6 / 0.9);
});

t('**다시 만들면 그 시간이 들고, 끝내 버리는 것은 제곱이다**', () => {
  /* (6 + 0.1 × 30) ÷ (1 − 0.01) */
  near(P.effectiveCycle(6, 0, 0, 1, { scrap: 0.1, reworkSec: 30 }), 9 / 0.99);
  /* 재작업이 공짜면(0초) 버리는 것보다 낫다 — 제곱만 버리니까 */
  const redo = P.effectiveCycle(6, 0, 0, 1, { scrap: 0.2, reworkSec: 1 });
  const toss = P.effectiveCycle(6, 0, 0, 1, { scrap: 0.2 });
  assert.ok(redo < toss, `다시 만드는 쪽이 더 느리다 (${redo} vs ${toss})`);
  /* 재작업이 아주 비싸면 버리는 쪽이 낫다 — 이 갈림이 이 기능의 쓸모다 */
  const slow = P.effectiveCycle(6, 0, 0, 1, { scrap: 0.2, reworkSec: 120 });
  assert.ok(slow > toss, '재작업이 비싼데도 버리는 쪽보다 빠르다');
});

t('배치·전환과 **겹쳐도** 셈이 선다', () => {
  /* 한 판 10개 · 공정 60초 → 6초/개, 로트 20개마다 300초 → +15, 불량 10% 버림 */
  near(P.effectiveCycle(60, 20, 300, 10, { scrap: 0.1 }), 21 / 0.9);
});

/* ---------- 세는 쪽 ------------------------------------------------------- */
const roll = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };

t('재작업품은 **만든 개수에 두 번 안 들어간다**', () => {
  F.resetQuality();
  /* 열 개 중 둘이 불량 (0.05 < 0.1) */
  F.screen(10, 0.1, 'M', roll([0.05, 0.5, 0.05, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));
  assert.equal(F.getMade(), 10);
  assert.equal(F.getScrapped(), 2);
  /* 그 둘을 다시 만들었다 — 하나는 또 불량 */
  const good = F.screenAgain(2, 0.1, 'M', roll([0.05, 0.5]));
  assert.equal(good, 1);
  assert.equal(F.getMade(), 10, '같은 물건을 두 번 셌다 — 양품률 분모가 부푼다');
  assert.equal(F.getScrapped(), 3, '두 번째 불량을 안 버렸다');
});

t('다시 만든 개수는 **버린 것과 따로** 센다', () => {
  F.resetQuality();
  F.addRework('M', 4);
  assert.equal(F.getReworked(), 4);
  assert.equal(F.reworkedOf('M'), 4);
  assert.equal(F.getScrapped(), 0, '재작업을 버린 것으로 셌다');
  F.resetQuality();
  assert.equal(F.getReworked(), 0, '초기화가 재작업을 안 지운다');
});

/* ---------- 굴려 본다 ----------------------------------------------------- */
/** 늘 불량이 나는 설비 — 재작업이 실제로 도는지 본다 */
const drive = (opt, ticks, dt = 1) => {
  P.resetWork();
  let good = 0, redone = 0, checked = 0;
  for (let i = 0; i < ticks; i++) {
    good += P.runMachine('X', dt, {
      cycleSec: opt.cycleSec, room: 9999, reworkSec: opt.reworkSec ?? 0,
      pay: () => true,
      check: (n, again) => {
        checked += n;
        /* 첫 통과는 전부 불량, 재작업품은 전부 양품 */
        return again ? n : (opt.allBad ? 0 : n);
      },
      onRedo: (n) => { redone += n; },
    });
  }
  return { good, redone, checked, waiting: P.redoWaiting('X') };
};

t('불량이 나면 **재작업 줄에 선다**', () => {
  const r = drive({ cycleSec: 10, reworkSec: 5, allBad: true }, 12);
  assert.ok(r.redone > 0, '불량이 났는데 재작업 줄에 안 섰다');
});

t('**다시 만든 것이 양품으로 나온다**', () => {
  /* 10초 공정 + 5초 재작업 — 60초면 첫 개(10초) → 재작업(5초) → … */
  const r = drive({ cycleSec: 10, reworkSec: 5, allBad: true }, 60);
  assert.ok(r.good > 0, `재작업했는데 양품이 하나도 안 나온다 (${JSON.stringify(r)})`);
});

t('재작업 시간이 0이면 **버린다** — 줄에 안 선다', () => {
  const r = drive({ cycleSec: 10, reworkSec: 0, allBad: true }, 60);
  assert.equal(r.redone, 0, '안 고치기로 했는데 줄에 세웠다');
  assert.equal(r.good, 0);
  assert.equal(r.waiting, 0);
});

t('**재작업품은 재료를 안 먹는다** — 이미 물건이 되어 있다', () => {
  P.resetWork();
  let paid = 0;
  let n = 0;
  for (let i = 0; i < 40; i++) {
    n += P.runMachine('Y', 1, {
      cycleSec: 10, room: 9999, reworkSec: 5,
      pay: () => { paid += 1; return true; },
      check: (_, again) => (again ? 1 : 0),          // 첫 통과는 늘 불량
      onRedo: () => {},
    });
  }
  assert.ok(n > 0, '양품이 안 나왔다');
  /* 40초에 10초짜리 공정은 넷을 못 넘긴다. 재작업이 재료를 먹었다면 그보다 많다 */
  assert.ok(paid <= 4, `재작업이 재료를 먹었다 — 재료를 ${paid}번 냈다`);
  assert.ok(paid >= n, `양품 ${n}개인데 재료를 ${paid}번밖에 안 냈다`);
});

t('재작업은 **로트를 안 채운다** — 같은 물건을 다시 만드는 것이다', () => {
  P.resetWork();
  /* 로트 2개마다 전환. 첫 통과 2개면 전환에 들어가야 하고, 그 사이 재작업이
     아무리 돌아도 전환이 앞당겨지면 안 된다 */
  let first = 0;
  for (let i = 0; i < 60; i++) {
    P.runMachine('L', 1, {
      cycleSec: 5, room: 9999, reworkSec: 1, lot: 4, setupSec: 60,
      pay: () => true,
      check: (n, again) => { if (!again) first += n; return again ? n : 0; },
      onRedo: () => {},
    });
  }
  /* 첫 통과 4개를 채우기 전에는 전환이 없다 */
  assert.ok(first <= 5, `첫 통과가 ${first}개나 됐다 — 재작업이 자리를 안 먹는다`);
});

/* ---------- 끝에서 끝까지 ------------------------------------------------- */
await loadModels(['MACHINE_1', 'STILLAGE', 'CONVEYOR']);
const idByKey = new Map(LIB.BUILTIN_LIBRARY.filter((x) => x.modelKey).map((x) => [x.modelKey, x.id]));
const specOf = (it) => (it?.modelKey ? specById(idByKey.get(it.modelKey) ?? '') : null);
const areas = [{ uid: 'F', mp: A.rectMP([-20, -20], [20, 20]) }];
const links = [{
  uid: 'C1', itemId: 'CONVEYOR', from: { uid: 'P1', portId: 'PORT_OUT@Z-' }, to: { uid: 'S1' },
  radius: 0.5, layer: 0, width: 1,
}];
const line = (scrap, reworkSec) => [
  {
    uid: 'P1', name: '제작기', itemId: 'MACHINE_1', pos: [-6, 6], rot: 0, outputCount: 3, cycleSec: 6,
    scrapRate: scrap, reworkSec, recipe: { in: [], out: 'PART_R' },
  },
  { uid: 'S1', name: '적치대', itemId: 'STILLAGE', pos: [-6, 0], rot: 0, capacity: 200 },
];
const at = (scrap, reworkSec, sec, seed) => {
  St.clearStock();
  const placed = line(scrap, reworkSec);
  const w = Lu.worldOf({
    placed, links, carts: [], areas, walls: [], openings: [], shifts: [], beltSpeed: 0.6, itemOf, specOf,
  });
  /* **난수를 직접 먹인다.** `seed` 만 넘기면 `runOnce` 는 그것을 안 보고
     `Math.random` 으로 떨어진다 — 불량이 매번 달라져 검사가 흔들린다.
     실제로 이 검사가 그렇게 한 번 무작위로 깨졌다. */
  R.runOnce({ seconds: sec, world: w.world, flow: w.flow, pick: () => 0, rand: R.seeded(seed) });
  return { n: St.getLots('S1').length + St.getMade('P1'), ceil: w.capacity * 60 };
};
/**
 * 정상 상태 — 예열 300초를 빼고, **씨앗 여섯 판을 평균**한다.
 *  불량은 동전 던지기라 한 판만 보면 30% 짜리가 25% 로도 35% 로도 나온다.
 *  실제로 한 판만 보고 「천장의 108%」 같은 값을 봤다.
 */
const steady = (scrap, reworkSec) => {
  let sum = 0, ceil = 0;
  const N = 6;
  for (let i = 0; i < N; i++) {
    const a = at(scrap, reworkSec, 300, 100 + i);
    const b = at(scrap, reworkSec, 1200, 100 + i);
    sum += (b.n - a.n) * 4;
    ceil = b.ceil;
  }
  return { perHour: sum / N, ceil };
};

t('**천장과 실측이 만난다** — 불량률만 올려도 갈리던 자리다', () => {
  /* 재작업을 붙이기 전에는 천장이 불량을 아예 몰라서 「천장 600 · 실제 544」
     였다. 이 검사가 이 기능의 값 자체다. */
  for (const [scrap, redo] of [[0, 0], [0.1, 0], [0.1, 6], [0.1, 30], [0.3, 0], [0.3, 6]]) {
    const r = steady(scrap, redo);
    assert.ok(r.perHour <= r.ceil * 1.06,
      `불량 ${scrap} · 재작업 ${redo}: 천장 ${r.ceil.toFixed(0)} 을 넘었다 (${r.perHour.toFixed(0)})`);
    assert.ok(r.perHour > r.ceil * 0.88,
      `불량 ${scrap} · 재작업 ${redo}: 천장 ${r.ceil.toFixed(0)} 인데 ${r.perHour.toFixed(0)} 밖에 안 나온다`);
  }
});

t('**재작업이 비싸면 천장이 내려앉는다**', () => {
  const fast = steady(0.1, 6);
  const slow = steady(0.1, 30);
  assert.ok(slow.ceil < fast.ceil * 0.8,
    `재작업을 다섯 배로 늘렸는데 천장이 그대로다 (${fast.ceil.toFixed(0)} → ${slow.ceil.toFixed(0)})`);
  assert.ok(slow.perHour < fast.perHour * 0.85, '실제 처리량이 안 줄었다');
});

t('불량률 0 이면 **예전 값 그대로**', () => {
  const r = steady(0, 0);
  assert.ok(Math.abs(r.perHour - r.ceil) < r.ceil * 0.05, `${r.perHour} vs ${r.ceil}`);
});

/* ---------- 천장이 뭐라고 적나 -------------------------------------------- */
t('화면이 **왜 이 속도인지** 적는다', () => {
  assert.equal(B.whyOf({ cyc: 6, scrap: 0.1, eff: 6.67 }), '공정 6초 · 불량 10% 버림 = 양품 6.7초/개');
  assert.equal(B.whyOf({ cyc: 6, scrap: 0.1, reworkSec: 30, eff: 9.09 }),
    '공정 6초 · 불량 10% 재작업 30초 = 양품 9.1초/개');
  /* 불량이 0 이면 예전 문장 그대로 — 없는 것을 적지 않는다 */
  assert.equal(B.whyOf({ cyc: 6, eff: 6 }), '공정 6초/개');
});

/* ---------- 배선 ---------------------------------------------------------- */
const simSrc = await readSrc('core/sim.js');
const lineupSrc = await readSrc('core/lineup.js');
const balSrc = await readSrc('core/balance.js');
const repSrc = await readSrc('core/replicate.js');
const sceneSrc = await readSrc('scene/EditorScene.jsx');
const inspSrc = await readSrc('ui/Inspector.jsx');

t('굴리는 쪽이 불량과 재작업을 넘긴다', () => {
  assert.ok(lineupSrc.includes('scrapRate: p.scrapRate ?? 0'), '설비 목록이 불량률을 안 싣는다');
  /* 「이 설비가 다시 만든다」로 잡혀 있을 때만 재작업 시간이 산다 — 불량을
     내보내기로 바꿔 놓고도 재작업이 돌면 같은 불량을 두 번 처리한다 */
  assert.ok(lineupSrc.includes('reworkSec: scrapToOf(p, item) === SCRAP_TO.REDO ? reworkOf(p, item) : 0'),
    '재작업 시간을 안 싣는다');
  assert.ok(simSrc.includes('reworkSec: m.reworkSec'), 'sim 이 재작업을 안 넘긴다');
  assert.ok(simSrc.includes('onRedo: (n) => addRework(m.uid, n)'), '재작업 개수를 안 센다');
});

t('**거르는 자리는 한 곳뿐이다**', () => {
  /* 벨트 도착에도 남아 있으면 같은 불량률을 두 번 문다. 그리고 카트로 나르는
     설비는 벨트를 안 타므로 **불량이 아예 안 나온다** — 실제로 그랬다. */
  for (const src of [repSrc, sceneSrc]) assert.equal(/screen\(/.test(src), false, '도착 자리에서 또 거른다');
  assert.ok(simSrc.includes('screen(n, m.scrapRate, m.uid, rand)'), '만들 때 안 거른다');
});

t('천장이 불량과 재작업을 본다', () => {
  assert.ok(balSrc.includes('effectiveCycle(cyc, lot, setupSec, batch, { scrap, reworkSec })'),
    '천장이 불량을 안 친다');
  assert.ok(balSrc.includes('const reworkSec = reworkOf(p, item);'), '천장이 재작업을 안 읽는다');
});

t('화면이 재작업을 받고, **그 설비 것으로** 보여 준다', () => {
  assert.ok(inspSrc.includes('set({ reworkSec: v })'), '재작업 시간을 저장 안 한다');
  /* 불량률이 0 이면 고칠 것이 없다 — 칸이 뜨면 무슨 말인지 알 수가 없다 */
  assert.ok(inspSrc.includes('{scrap > 0 && ('), '불량이 없는 설비에도 재작업 칸이 뜬다');
  /* 라인 전체 합을 설비 한 대의 줄에 적으면 옆 설비의 불량을 뒤집어쓴 것처럼 보인다 */
  assert.ok(inspSrc.includes('const scrapped = scrappedOf(uid);'), '설비별 불량을 안 본다');
  assert.ok(inspSrc.includes('const redone = reworkedOf(uid);'), '설비별 재작업을 안 본다');
  assert.equal(/\{getScrapped\(\)\}개 불량/.test(inspSrc), false, '라인 전체 합을 설비 줄에 적는다');
});

/* ---------- 되돌리기가 물지 않아 다시 쓴 것 ------------------------------ */
t('재작업은 **로트를 안 채운다** — 같은 물건을 다시 만드는 것이다', () => {
  /* 앞의 검사는 첫 통과 개수만 봐서, 재작업이 로트를 채워도 안 물렸다.
     이번 로트에 몇 개 찼는지를 **직접** 본다(`lotMade`). */
  P.resetWork();
  let first = 0;
  for (let i = 0; i < 30; i++) {
    P.runMachine('LOT', 1, {
      cycleSec: 5, room: 9999, reworkSec: 1, lot: 999, setupSec: 60,
      pay: () => true,
      check: (n, again) => { if (!again) first += n; return again ? n : 0; },
      onRedo: () => {},
    });
  }
  assert.ok(first > 0, '아무것도 안 만들었다');
  assert.equal(P.lotMade('LOT'), first,
    `로트에 ${P.lotMade('LOT')}개가 찼는데 새로 만든 것은 ${first}개다 — 재작업이 로트를 채웠다`);
});

t('**불량품은 출력 자리를 안 먹는다** — 나가지도 않는데 자리를 잡으면 안 된다', () => {
  /* 자리를 두 개만 주고 전부 불량으로 만든다. 불량이 자리를 먹으면 설비가
     두 개 만들고 멈추고, 안 먹으면 시간이 다할 때까지 계속 돈다. */
  P.resetWork();
  let paid = 0;
  const n = P.runMachine('ROOM', 10, {
    cycleSec: 1, room: 2, reworkSec: 0,
    pay: () => { paid += 1; return true; },
    check: () => 0,                                  // 전부 불량
    onRedo: () => {},
  });
  assert.equal(n, 0, '전부 불량인데 양품이 나왔다');
  assert.ok(paid >= 9, `자리 2개에 막혀 ${paid}개에서 멈췄다 — 불량이 자리를 먹고 있다`);
});
