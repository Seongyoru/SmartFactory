/**
 * =============================================================================
 *  배치 공정 — **N개를 한 판에 굽는다** (오븐 · 도장 · 열처리)
 * =============================================================================
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **① 이미 그린 도면이 안 바뀐다.** 판이 1이면 예전과 값이 **똑같아야** 한다.
 *  **② 천장이 판 크기로 나뉜다.** 20개를 600초에 구우면 30초/개다 — 안 나누면
 *     계산이 스무 배 틀리고, 사람은 시뮬이 틀렸다고 여긴다.
 *  **③ 라인이 안 선다.** 「꽉 차야 굽는다」로 두면 앞이 느릴 때 영원히 안 돈다.
 *  **④ 계산과 실측이 만난다.** 처음 쟀을 때 천장의 5% 였다 — 벨트 간격과 출력
 *     자리가 판을 몰라서였다. 그 둘을 끝에서 끝까지 돌려 확인한다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';
import { itemOf, loadModels, specOf as specById } from './_models.mjs';

group('배치 공정');

const P = await import(SRC + 'core/process.js');
const B = await import(SRC + 'core/balance.js');
const St = await import(SRC + 'core/simStore.js');
const Lu = await import(SRC + 'core/lineup.js');
const R = await import(SRC + 'core/replicate.js');
const H = await import(SRC + 'core/halt.js');
const A = await import(SRC + 'core/area.js');
const LIB = await import(SRC + 'data/library.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

/* ---------- 값 읽기 ------------------------------------------------------- */
t('판 크기는 **자리에 적은 값**이 라이브러리를 이긴다', () => {
  assert.equal(P.batchOf({ batchSize: 20 }, { batchSize: 5 }), 20);
  assert.equal(P.batchOf({}, { batchSize: 5 }), 5);
  assert.equal(P.batchOf({}, {}), 1, '기본이 1이 아니면 이미 그린 도면이 바뀐다');
  assert.equal(P.batchOf({ batchSize: 0 }, {}), 1, '0 은 판이 없는 것이 아니라 한 개씩이다');
  assert.equal(P.batchWaitOf({}, {}), 0, '기본이 0이 아니면 안 기다리던 도면이 기다린다');
});

/* ---------- 개당 시간 ----------------------------------------------------- */
t('**공정 시간은 한 판에 드는 시간이다**', () => {
  near(P.effectiveCycle(600, 0, 0, 20), 30);          // 600초 ÷ 20개
  near(P.effectiveCycle(600, 0, 0, 1), 600);          // 판이 1이면 그대로
  near(P.effectiveCycle(6, 0, 0), 6);                 // 안 넘기면 예전 그대로
});

t('전환은 **개수로** 세므로 판 크기로 안 나눈다', () => {
  /* 20개마다 300초 전환 · 한 판 10개 · 공정 60초 → 6 + 15 = 21초/개 */
  near(P.effectiveCycle(60, 20, 300, 10), 21);
});

t('출력 자리는 **판 두 개분 + 한 덩어리**', () => {
  /* 한 판치만 두면 다 굽고도 앞판이 빠질 때까지 서 있는다(실측 천장의 5%) */
  assert.equal(P.outputCapFor(3, 20), 43);
  assert.equal(P.outputCapFor(3, 5), 13);
  /* 판이 1이면 예전 값 그대로 — 덩어리 + 한 개 */
  assert.equal(P.outputCapFor(3), 4);
  assert.equal(P.outputCapFor(3, 1), 4);
  assert.equal(P.outputCapFor(8), 9);
});

/* ---------- 판을 언제 거나 ------------------------------------------------ */
t('판이 차면 건다 · 재료가 없으면 못 건다', () => {
  P.resetWork();
  assert.equal(P.trayOf('M', 20, 20, 0), 20);
  assert.equal(P.trayOf('M', 25, 20, 0), 20, '판보다 많이 얹었다');
  assert.equal(P.trayOf('M', 0, 20, 0), 0);
});

t('**안 기다리면 있는 만큼** 굽는다 — 그래서 라인이 안 선다', () => {
  P.resetWork();
  /* 「꽉 차야 굽는다」로 두면 앞이 느릴 때 영원히 안 돈다 */
  assert.equal(P.trayOf('M', 7, 20, 0), 7);
});

t('기다림 한도 안에서는 **모으고**, 넘기면 있는 것만 굽는다', () => {
  P.resetWork();
  assert.equal(P.trayOf('W', 7, 20, 60), 0, '한도 안인데 벌써 구웠다');
  /* 70초를 흘려 보낸다 — 재료가 모자란 채로라 전부 기다림이 된다 */
  P.runMachine('W', 70, { cycleSec: 10, batch: 20, waitSec: 60, room: 99, avail: () => 7, pay: () => true });
  assert.ok(P.batchWaited('W') >= 60, `기다린 시간을 안 센다 (${P.batchWaited('W')})`);
  assert.equal(P.trayOf('W', 7, 20, 60), 7, '한도를 넘겼는데 안 굽는다');
});

t('판을 걸면 **기다린 시간이 0으로** 돌아간다', () => {
  P.resetWork();
  P.runMachine('Z', 70, { cycleSec: 10, batch: 20, waitSec: 60, room: 99, avail: () => 7, pay: () => true });
  assert.ok(P.batchWaited('Z') > 0);
  P.runMachine('Z', 1, { cycleSec: 10, batch: 20, waitSec: 60, room: 99, avail: () => 20, pay: () => true });
  assert.equal(P.batchWaited('Z'), 0, '판을 걸고도 기다린 시간이 남아 있다');
});

/* ---------- 굴려 본다 ----------------------------------------------------- */
const drive = (opt, ticks = 200, dt = 1) => {
  P.resetWork();
  let stock = 0, made = 0, paid = 0;
  const fires = [];
  for (let i = 0; i < ticks; i++) {
    stock += opt.feed ?? 5;
    const n = P.runMachine('B', dt, {
      cycleSec: opt.cycleSec, batch: opt.batch, waitSec: opt.waitSec ?? 0,
      room: (opt.room ?? 999) - made,
      avail: () => stock,
      pay: (k) => { if (stock < k) return false; stock -= k; paid += k; return true; },
    });
    if (n > 0) fires.push({ t: (i + 1) * dt, n });
    made += n;
    made = Math.max(0, made - (opt.drain ?? 999));
  }
  return { fires, made, paid };
};

t('**한 판이 통째로** 나온다 — 절반만 꺼낼 수 없다', () => {
  const r = drive({ cycleSec: 10, batch: 20, feed: 5 }, 40);
  const full = r.fires.filter((f) => f.n === 20);
  assert.ok(full.length >= 2, `꽉 찬 판이 안 나온다: ${JSON.stringify(r.fires)}`);
  for (const f of r.fires) assert.ok(f.n <= 20, `판보다 많이 냈다 (${f.n})`);
});

t('**재료는 판 크기만큼 한꺼번에** 낸다', () => {
  const r = drive({ cycleSec: 10, batch: 20, feed: 5 }, 40);
  const out = r.fires.reduce((s, f) => s + f.n, 0);
  assert.equal(r.paid, out, `낸 재료(${r.paid})와 만든 개수(${out})가 안 맞는다`);
});

t('판이 1이면 **한 개씩 돌던 그대로**', () => {
  const one = drive({ cycleSec: 10, batch: 1, feed: 5 }, 100);
  P.resetWork();
  let stock = 0, n = 0;
  for (let i = 0; i < 100; i++) {
    stock += 5;
    n += P.runMachine('O', 1, {
      cycleSec: 10, room: 999,
      pay: () => { if (stock < 1) return false; stock--; return true; },
    });
  }
  assert.equal(one.fires.reduce((s, f) => s + f.n, 0), n, '판 1이 옛 동작과 다르다');
});

/* ---------- 굶음 판정 ----------------------------------------------------- */
const haltSrc = await readSrc('core/halt.js');
t('굶음은 **굽는 쪽과 같은 함수**를 본다', () => {
  /* 두 곳이 각자 판단하면 굽고 있는 설비를 굶었다고 빨갛게 칠한다 */
  assert.ok(haltSrc.includes('trayOf(p.uid, have, batchOf(p, item), batchWaitOf(p, item))'), '따로 판단한다');
});

t('판을 채우며 기다리면 **굶음으로 센다**', () => {
  P.resetWork();
  St.clearStock();
  const placed = [{
    uid: 'OV', itemId: 'MACHINE_2', batchSize: 20, batchWaitSec: 300,
    recipe: { in: [{ kind: 'PART_R', qty: 1 }], out: 'ASM_C' },
  }];
  St.addLots('OV', ['PART_R', 'PART_R', 'PART_R']);          // 20개에 한참 모자란다
  const d = { placed, itemOf, machines: [], beltFlows: [] };
  assert.ok(H.haltState(d).starved.has('OV'), '모으는 중인데 안 센다');
  /* 판이 차면 안 굶는다 */
  St.addLots('OV', new Array(20).fill('PART_R'));
  assert.equal(H.haltState(d).starved.has('OV'), false, '판이 찼는데 굶었다고 한다');
});

t('안 기다리는 설비는 **한 개만 있어도** 안 굶는다', () => {
  P.resetWork();
  St.clearStock();
  const placed = [{
    uid: 'OV', itemId: 'MACHINE_2', batchSize: 20, batchWaitSec: 0,
    recipe: { in: [{ kind: 'PART_R', qty: 1 }], out: 'ASM_C' },
  }];
  St.addLots('OV', ['PART_R']);
  assert.equal(H.haltState({ placed, itemOf, machines: [], beltFlows: [] }).starved.has('OV'), false);
});

/* ---------- 천장이 뭐라고 적나 -------------------------------------------- */
t('화면이 **왜 이 속도인지** 적는다', () => {
  assert.equal(B.whyOf({ cyc: 6, eff: 6 }), '공정 6초/개');
  assert.equal(B.whyOf({ cyc: 600, batch: 20, eff: 30 }), '공정 600초 · 한 판에 20개 = 30.0초/개');
  assert.equal(B.whyOf({ cyc: 2, many: 2, eff: 3.5 }), '공정 2초 · 품종 2가지를 번갈아 = 한 품종에 7.0초/개');
  assert.equal(B.whyOf({ cyc: 6, lot: 20, setupSec: 300, eff: 21 }), '공정 6초 · 전환 300초/20개 = 21.0초/개');
  /* 겹쳐도 한 줄로 읽힌다 — 경우를 나눠 쓰면 조합이 여덟 가지다 */
  assert.equal(B.whyOf({ cyc: 60, batch: 10, lot: 20, setupSec: 300, eff: 21 }),
    '공정 60초 · 한 판에 10개 · 전환 300초/20개 = 21.0초/개');
});

/* ---------- 끝에서 끝까지 ------------------------------------------------- */
await loadModels(['MACHINE_1', 'MACHINE_2', 'STILLAGE', 'CONVEYOR']);
const idByKey = new Map(LIB.BUILTIN_LIBRARY.filter((x) => x.modelKey).map((x) => [x.modelKey, x.id]));
const specOf = (it) => (it?.modelKey ? specById(idByKey.get(it.modelKey) ?? '') : null);
const areas = [{ uid: 'F', mp: A.rectMP([-20, -20], [20, 20]) }];
const links = [
  { uid: 'C1', itemId: 'CONVEYOR', from: { uid: 'P1', portId: 'PORT_OUT@Z-' }, to: { uid: 'OV' }, radius: 0.5, layer: 0, width: 1 },
  { uid: 'C2', itemId: 'CONVEYOR', from: { uid: 'OV', portId: 'PORT_OUT@Z-' }, to: { uid: 'S1' }, radius: 0.5, layer: 0, width: 1 },
];
const line = (batch, cycle, waitSec = 0) => [
  {
    uid: 'P1', name: '제작기', itemId: 'MACHINE_1', pos: [-6, 9], rot: 0, outputCount: 3, cycleSec: 2,
    recipe: { in: [], out: 'PART_R' },
  },
  {
    uid: 'OV', name: '오븐', itemId: 'MACHINE_2', pos: [-6, 3], rot: 0, outputCount: 3, cycleSec: cycle,
    batchSize: batch, batchWaitSec: waitSec, inputCap: 60,
    recipe: { in: [{ kind: 'PART_R', qty: 1 }], out: 'ASM_C' },
  },
  { uid: 'S1', name: '적치대', itemId: 'STILLAGE', pos: [-6, -3], rot: 0, capacity: 200 },
];
/** 오븐이 낸 것 — 적치대에 닿은 것 + 아직 출력 자리에 있는 것 */
const at = (batch, cycle, waitSec, sec) => {
  St.clearStock();
  const placed = line(batch, cycle, waitSec);
  const w = Lu.worldOf({
    placed, links, carts: [], areas, walls: [], openings: [], shifts: [], beltSpeed: 0.6, itemOf, specOf,
  });
  R.runOnce({ seconds: sec, world: w.world, flow: w.flow, pick: () => 0 });
  return { n: St.getLots('S1').length + St.getMade('OV'), ceil: w.capacity * 60 };
};
/** 정상 상태 — 예열 600초를 빼고 잰다 (첫 판이 모이는 동안은 비어 있다) */
const steady = (batch, cycle, waitSec = 0) => {
  const a = at(batch, cycle, waitSec, 600), b = at(batch, cycle, waitSec, 2400);
  return { perHour: (b.n - a.n) * 2, ceil: b.ceil };
};

t('**천장과 실측이 만난다** — 처음 쟀을 때는 5% 였다', () => {
  /* 벨트 간격과 출력 자리가 판을 모르면 여기서 걸린다. 갈리면 사람이 시뮬을
     안 믿는다 — 이 검사가 이 기능의 값 자체다. */
  for (const [batch, cycle, wait] of [[1, 12, 0], [5, 60, 0], [10, 120, 0], [20, 240, 0], [20, 240, 120]]) {
    const r = steady(batch, cycle, wait);
    assert.ok(r.perHour <= r.ceil + 1, `천장 ${r.ceil.toFixed(0)} 을 넘었다 (${r.perHour.toFixed(0)})`);
    assert.ok(r.perHour > r.ceil * 0.9,
      `한 판 ${batch}개 · ${cycle}초: 천장 ${r.ceil.toFixed(0)} 인데 ${r.perHour.toFixed(0)} 밖에 안 나온다`);
  }
});

t('**판을 키우면 개당이 싸진다** — 같은 공정 시간에서', () => {
  const one = steady(1, 240, 0);
  const many = steady(20, 240, 0);
  assert.ok(many.ceil > one.ceil * 15, `판을 20배로 키웠는데 천장이 ${(many.ceil / one.ceil).toFixed(1)}배다`);
  assert.ok(many.perHour > one.perHour * 15, '실제 처리량이 안 늘었다');
});

t('**꽉 차야 굽는 설비라도 라인이 안 선다**', () => {
  /* 앞이 느려 판이 영영 안 모이면 오븐이 영원히 안 돈다 — 한도가 그것을 막는다 */
  const r = at(50, 60, 30, 1200);
  assert.ok(r.n > 0, '판이 안 차서 라인이 통째로 섰다');
});

/* ---------- 배선 ---------------------------------------------------------- */
const lineupSrc = await readSrc('core/lineup.js');
const simSrc = await readSrc('core/sim.js');
const balSrc = await readSrc('core/balance.js');
const inspSrc = await readSrc('ui/Inspector.jsx');

t('굴리는 쪽이 판을 넘긴다', () => {
  assert.ok(lineupSrc.includes('batch: batchOf(p, item)'), '설비 목록이 판을 안 싣는다');
  assert.ok(lineupSrc.includes('waitSec: batchWaitOf(p, item)'), '기다림 한도를 안 싣는다');
  assert.ok(lineupSrc.includes('outputCapFor(p.outputCount ?? 3, batchOf(p, item))'), '출력 자리가 판을 모른다');
  assert.ok(simSrc.includes('batch: m.batch'), 'sim 이 판을 안 넘긴다');
  assert.ok(simSrc.includes('waitSec: m.waitSec'), 'sim 이 기다림 한도를 안 넘긴다');
  assert.ok(simSrc.includes('scaleNeed(need, n)'), '재료를 판만큼 안 낸다');
});

t('**벨트 간격은 개당 시간을 본다** — 여기가 5% 사건의 자리다', () => {
  assert.ok(lineupSrc.includes('spacingFor(unitCycleOf('), '벨트 간격이 한 판 시간을 쓴다');
  assert.ok(balSrc.includes('spacingFor(unitCycleOf('), '천장 쪽 벨트가 한 판 시간을 쓴다');
  assert.ok(inspSrc.includes('spacingFor(unitCycle, bundle, beltV)'), '화면이 한 판 시간을 쓴다');
});

t('천장이 판을 본다', () => {
  assert.ok(balSrc.includes('effectiveCycle(cyc, lot, setupSec, batch)'), '천장이 판을 안 나눈다');
});

t('화면이 판과 기다림을 받는다', () => {
  assert.ok(inspSrc.includes('patch: { batchSize: v }'), '판 크기를 저장 안 한다');
  assert.ok(inspSrc.includes('patch: { batchWaitSec: v }'), '기다림 한도를 저장 안 한다');
  /* 기다림 한도는 **판이 여럿일 때만** 뜬다 — 한 개씩 만드는 설비에 「덜 차면
     기다리기」가 뜨면 무슨 말인지 알 수가 없다 */
  assert.ok(inspSrc.includes('{batch > 1 && ('), '한 개짜리 설비에도 기다림 칸이 뜬다');
  /* 공정 시간의 이름이 **판 크기를 따라간다** */
  const name = (attr, batch) => {
    const expr = cut(inspSrc, attr, '}', '이름 짓는 식')
      .replace(/^label=\{/, '').replace(/\}$/, '');
    return new Function('batch', `return (${expr});`)(batch);
  };
  const LABEL = "label={batch > 1 ? '만드는 시간 (한 판)'";
  assert.equal(name(LABEL, 1), '만드는 시간');
  assert.equal(name(LABEL, 20), '만드는 시간 (한 판)');
});

t('입력 버퍼는 **한 판**을 담을 만한지 본다', () => {
  /* 덩어리(3개)로 재면 20개 판을 먹는 오븐의 버퍼가 한참 모자란데도 아무 말이
     없다 — 조용히 굶는 라인이 된다 */
  assert.ok(inspSrc.includes('const tray = batchOf(placed, item);'), '버퍼가 판을 모른다');
  assert.ok(inspSrc.includes('Math.max(Math.max(1, placed.outputCount ?? 3), tray)'), '덩어리로만 잰다');
});

/* ---------- 되돌리기 테스트가 물지 않아 뒤늦게 붙인 것 -------------------- */
t('**낼 자리가 없으면 판을 안 건다** — 구워 놓고 못 내리면 사라진다', () => {
  P.resetWork();
  let paid = 0;
  const n = P.runMachine('R', 100, {
    cycleSec: 10, batch: 20, room: 5,          // 판 20개 · 자리는 5개뿐
    avail: () => 99,
    pay: (k) => { paid += k; return true; },
  });
  assert.equal(n, 0, `자리가 5개뿐인데 ${n}개를 냈다`);
  assert.equal(paid, 0, '못 낼 판의 재료를 미리 먹었다');
});

t('로트는 **판이 낸 개수만큼** 찬다 — 한 판을 하나로 세지 않는다', () => {
  /* 한 판 10개 · 로트 20개면 **두 판**에 한 번 전환이다. 판을 하나로 세면
     스무 판(200개)마다 한 번이 되어 전환 손실이 열 배 작게 나온다 */
  P.resetWork();
  const fire = () => P.runMachine('L', 15, {
    cycleSec: 10, batch: 10, lot: 20, setupSec: 100, room: 999,
    avail: () => 99, pay: () => true,
  });
  fire();                                       // 10개
  assert.equal(P.inSetup('L'), false, '첫 판에 벌써 전환에 들어갔다');
  fire();                                       // 20개 — 로트를 채웠다
  assert.ok(P.inSetup('L'), '두 판을 냈는데 전환을 안 문다');
});
