/**
 * core/halt.js — 「누가 서 있는가」.
 *  이것이 라인 전체의 정지·전파를 정한다. 잘못되면 화면은 멀쩡해 보이는데
 *  라인만 안 돈다(또는 교착) — 값으로 확인해야 하는 자리다.
 */
import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

group('정지 판정');

const bom = await import(SRC + 'core/bom.js');
const lib = await import(SRC + 'data/library.js');

const H = await import(SRC + 'core/halt.js');
const SS = await import(SRC + 'core/simStore.js');
/* 배선 두 건은 여전히 화면 소스를 본다 — 판정을 만들어 놓고 안 이어 주는 실수는 값으로 안 잡힌다 */
const src = await readSrc('scene/EditorScene.jsx');

const NOCREW = { manned: new Set(), unmanned: new Set() };

/* ---- 도면 한 벌 ------------------------------------------------------------
     A(공급원 OBJ) ──L1──▶ C(조립: OBJ×2 + OBJ2×1 → OBJ3) ──L3──▶ S(적치대)
     B(공급원 OBJ2) ─L2──▶ C
--------------------------------------------------------------------------- */
const ITEMS = {
  M: { id: 'M', makes: 'PART' },
  M2: { id: 'M2', makes: 'PART' },
  ST: { id: 'ST', kind: 'stillage' },
};
const itemOf = (id) => ITEMS[id] ?? null;
const isShelf = lib.isShelf;
const isStillage = lib.isStillage;

const A = { uid: 'A', itemId: 'M', outputCount: 3, recipe: { in: [], out: 'PART_R' } };
const B = { uid: 'B', itemId: 'M2', outputCount: 3, recipe: { in: [], out: 'PART_G' } };
const C = {
  uid: 'C', itemId: 'M', outputCount: 3, inputCap: 30,
  recipe: { in: [{ kind: 'PART_R', qty: 2 }, { kind: 'PART_G', qty: 1 }], out: 'ASM_C' },
};
const S = { uid: 'S', itemId: 'ST' };
const placed = [A, B, C, S];

const flow = (uid, owner, to, cap) => ({
  link: { uid, to: { uid: to } },
  owner,
  sink: cap == null ? null : { uid: to, cap },
});
const beltFlows = [
  flow('L1', A, 'C', 30),
  flow('L2', B, 'C', 30),
  flow('L3', C, 'S', 12),
];

/* SimClock 이 훑는 목록 — 여기서는 출력 자리(cap)만 쓴다 */
const machines = [A, B, C].map((p) => ({ uid: p.uid, cap: p.outputCount }));

/**
 * **진짜 스토어에 담고 부른다.**
 *  예전에는 소스를 떼어 `new Function` 에 넣고 재고 읽는 함수를 흉내 냈다.
 *  규칙이 `core/halt.js` 로 나온 지금은 그냥 부르면 되고, 흉내를 안 내니
 *  **실제로 쓰이는 그 경로**를 확인하게 된다.
 */
const call = ({ stock = {}, lots = {}, down = {}, made = {}, crew = NOCREW } = {}) => {
  SS.clearStock();
  for (const [uid, kinds] of Object.entries(lots)) SS.addLots(uid, kinds, Infinity);
  for (const [uid, n] of Object.entries(stock)) if (!lots[uid]) SS.setStock(uid, n);
  for (const [uid, n] of Object.entries(made)) SS.addMade(uid, n);
  return H.haltState({ beltFlows, machines, placed, itemOf, downMap: down, crew });
};

const fill = (kind, k) => Array.from({ length: k }, () => kind);

/* ---------- 굶음 ---------- */
t('재료가 없으면 조립 설비가 굶고, 그 유출 벨트가 **마른다**', () => {
  const h = call();
  assert.ok(h.starved.has('C'));
  assert.ok(h.equips.has('C'));
  assert.ok(h.dry.has('L3'), '새 자재가 안 올라타야 한다');
  assert.equal(h.links.has('L3'), false, '벨트를 세우면 위에 있던 물건이 얼어붙는다');
});
t('굶음은 **상류로 번지지 않는다** — 재료를 실어 올 벨트를 세우면 교착이다', () => {
  const h = call();
  assert.equal(h.links.has('L1'), false, 'C 로 들어가는 벨트가 섰다 = 교착');
  assert.equal(h.links.has('L2'), false);
  assert.equal(h.dry.has('L1'), false, 'A 는 공급원이라 마를 이유가 없다');
  assert.equal(h.equips.has('A'), false);
  assert.equal(h.equips.has('B'), false);
  assert.equal(h.jammed.has('C'), false);
});
t('한 덩어리치(3층 = OBJ 6 + OBJ2 3)가 차면 굶음이 풀린다', () => {
  const lots = { C: [...fill('PART_R', 6), ...fill('PART_G', 3)] };
  const h = call({ lots });
  assert.equal(h.starved.has('C'), false);
  assert.equal(h.links.has('L3'), false);
  assert.equal(h.dry.has('L3'), false);
});
t('한 덩어리치가 안 돼도 **한 개분**만 있으면 안 굶는다', () => {
  /* 공정 시간이 생기기 전에는 한 덩어리(3개)를 못 만들면 굶은 것으로 봤다.
     지금은 설비가 한 개씩 만들어 출력 자리에 쌓으므로 한 개분이면 일을 한다 —
     예전에는 두 개 만들 재료를 쥐고도 멀쩡히 놀았다. */
  const lots = { C: [...fill('PART_R', 4), ...fill('PART_G', 2)] };   // 두 개분
  assert.equal(call({ lots }).starved.has('C'), false);
});
t('한 개분도 안 되면 굶는다', () => {
  const lots = { C: [...fill('PART_R', 1), ...fill('PART_G', 5)] };   // R 이 하나 모자라다
  assert.ok(call({ lots }).starved.has('C'));
});
t('만들어 놓은 것이 출력 자리를 채우면 그 설비가 선다', () => {
  const lots = { C: [...fill('PART_R', 6), ...fill('PART_G', 3)] };   // 재료는 넉넉하다
  const h = call({ lots, made: { C: 3 } });                           // 출력 자리 = outputCount 3
  assert.ok(h.equips.has('C'), '만들어 놨는데 아무도 안 가져가면 서야 한다');
  assert.equal(h.starved.has('C'), false);
  assert.equal(h.jammed.has('C'), false, '상류로 번지면 안 된다 — 받기는 받는다');
  assert.equal(h.links.has('L1'), false, 'C 로 들어오는 벨트가 섰다');
});
t('출력 자리에 빈칸이 있으면 안 선다', () => {
  const lots = { C: [...fill('PART_R', 6), ...fill('PART_G', 3)] };
  const h = call({ lots, made: { C: 2 } });
  assert.equal(h.equips.has('C'), false);
});
t('공급원은 절대 굶지 않는다', () => {
  const h = call();
  assert.equal(h.starved.has('A'), false);
  assert.equal(h.starved.has('B'), false);
});
t('적치대는 굶음 판정 대상이 아니다', () => {
  assert.equal(call().starved.has('S'), false);
});

/* ---------- 막힘과 상류 전파 ---------- */
t('적치대가 차면 C 가 막히고 상류가 줄줄이 선다', () => {
  const lots = { C: [...fill('PART_R', 60), ...fill('PART_G', 60)] };   // C 는 안 굶는다
  const h = call({ stock: { S: 12 }, lots });
  assert.ok(h.links.has('L3'), 'L3 이 서야 한다');
  assert.ok(h.jammed.has('C'));
  // C 가 못 받으니 C 로 들어오던 벨트도 서고, 그 앞 설비도 선다
  assert.ok(h.links.has('L1'));
  assert.ok(h.links.has('L2'));
  assert.ok(h.equips.has('A'));
  assert.ok(h.equips.has('B'));
});
t('C 의 입력 버퍼가 차면 들어오는 벨트가 서고 A·B 가 선다', () => {
  const lots = { C: [...fill('PART_R', 20), ...fill('PART_G', 10)] };   // 30 = inputCap
  const h = call({ lots });
  assert.equal(h.starved.has('C'), false);                        // 재료는 넘친다
  assert.ok(h.links.has('L1'));
  assert.ok(h.links.has('L2'));
  assert.ok(h.jammed.has('A'));
  assert.ok(h.jammed.has('B'));
  assert.equal(h.links.has('L3'), false, 'C 는 계속 내보낼 수 있어야 한다');
});

/* ---------- 고장 ---------- */
t('고장은 상류로 번진다 (받지도 못하므로)', () => {
  const lots = { C: [...fill('PART_R', 6), ...fill('PART_G', 3)] };
  const h = call({ lots, down: { C: 10 } });
  assert.ok(h.equips.has('C'));
  assert.ok(h.jammed.has('C'));
  assert.ok(h.links.has('L1'), 'C 가 못 받으니 들어오던 벨트는 선다');
  assert.ok(h.equips.has('A'));
});
t('고장 난 설비의 **유출** 벨트는 서지 않고 마른다 — 위에 있던 것은 나가야 한다', () => {
  const lots = { C: [...fill('PART_R', 6), ...fill('PART_G', 3)] };
  const h = call({ lots, down: { C: 10 } });
  assert.ok(h.dry.has('L3'));
  assert.equal(h.links.has('L3'), false, '고장 난 것은 설비지 컨베이어가 아니다');
});
t('선 벨트는 마른 벨트이기도 하다 (새것이 올라탈 수 없으니)', () => {
  const h = call({ stock: { S: 12 } });
  assert.ok(h.links.has('L3'));
  assert.ok(h.dry.has('L3'));
});

/* ---------- 겹침 ---------- */
t('막힘과 굶음이 겹치면 둘 다 목록에 있고, jammed 가 우선한다', () => {
  // C 는 재료가 없고(굶음) 적치대도 찼다(막힘)
  const h = call({ stock: { S: 12 } });
  assert.ok(h.starved.has('C'));
  assert.ok(h.jammed.has('C'));
  // SimClock 은 jammed 를 먼저 보므로 막힘으로 센다 (같은 시간을 두 번 안 뺀다)
});

/* ---------- 레시피 없는 설비로 보내면 예전 그대로 ---------- */
t('레시피 없는 설비는 종점이 아니다 — 자재가 사라지고 벨트도 안 선다', () => {
  const D = { uid: 'D', itemId: 'M', outputCount: 3 };
  const p2 = [A, D];
  const bf = [{ link: { uid: 'X', to: { uid: 'D' } }, owner: A, sink: null }];
  SS.clearStock();
  const h = H.haltState({
    beltFlows: bf, machines: [{ uid: 'A', cap: 3 }, { uid: 'D', cap: 3 }],
    placed: p2, itemOf, downMap: {}, crew: NOCREW,
  });
  assert.equal(h.links.size, 0);
  assert.equal(h.equips.size, 0);
});

/* ---------- 고리 도면에서 무한 루프가 없는지 ---------- */
t('설비가 고리로 이어져도 전파가 끝난다', () => {
  const P = { uid: 'P', itemId: 'M', outputCount: 1, recipe: { in: [{ kind: 'PART_R', qty: 1 }], out: 'PART_R' } };
  const Q = { uid: 'Q', itemId: 'M', outputCount: 1, recipe: { in: [{ kind: 'PART_R', qty: 1 }], out: 'PART_R' } };
  const bf = [
    { link: { uid: 'a', to: { uid: 'Q' } }, owner: P, sink: { uid: 'Q', cap: 1 } },
    { link: { uid: 'b', to: { uid: 'P' } }, owner: Q, sink: { uid: 'P', cap: 1 } },
  ];
  SS.clearStock();
  /* 둘 다 재료를 갖고 있고 둘 다 자리가 찼다 — 고리로 물린 판 */
  SS.addLots('P', ['PART_R'], Infinity);
  SS.addLots('Q', ['PART_R'], Infinity);
  const h = H.haltState({
    beltFlows: bf, machines: [{ uid: 'P', cap: 1 }, { uid: 'Q', cap: 1 }],
    placed: [P, Q], itemOf, downMap: {}, crew: NOCREW,
  });
  assert.equal(h.links.size, 2);            // 끝났다 (여기 오면 무한 루프가 아니다)
});

/* ---------- 무인(unmanned) — 네 번째 정지 이유 ---------- */
const callCrew = (unmannedUids, { lots = {} } = {}) =>
  call({ lots, crew: { manned: new Set(), unmanned: new Set(unmannedUids) } });

t('사람이 없으면 그 설비가 서고 유출 벨트가 마른다', () => {
  const h = callCrew(['A']);
  assert.ok(h.unmanned.has('A'));
  assert.ok(h.equips.has('A'));
  assert.ok(h.dry.has('L1'), 'A 의 유출 벨트에 새 자재가 안 올라타야 한다');
  assert.equal(h.links.has('L1'), false, '벨트 자체는 계속 돈다');
});
t('무인은 **상류로 안 번진다** — 사람이 없어도 받기는 받는다', () => {
  const full = { C: [...fill('PART_R', 6), ...fill('PART_G', 3)] };
  const h = callCrew(['C'], { lots: full });
  assert.ok(h.unmanned.has('C'));
  assert.ok(h.dry.has('L3'), 'C 의 유출 벨트는 마른다');
  /* C 로 들어오는 벨트는 그대로 돈다 — 자재가 버퍼에 쌓여야 하고,
     버퍼가 찼을 때 비로소 기존 규칙(①)이 상류를 세운다 */
  assert.equal(h.links.has('L1'), false, 'C 로 들어오는 벨트가 섰다');
  assert.equal(h.links.has('L2'), false);
  assert.equal(h.dry.has('L1'), false);
  assert.equal(h.jammed.has('C'), false);
});
t('버퍼가 차면 그때 상류가 선다 (무인이어도 규칙은 그대로)', () => {
  const packed = { C: [...fill('PART_R', 20), ...fill('PART_G', 10)] };   // 30 = inputCap
  const h = callCrew(['C'], { lots: packed });
  assert.ok(h.unmanned.has('C'));
  assert.ok(h.links.has('L1'), '버퍼가 찼으면 상류가 서야 한다');
  assert.ok(h.jammed.has('A'));
});
t('사람이 다 있으면 아무 일도 없다', () => {
  const full = { C: [...fill('PART_R', 6), ...fill('PART_G', 3)] };
  const h = callCrew([], { lots: full });
  assert.equal(h.unmanned.size, 0);
  assert.equal(h.links.size, 0);
  assert.equal(h.dry.size, 0);
});

/* ---------- 배선 — 판정을 만들어 놓고 안 이어 주면 아무 소용이 없다 -----------
     실제로 그랬다. 레일 애니메이션(ConnectorView)만 `state.running` 을 그대로
     받고 있어서, 종점이 막혀 물건이 서 있는데 레일은 계속 흐르고 있었다.
     화면에서만 보이는 종류라 값 검사로는 안 잡힌다 — 그래서 소스를 본다.
--------------------------------------------------------------------------- */
const STOP = '!halted.links.has(link.uid)';

t('레일 애니메이션이 벨트의 정지를 따라간다', () => {
  const block = cut(src, '{linkPaths.map(({ link, path }) => (', '))}', 'ConnectorView 배선');
  assert.ok(block.includes(STOP), `ConnectorView 에 ${STOP} 이 없다`);
});
t('벨트 위 물건은 서는 것과 마르는 것을 따로 받는다', () => {
  const block = cut(src, '{beltFlows.map(({ link, path, owner, sink, outKind, layers, speed, gap, kinds, accumulate }) => (', 'onArrive=', 'BeltItems 배선');
  assert.ok(block.includes(`running={state.running && ${STOP}}`), 'running 배선이 다르다');
  assert.ok(block.includes('feeding={!halted.dry.has(link.uid)}'), 'feeding 배선이 없다');
  /* 간격은 **자동 계산된 것**을 넘겨야 한다 — 설비에 저장된 옛 값이 아니라 */
  assert.ok(block.includes('gap={gap}'), '간격이 자동 계산 값이 아니다');
  assert.equal(block.includes('owner.spawnGap'), false, 'spawnGap 을 아직 읽고 있다');
});

