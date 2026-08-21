/* bom.js · simStore.js · cart.js(followDistance) 를 실제로 불러 값으로 검증 */
import assert from 'node:assert/strict';
import { SRC, group, t } from './_harness.mjs';

group('bom · 재고 · 종류');

const bom = await import(SRC + 'core/bom.js');
const sim = await import(SRC + 'core/simStore.js');
const lib = await import(SRC + 'data/library.js');

/* ---------- normalizeRecipe ---------- */
t('레시피 없음 → null', () => {
  assert.equal(bom.normalizeRecipe(null), null);
  assert.equal(bom.normalizeRecipe({}), null);
  assert.equal(bom.normalizeRecipe({ in: [] }), null);
});
t('모르는 종류는 떨군다', () => {
  assert.deepEqual(bom.normalizeRecipe({ in: [{ kind: 'NOPE', qty: 3 }] }), null);
  assert.equal(bom.normalizeRecipe({ out: 'NOPE' }), null);
});
t('같은 종류 두 줄은 더한다', () => {
  const r = bom.normalizeRecipe({ in: [{ kind: 'PART_R', qty: 2 }, { kind: 'PART_R', qty: 3 }] });
  assert.deepEqual(r.in, [{ kind: 'PART_R', qty: 5 }]);
});
t('0 이하 수량은 빠진다', () => {
  const r = bom.normalizeRecipe({ in: [{ kind: 'PART_R', qty: 0 }, { kind: 'PART_G', qty: -1 }], out: 'ASM_C' });
  assert.deepEqual(r.in, []);
  assert.equal(r.out, 'ASM_C');
});
t('수량 상한', () => {
  const r = bom.normalizeRecipe({ in: [{ kind: 'PART_R', qty: 999 }] });
  assert.equal(r.in[0].qty, bom.MAX_QTY);
});
t('산출만 정해도 살아남는다', () => {
  assert.deepEqual(bom.normalizeRecipe({ out: 'PART_G' }), { in: [], out: 'PART_G' });
});

/* ---------- isSource / outputKindOf ---------- */
t('레시피 없으면 원자재 공급원', () => {
  assert.equal(bom.isSource(null), true);
  assert.equal(bom.isSource({ in: [], out: 'ASM_C' }), true);
  assert.equal(bom.isSource({ in: [{ kind: 'PART_R', qty: 1 }] }), false);
});
const MK = { makes: lib.FAMILY.PART };     // 제작기
const MA = { makes: lib.FAMILY.ASM };      // 조립기

t('갈래 안에서는 도면이 정한다', () => {
  assert.equal(bom.outputKindOf({ recipe: { out: 'PART_B' } }, MK), 'PART_B');
  assert.equal(bom.outputKindOf({ recipe: { out: 'ASM_Y' } }, MA), 'ASM_Y');
});
t('갈래를 벗어난 값은 갈래 안으로 되돌린다', () => {
  /* 조립기에 제작품이 적혀 있어도 조립품을 낸다 (손으로 고친 도면·옛 도면) */
  assert.equal(bom.outputKindOf({ recipe: { out: 'PART_G' } }, MA), 'ASM_C');
  assert.equal(bom.outputKindOf({ recipe: { out: 'ASM_M' } }, MK), 'PART_R');
});
t('적어 둔 것이 없으면 갈래의 첫 종류', () => {
  assert.equal(bom.outputKindOf({}, MK), 'PART_R');
  assert.equal(bom.outputKindOf({}, MA), 'ASM_C');
  assert.equal(bom.outputKindOf({ recipe: { out: 'NOPE' } }, MA), 'ASM_C');
});
t('갈래를 말하지 않은 항목(사용자 GLB)은 제약이 없다', () => {
  assert.equal(bom.outputKindOf({ recipe: { out: 'ASM_Y' } }, {}), 'ASM_Y');
  assert.equal(bom.outputKindOf({ recipe: { out: 'PART_B' } }, null), 'PART_B');
  assert.equal(lib.allowedOutOf(null).length, 6);
});
t('고를 수 있는 것 · 배치할 때 심어 줄 것', () => {
  assert.deepEqual(lib.allowedOutOf(MK), ['PART_R', 'PART_G', 'PART_B']);
  assert.deepEqual(lib.allowedOutOf(MA), ['ASM_C', 'ASM_M', 'ASM_Y']);
  const byId = Object.fromEntries(lib.BUILTIN_LIBRARY.map((i) => [i.id, i]));
  assert.equal(byId.MACHINE_1.name, '제작기');
  assert.equal(byId.MACHINE_2.name, '조립기');
  assert.equal(lib.defaultOutOf(byId.MACHINE_1), 'PART_R');
  assert.equal(lib.defaultOutOf(byId.MACHINE_2), 'ASM_C');
  /* 옛 이름으로 적힌 도면도 갈래 안으로 들어온다: OBJ3 → ASM_C */
  assert.equal(bom.outputKindOf({ recipe: { out: 'OBJ3' } }, MA), 'ASM_C');
  assert.equal(bom.outputKindOf({ recipe: { out: 'OBJ' } }, MK), 'PART_R');
});

/* ---------- 종류 여섯 · 옛 이름 별칭 ---------- */
t('제작품 셋 + 조립품 셋 + **품종마다 불량품 하나**', () => {
  const makeable = ['PART_R', 'PART_G', 'PART_B', 'ASM_C', 'ASM_M', 'ASM_Y'];
  assert.deepEqual(Object.keys(lib.PAYLOAD_ITEMS),
    [...makeable, 'SCRAP', ...makeable.map((k) => `SCRAP_${k}`)]);
  assert.deepEqual(Object.values(lib.PAYLOAD_ITEMS).slice(0, 6).map((i) => i.name),
    ['제작품 1', '제작품 2', '제작품 3', '조립품 1', '조립품 2', '조립품 3']);
  assert.equal(lib.PAYLOAD_ITEMS.SCRAP_PART_R.name, '불량품 (제작품 1)');
});

t('불량품은 **어느 품종의 것인지**를 들고 있다', () => {
  /* 한 종류로 합치면 제작품 1의 불량과 조립품 2의 불량이 같은 줄에 섞여 흘러서,
     재작업 설비가 무엇을 고치는지 알 수가 없고 갈래로 가를 수도 없다 */
  assert.equal(lib.scrapKindOf('PART_R'), 'SCRAP_PART_R');
  assert.equal(lib.baseKindOf('SCRAP_PART_R'), 'PART_R');
  /* 모르는 품종이면 갈래 없는 옛 불량품으로 떨어진다 — 터지지 않는다 */
  assert.equal(lib.scrapKindOf('nope'), 'SCRAP');
  assert.equal(lib.baseKindOf('SCRAP'), null);
  assert.equal(lib.baseKindOf('PART_R'), null);
});

t('불량품은 **모양은 같고 색만 죽는다**', () => {
  /* 불량이라고 생김새가 바뀌지는 않는다. 색이 죽어야 화면에서 바로 읽힌다 */
  const P = lib.PAYLOAD_ITEMS;
  assert.equal(P.SCRAP_PART_R.url, P.PART_R.url);
  assert.notEqual(P.SCRAP_PART_R.tint, P.PART_R.tint);
  assert.equal(P.SCRAP_ASM_C.url, P.ASM_C.url);
});

t('불량품은 **만들기로 고를 수 없다** — 나오는 것이지 만드는 것이 아니다', () => {
  assert.equal(lib.isScrapKind('SCRAP'), true);
  assert.equal(lib.isScrapKind('PART_R'), false);
  for (const item of [{ makes: 'PART' }, { makes: 'ASM' }, {}]) {
    assert.equal(lib.allowedOutOf(item).includes('SCRAP'), false,
      `${JSON.stringify(item)} 가 불량품을 만들 수 있다고 나온다`);
  }
  /* 재료로는 고를 수 있어야 한다 — 그게 재작업 설비다 */
  assert.ok(lib.PAYLOAD_ITEMS.SCRAP, '불량품이 종류 목록에 없다');
});
t('갈래는 형상으로, 종류는 색으로 갈린다', () => {
  const P = lib.PAYLOAD_ITEMS;
  /* 제작품 셋은 같은 GLB · 조립품 셋도 같은 GLB · 둘은 서로 다른 GLB */
  assert.equal(new Set([P.PART_R.url, P.PART_G.url, P.PART_B.url]).size, 1);
  assert.equal(new Set([P.ASM_C.url, P.ASM_M.url, P.ASM_Y.url]).size, 1);
  assert.notEqual(P.PART_R.url, P.ASM_C.url);
  assert.ok(P.ASM_C.url.endsWith('Assembly.glb'));
  /* 캐시 키는 여섯 다 달라야 한다 — 같으면 색이 서로 덮어쓴다 */
  assert.equal(new Set(Object.values(P).map((i) => i.modelKey)).size, 13);
  /* RGB · CMY */
  assert.deepEqual([P.PART_R.tint, P.PART_G.tint, P.PART_B.tint],
    ['#ff0000', '#00ff00', '#0000ff']);
  assert.deepEqual([P.ASM_C.tint, P.ASM_M.tint, P.ASM_Y.tint],
    ['#00ffff', '#ff00ff', '#ffff00']);
});
t('옛 이름은 별칭으로 살아남는다 (이미 그린 도면)', () => {
  assert.equal(lib.canonKind('OBJ'), 'PART_R');
  assert.equal(lib.canonKind('OBJ2'), 'PART_G');
  assert.equal(lib.canonKind('OBJ3'), 'ASM_C');
  assert.equal(lib.canonKind('PART_B'), 'PART_B');
  assert.equal(lib.canonKind('NOPE'), null);
  assert.equal(lib.canonKind(null), null);
  /* 옛 이름으로 적힌 레시피가 그대로 동작해야 한다 */
  const r = bom.normalizeRecipe({ in: [{ kind: 'OBJ', qty: 2 }], out: 'OBJ3' });
  assert.deepEqual(r, { in: [{ kind: 'PART_R', qty: 2 }], out: 'ASM_C' });
});
t('입력 버퍼 크기', () => {
  assert.equal(bom.inputCapOf({}), bom.DEFAULT_INPUT_CAP);
  assert.equal(bom.inputCapOf({ inputCap: 50 }), 50);
  assert.equal(bom.inputCapOf({ inputCap: 0 }), 1);        // 0 은 아무것도 못 받는 함정
});

/* ---------- needFor / missingOf / buildableCount ---------- */
const R = { in: [{ kind: 'PART_R', qty: 2 }, { kind: 'PART_G', qty: 1 }], out: 'ASM_C' };
t('소요량은 개수에 비례', () => {
  assert.deepEqual(bom.needFor(R, 1), { PART_R: 2, PART_G: 1 });
  assert.deepEqual(bom.needFor(R, 3), { PART_R: 6, PART_G: 3 });
  assert.deepEqual(bom.needFor(R, 0), {});
  assert.deepEqual(bom.needFor(null, 5), {});
});
t('종류별 개수 세기', () => {
  assert.deepEqual(bom.countKinds(['PART_R', 'PART_G', 'PART_R']), { PART_R: 2, PART_G: 1 });
  assert.deepEqual(bom.countKinds([]), {});
  assert.deepEqual(bom.countKinds(null), {});
});
t('모자란 만큼', () => {
  assert.deepEqual(bom.missingOf({ PART_R: 1 }, { PART_R: 2, PART_G: 1 }), { PART_R: 1, PART_G: 1 });
  assert.deepEqual(bom.missingOf({ PART_R: 5, PART_G: 5 }, { PART_R: 2, PART_G: 1 }), {});
  assert.equal(bom.canBuild({ PART_R: 2, PART_G: 1 }, bom.needFor(R, 1)), true);
  assert.equal(bom.canBuild({ PART_R: 2 }, bom.needFor(R, 1)), false);
});
t('몇 개까지 만들 수 있나', () => {
  assert.equal(bom.buildableCount({ PART_R: 7, PART_G: 2 }, R), 2);   // OBJ2 가 한계
  assert.equal(bom.buildableCount({ PART_R: 7, PART_G: 0 }, R), 0);
  assert.equal(bom.buildableCount({}, null), Infinity);          // 공급원은 무제한
});

/* ---------- flowEdges ---------- */
const itemOf = (id) => ({
  BELT: { id: 'BELT' },
  PIPE: { id: 'PIPE', utility: true },
  MK: { id: 'MK', makes: lib.FAMILY.PART },     // 제작기
  MA: { id: 'MA', makes: lib.FAMILY.ASM },      // 조립기
}[id] ?? null);

/* 무엇을 만드는지는 **놓인 설비에** 적혀 있다(놓을 때 심어 준 값) */
const A = { uid: 'A', itemId: 'MK', recipe: { in: [], out: 'PART_R' } };
const B = { uid: 'B', itemId: 'MK', recipe: { in: [], out: 'PART_G' } };
const C = { uid: 'C', itemId: 'MA', recipe: { in: [{ kind: 'PART_R', qty: 2 }, { kind: 'PART_G', qty: 1 }], out: 'ASM_C' } };
const byUid = new Map([A, B, C].map((p) => [p.uid, p]));

const links = [
  { uid: 'L1', itemId: 'BELT', from: { uid: 'A', portId: 'o' }, to: { uid: 'C', portId: 'i' } },
  { uid: 'L2', itemId: 'BELT', from: { uid: 'B', portId: 'o' }, to: { uid: 'C', portId: 'i' } },
  { uid: 'L3', itemId: 'PIPE', from: { uid: 'A', anchor: true }, to: { uid: 'C', anchor: true } },
  { uid: 'L4', itemId: 'BELT', from: { point: [0, 0] }, to: { uid: 'C', portId: 'i' } },
];

t('흐름 간선은 벨트만, 방향은 유출→유입', () => {
  const e = bom.flowEdges(links, byUid, itemOf);
  assert.equal(e.length, 2);
  assert.deepEqual(e[0], { from: 'A', to: 'C', kind: 'PART_R' });
  assert.deepEqual(e[1], { from: 'B', to: 'C', kind: 'PART_G' });
});

/* ---------- auditRecipes ---------- */
t('재료가 다 오면 경고 없음', () => {
  const edges = bom.flowEdges(links, byUid, itemOf);
  const nodes = [A, B, C].map((p) => ({ uid: p.uid, name: p.uid, recipe: bom.recipeOf(p), cartFed: false }));
  assert.deepEqual(bom.auditRecipes(nodes, edges), []);
});
t('한 갈래가 없으면 그것만 경고', () => {
  const edges = bom.flowEdges([links[0]], byUid, itemOf);
  const nodes = [A, C].map((p) => ({ uid: p.uid, name: p.uid, recipe: bom.recipeOf(p), cartFed: false }));
  const w = bom.auditRecipes(nodes, edges);
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, 'PART_G');
  assert.equal(w[0].reason, 'wrong');       // 뭔가 오긴 오는데 그게 아니다
});
t('아무것도 안 오면 reason=none', () => {
  const nodes = [{ uid: 'C', name: 'C', recipe: bom.recipeOf(C), cartFed: false }];
  const w = bom.auditRecipes(nodes, []);
  assert.equal(w.length, 2);
  assert.ok(w.every((x) => x.reason === 'none'));
});
t('카트가 대는 설비는 진단하지 않는다', () => {
  const nodes = [{ uid: 'C', name: 'C', recipe: bom.recipeOf(C), cartFed: true }];
  assert.deepEqual(bom.auditRecipes(nodes, []), []);
});
t('공급원은 진단 대상이 아니다', () => {
  const nodes = [{ uid: 'A', name: 'A', recipe: bom.recipeOf(A), cartFed: false }];
  assert.deepEqual(bom.auditRecipes(nodes, []), []);
});

/* ---------- explode ---------- */
t('한 단계 — 상류가 공급원이면 그것이 원자재', () => {
  const edges = bom.flowEdges(links, byUid, itemOf);
  assert.deepEqual(bom.explode('C', byUid, edges), { raw: { PART_R: 2, PART_G: 1 }, looped: false });
});
t('두 단계 — 곱해서 거슬러 올라간다', () => {
  /* D: OBJ3 3개 → 완제품 1개.  C: OBJ 2 + OBJ2 1 → OBJ3 1 */
  const D = { uid: 'D', itemId: 'MA', recipe: { in: [{ kind: 'ASM_C', qty: 3 }], out: 'ASM_M' } };
  const m = new Map(byUid);
  m.set('D', D);
  const edges = [
    ...bom.flowEdges(links, byUid, itemOf),
    { from: 'C', to: 'D', kind: 'ASM_C' },
  ];
  assert.deepEqual(bom.explode('D', m, edges).raw, { PART_R: 6, PART_G: 3 });
});
t('공급원은 전개할 것이 없다', () => {
  assert.deepEqual(bom.explode('A', byUid, []), { raw: {}, looped: false });
});
t('고리를 만나면 거기서 멈춘다', () => {
  const X = { uid: 'X', itemId: 'MK', recipe: { in: [{ kind: 'PART_G', qty: 1 }], out: 'PART_R' } };
  const Y = { uid: 'Y', itemId: 'MK', recipe: { in: [{ kind: 'PART_R', qty: 1 }], out: 'PART_G' } };
  const m = new Map([['X', X], ['Y', Y]]);
  const edges = [{ from: 'Y', to: 'X', kind: 'PART_G' }, { from: 'X', to: 'Y', kind: 'PART_R' }];
  const r = bom.explode('X', m, edges);
  assert.equal(r.looped, true);            // 무한 재귀로 죽지 않는다
});

/* ---------- simStore.takeEach ---------- */
t('전부 있을 때만 뺀다', () => {
  sim.clearStock();
  sim.addStock('E1', 5, 100, 'PART_R');
  sim.addStock('E1', 1, 100, 'PART_G');
  assert.equal(sim.getStock('E1'), 6);

  // OBJ2 가 1개뿐 — 2개를 요구하면 실패하고 **아무것도 안 준다**
  assert.equal(sim.takeEach('E1', { PART_R: 2, PART_G: 2 }), false);
  assert.equal(sim.getStock('E1'), 6);
  assert.deepEqual(bom.countKinds(sim.getLots('E1')), { PART_R: 5, PART_G: 1 });

  assert.equal(sim.takeEach('E1', { PART_R: 2, PART_G: 1 }), true);
  assert.deepEqual(bom.countKinds(sim.getLots('E1')), { PART_R: 3 });
});
t('먹을 것이 없으면 그냥 성공(공급원)', () => {
  sim.clearStock();
  assert.equal(sim.takeEach('E9', {}), true);
  assert.equal(sim.takeEach('E9', { PART_R: 0 }), true);
  assert.equal(sim.getStock('E9'), 0);
});
t('위에서부터 뺀다 — 아래 순서는 그대로', () => {
  sim.clearStock();
  sim.addLots('E2', ['PART_R', 'PART_G', 'PART_R', 'PART_G', 'PART_R'], 100);
  assert.equal(sim.takeEach('E2', { PART_R: 1 }), true);
  assert.deepEqual(sim.getLots('E2'), ['PART_R', 'PART_G', 'PART_R', 'PART_G']);
  assert.equal(sim.getStock('E2'), 4);                    // 개수와 목록이 늘 같다
});
t('입력 버퍼는 수용량을 넘지 않는다', () => {
  sim.clearStock();
  assert.equal(sim.addStock('E3', 10, 4, 'PART_R'), 4);
  assert.equal(sim.getStock('E3'), 4);
});

/* ---------- 한 사이클 시뮬 ---------- */
t('굶음 → 재료 도착 → 생산 → 다시 굶음', () => {
  sim.clearStock();
  const per = bom.needFor(R, 3);                           // 한 덩어리 3층
  assert.deepEqual(per, { PART_R: 6, PART_G: 3 });

  const layers = 3;
  const starved = () => bom.buildableCount(bom.countKinds(sim.getLots('M')), R) < layers;
  assert.equal(starved(), true);                           // 비었으니 굶음

  sim.addStock('M', 6, 30, 'PART_R');
  sim.addStock('M', 3, 30, 'PART_G');
  assert.equal(starved(), false);                          // 딱 한 덩어리치

  assert.equal(sim.takeEach('M', per), true);              // 한 덩어리 생산
  assert.equal(sim.getStock('M'), 0);
  assert.equal(starved(), true);                           // 다시 굶는다
});


t('불량품 여섯이 **서로 다른 색**이다', () => {
  /* `payload` 가 rgb 를 color 로 바꿔 넣어서 항목에는 rgb 가 안 남는다. 그걸
     읽으려다 불량품 여섯이 전부 같은 색이 될 뻔했다 — tint 에서 판다. */
  const P = lib.PAYLOAD_ITEMS;
  const scraps = Object.keys(P).filter((k) => /^SCRAP_/.test(k));
  assert.equal(scraps.length, 6);
  assert.equal(new Set(scraps.map((k) => P[k].tint)).size, 6, '불량품들이 같은 색이다');
  assert.equal(new Set(scraps.map((k) => JSON.stringify(P[k].color))).size, 6, '3D 색이 같다');
});
