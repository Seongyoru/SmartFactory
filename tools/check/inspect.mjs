/**
 * =============================================================================
 *  검사 라우팅 — **불량품이 다른 길로 흐른다**
 * =============================================================================
 *  불량이 하나의 종류(`SCRAP`)가 되면 그 뒤는 **이미 있는 것들이 다 한다.**
 *  갈래(`link.kinds`)로 다른 벨트에 태우고, 그 끝에 「불량품을 먹어 제작품을
 *  내는」 설비를 놓으면 그것이 재작업 스테이션이다.
 *
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **① 이미 그린 도면이 안 바뀐다.** 기본은 버림이고, 불량품은 한 개도 안 나온다.
 *  **② 불량품은 만들 수 없다.** 산출물 목록에 두면 「불량을 만드는 설비」라는
 *     말이 안 되는 도면을 그릴 수 있게 된다. 재료로만 고를 수 있다.
 *  **③ 안 빼내면 막힌다.** 라인 밖으로 사라지지 않으니 자리를 먹는 것이 맞다.
 *  **④ 되살린 것이 실제로 돌아온다.** 재작업 설비를 거쳐 양품으로 나와야 한다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';
import { itemOf, loadModels, specOf as specById } from './_models.mjs';

group('검사 라우팅');

const P = await import(SRC + 'core/process.js');
const St = await import(SRC + 'core/simStore.js');
const Lu = await import(SRC + 'core/lineup.js');
const R = await import(SRC + 'core/replicate.js');
const A = await import(SRC + 'core/area.js');
const LIB = await import(SRC + 'data/library.js');

/* ---------- 값 읽기 ------------------------------------------------------- */
t('불량 처리는 **기본이 버림** — 이미 그린 도면은 안 바뀐다', () => {
  assert.equal(P.scrapToOf({}, {}), P.SCRAP_TO.TOSS);
  assert.equal(P.scrapToOf({ scrapTo: 'out' }, {}), P.SCRAP_TO.OUT);
  assert.equal(P.scrapToOf({ scrapTo: 'redo' }, {}), P.SCRAP_TO.REDO);
  /* 손으로 고친 도면에 없는 값이 적혀 있으면 버림 */
  assert.equal(P.scrapToOf({ scrapTo: 'burn' }, {}), P.SCRAP_TO.TOSS);
});

t('**재작업만 붙여 뒀던 도면**은 재작업으로 읽는다', () => {
  /* `scrapTo` 가 생기기 전에 그린 도면에는 `reworkSec` 만 있다. 버림으로 읽으면
     그 도면들이 어느 날 갑자기 불량을 다 버리게 된다 */
  assert.equal(P.scrapToOf({ reworkSec: 30 }, {}), P.SCRAP_TO.REDO);
  assert.equal(P.scrapToOf({ reworkSec: 0 }, {}), P.SCRAP_TO.TOSS);
});

/* ---------- 굴려 본다 ----------------------------------------------------- */
t('**내보내면 불량품으로 쌓인다**', () => {
  P.resetWork();
  St.clearStock();
  let out = 0;
  P.runMachine('M', 20, {
    cycleSec: 1, room: 50,
    pay: () => true,
    check: () => 0,                                   // 전부 불량
    onScrap: (n) => { out += n; St.addMade('M', n, 'SCRAP'); return n; },
  });
  assert.ok(out > 0, '불량을 안 내보냈다');
  assert.deepEqual([...new Set(St.getMadeLots('M'))], ['SCRAP']);
});

t('**자리를 먹는다** — 안 빼내면 막힌다', () => {
  /* 라인 밖으로 사라지지 않으니 자리를 먹는 것이 맞다. 안 먹으면 갈래로 못 빼낸
     불량이 무한히 쌓여도 라인이 안 서는 거짓 그림이 된다 */
  P.resetWork();
  let paid = 0;
  const n = P.runMachine('R', 20, {
    cycleSec: 1, room: 3,
    pay: () => { paid += 1; return true; },
    check: () => 0,
    onScrap: (k) => k,                                // 다 자리를 먹는다
  });
  assert.equal(n, 0, '전부 불량인데 양품이 나왔다');
  assert.ok(paid <= 4, `자리 3개가 찼는데 ${paid}개나 만들었다 — 불량이 자리를 안 먹는다`);
});

t('내보내기가 아니면 **자리를 안 먹는다** — 버리는 것이니까', () => {
  P.resetWork();
  let paid = 0;
  P.runMachine('T', 20, {
    cycleSec: 1, room: 3,
    pay: () => { paid += 1; return true; },
    check: () => 0,
    onScrap: null,                                    // 버림
  });
  assert.ok(paid >= 18, `버리는데 ${paid}개에서 멈췄다`);
});

/* ---------- 끝에서 끝까지 ------------------------------------------------- */
await loadModels(['MACHINE_1', 'MACHINE_2', 'STILLAGE', 'CONVEYOR']);
const idByKey = new Map(LIB.BUILTIN_LIBRARY.filter((x) => x.modelKey).map((x) => [x.modelKey, x.id]));
const specOf = (it) => (it?.modelKey ? specById(idByKey.get(it.modelKey) ?? '') : null);
const areas = [{ uid: 'F', mp: A.rectMP([-25, -25], [25, 25]) }];

/**
 * 검사 라우팅 한 벌.
 *  제작기 → (양품) 벨트 A → 적치대 A
 *         → (불량품) 벨트 B → 재작업 설비 → 벨트 C → 적치대 A
 */
const placed = [
  {
    uid: 'P1', name: '제작기', itemId: 'MACHINE_1', pos: [-8, 10], rot: 0, outputCount: 3, cycleSec: 2,
    scrapRate: 0.3, scrapTo: 'out', recipe: { in: [], out: 'PART_R' },
  },
  {
    uid: 'RW', name: '재작업', itemId: 'MACHINE_2', pos: [6, 4], rot: 0, outputCount: 3, cycleSec: 3,
    inputCap: 40, recipe: { in: [{ kind: 'SCRAP', qty: 1 }], out: 'ASM_C' },
  },
  { uid: 'SA', name: '적치대 A', itemId: 'STILLAGE', pos: [-8, 0], rot: 0, capacity: 200 },
  { uid: 'SB', name: '적치대 B', itemId: 'STILLAGE', pos: [6, -4], rot: 0, capacity: 200 },
];
const links = [
  {
    uid: 'CA', itemId: 'CONVEYOR', from: { uid: 'P1', portId: 'PORT_OUT@Z-' }, to: { uid: 'SA' },
    radius: 0.5, layer: 0, width: 1, kinds: ['PART_R'],
  },
  {
    uid: 'CB', itemId: 'CONVEYOR', from: { uid: 'P1', portId: 'PORT_OUT@Z-' }, to: { uid: 'RW' },
    radius: 0.5, layer: 1, width: 1, kinds: ['SCRAP'],
  },
  {
    uid: 'CC', itemId: 'CONVEYOR', from: { uid: 'RW', portId: 'PORT_OUT@Z-' }, to: { uid: 'SB' },
    radius: 0.5, layer: 0, width: 1,
  },
];
const run = (sec = 400) => {
  St.clearStock();
  const w = Lu.worldOf({
    placed, links, carts: [], areas, walls: [], openings: [], shifts: [], beltSpeed: 0.6, itemOf, specOf,
  });
  R.runOnce({ seconds: sec, world: w.world, flow: w.flow, pick: () => 0, rand: R.seeded(11) });
  const tally = (uid) => {
    const out = {};
    for (const k of St.getLots(uid)) out[k] = (out[k] ?? 0) + 1;
    return out;
  };
  return { A: tally('SA'), B: tally('SB'), redoStock: St.getLots('RW').length };
};

t('**불량품이 다른 길로 흐른다** — 검사 라우팅', () => {
  const r = run();
  assert.ok((r.A.PART_R ?? 0) > 0, `양품이 적치대 A 로 안 갔다 ${JSON.stringify(r.A)}`);
  assert.equal(r.A.SCRAP ?? 0, 0, '양품 길에 불량품이 섞였다');
});

t('**되살린 것이 실제로 돌아온다** — 재작업 스테이션', () => {
  const r = run();
  assert.ok((r.B.ASM_C ?? 0) > 0,
    `재작업 설비가 아무것도 못 냈다 ${JSON.stringify(r.B)} (재작업 재고 ${r.redoStock})`);
});

t('불량품이 **재작업 설비까지 닿는다**', () => {
  const r = run(120);
  /* 짧게 돌리면 아직 처리 중인 것이 버퍼에 남아 있다 — 그것이 곧 「닿았다」 */
  assert.ok(r.redoStock > 0 || (r.B.ASM_C ?? 0) > 0, '불량품이 재작업 설비로 안 갔다');
});

t('불량을 **버리는 도면**에서는 불량품이 한 개도 안 나온다', () => {
  St.clearStock();
  const toss = placed.map((p) => (p.uid === 'P1' ? { ...p, scrapTo: 'toss' } : p));
  const w = Lu.worldOf({
    placed: toss, links, carts: [], areas, walls: [], openings: [], shifts: [], beltSpeed: 0.6, itemOf, specOf,
  });
  R.runOnce({ seconds: 400, world: w.world, flow: w.flow, pick: () => 0, rand: R.seeded(11) });
  assert.equal(St.getLots('RW').length, 0, '버리기로 했는데 불량품이 흘렀다');
  assert.equal(St.getLots('SB').length, 0, '버리기로 했는데 재작업 설비가 돌았다');
  assert.ok(St.getLots('SA').length > 0, '양품까지 안 나온다');
});

/* ---------- 배선 ---------------------------------------------------------- */
const lineupSrc = await readSrc('core/lineup.js');
const simSrc = await readSrc('core/sim.js');
const inspSrc = await readSrc('ui/Inspector.jsx');

t('굴리는 쪽이 불량 처리를 넘긴다', () => {
  assert.ok(lineupSrc.includes('scrapTo: scrapToOf(p, item)'), '설비 목록이 불량 처리를 안 싣는다');
  assert.ok(simSrc.includes("m.scrapTo === SCRAP_TO.OUT"), 'sim 이 내보내기를 모른다');
  assert.ok(simSrc.includes('SCRAP_KIND'), '불량품 종류를 안 쓴다');
});

t('**재작업과 내보내기가 겹치지 않는다**', () => {
  /* 둘 다 돌면 같은 불량을 두 번 처리한다 */
  assert.ok(lineupSrc.includes('scrapToOf(p, item) === SCRAP_TO.REDO ? reworkOf(p, item) : 0'),
    '내보내기로 잡아 놓고도 재작업이 돈다');
});

t('화면이 불량 처리를 받고, **불량이 있을 때만** 보여 준다', () => {
  assert.ok(inspSrc.includes("set({ scrapTo: e.target.value })"), '불량 처리를 저장 안 한다');
  assert.ok(inspSrc.includes('{scrap > 0 && ('), '불량이 없는 설비에도 칸이 뜬다');
  /* 「안 빼내면 막힌다」를 안 적으면 왜 설비가 서는지 아무도 모른다 */
  assert.ok(inspSrc.includes('빼내지 않으면 출력 자리가 차서 이 설비가 막힙니다'),
    '막히는 이유를 안 말한다');
});
