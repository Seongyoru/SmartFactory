/**
 * =============================================================================
 *  품종 전환 — **한 설비가 여러 가지를 번갈아 만든다**
 * =============================================================================
 *  로트 전환은 「N개마다 T초 쉰다」였다. 바꿀 품종이 없었기 때문이다
 *  (그래서 「품종 전환」이라 부르지 않고 「로트 전환」이라 불렀다).
 *  이제 설비가 레시피를 여럿 가질 수 있다.
 *
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **① 옛 도면이 그대로 돈다.** `recipes` 가 없으면 `recipe` 하나짜리 설비다.
 *  **② 천장과 실측이 만난다.** 두 품종을 번갈아 만들면 한 품종의 몫은 절반이다 —
 *     안 나누면 천장이 두 배로 부풀고 사람은 시뮬이 틀렸다고 여긴다.
 *  **③ 종류가 끝까지 따라간다.** 벨트 칸마다 무엇이 실렸는지 들고 있지 않으면
 *     도착한 것이 엉뚱한 종류로 쌓인다.
 *  **④ 자투리가 라인을 안 세운다.** 품종이 바뀌면 앞머리에 옛 종류가 몇 개
 *     남는데, 꽉 찬 덩어리만 실으면 그게 영영 안 빠진다(실제로 18개에서 멈췄다).
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';
import { itemOf, loadModels, specOf as specById } from './_models.mjs';

group('품종 전환');

const Bom = await import(SRC + 'core/bom.js');
const P = await import(SRC + 'core/process.js');
const St = await import(SRC + 'core/simStore.js');
const Belt = await import(SRC + 'core/belt.js');
const B = await import(SRC + 'core/balance.js');
const A = await import(SRC + 'core/area.js');
const Lu = await import(SRC + 'core/lineup.js');
const R = await import(SRC + 'core/replicate.js');
const LIB = await import(SRC + 'data/library.js');

/* ---------- ① 옛 도면이 그대로 ------------------------------------------- */
t('`recipes` 가 없으면 **`recipe` 하나짜리** 설비다', () => {
  assert.deepEqual(Bom.recipesOf({ recipe: { in: [], out: 'PART_R' } }).map((r) => r.out), ['PART_R']);
  assert.deepEqual(Bom.recipesOf({}), [], '레시피가 없는데 만들어 낸다');
  assert.equal(Bom.isMulti({ recipe: { in: [], out: 'PART_R' } }), false);
  /* `recipeOf` 는 **첫째**를 가리킨다 — 옛 부르는 곳이 다 그 뜻이었다 */
  assert.equal(Bom.recipeOf({ recipes: [{ in: [], out: 'PART_G' }] })?.out, 'PART_G');
});

t('번호가 줄을 벗어나면 처음으로 돌린다', () => {
  const p = { recipes: [{ in: [], out: 'PART_R' }, { in: [], out: 'PART_G' }] };
  assert.deepEqual([0, 1, 2, 3, -1].map((i) => Bom.recipeAt(p, i).out),
    ['PART_R', 'PART_G', 'PART_R', 'PART_G', 'PART_G']);
  assert.equal(Bom.recipeAt({}, 0), null);
});

/* ---------- 출력 자리가 종류를 안다 --------------------------------------- */
t('출력 자리가 **무엇을 만들어 놓았는지** 안다', () => {
  St.clearMade();
  St.addMade('X', 3, 'PART_R');
  St.addMade('X', 2, 'PART_G');
  assert.equal(St.getMade('X'), 5);
  assert.deepEqual(St.madeRun('X'), { kind: 'PART_R', n: 3 }, '앞머리를 잘못 읽는다');
  St.takeMade('X', 3);
  assert.deepEqual(St.madeRun('X'), { kind: 'PART_G', n: 2 }, '앞에서부터 안 나간다');
});

t('**한 덩어리는 같은 종류로만** 집는다', () => {
  St.clearMade();
  St.addMade('Y', 6, 'PART_R');
  const got = St.takeBundles('Y', 3, 1);
  assert.deepEqual(got, { made: 1, kind: 'PART_R', count: 3 });
  assert.equal(St.getMade('Y'), 3, '덩어리 하나보다 많이 집었다');
});

t('여러 덩어리를 한 번에 집어도 **한 종류**다', () => {
  St.clearMade();
  St.addMade('Y2', 9, 'PART_R');
  St.addMade('Y2', 9, 'PART_G');
  const got = St.takeBundles('Y2', 3, 5);
  assert.equal(got.kind, 'PART_R');
  assert.equal(got.made, 3, '다른 종류까지 끌어왔다');
  assert.equal(got.count, 3);
});

t('**자투리는 짧은 덩어리로 보낸다** — 안 그러면 라인이 통째로 선다', () => {
  /* 20개씩 번갈아 만드는 설비가 실제로 18개에서 멈췄다. 뒤에 다른 종류가
     서 있다는 것은 그 줄이 더 안 자란다는 뜻이므로, 짧아도 실어야 한다. */
  St.clearMade();
  St.addMade('Z', 2, 'PART_R');      // 덩어리(3)에 못 미치는 자투리
  St.addMade('Z', 6, 'PART_G');      // 뒤에 다른 종류가 서 있다
  const got = St.takeBundles('Z', 3, 1);
  assert.deepEqual(got, { made: 1, kind: 'PART_R', count: 2 }, '자투리가 안 빠진다');
});

t('뒤가 비어 있으면 **기다린다** — 아직 만드는 중이다', () => {
  St.clearMade();
  St.addMade('W', 2, 'PART_R');
  assert.deepEqual(St.takeBundles('W', 3, 1), { made: 0, kind: null, count: 0 },
    '덜 찬 덩어리를 성급히 보낸다');
});

/* ---------- 벨트가 칸마다 종류를 든다 ------------------------------------- */
t('벨트 칸마다 **무엇이 실렸는지** 든다', () => {
  const belt = Belt.makeBelt(8);
  assert.equal(belt.kinds.length, 8, '종류 자리가 없다');
  assert.equal(belt.counts.length, 8, '개수 자리가 없다');

  /* 두 종류를 앞뒤로 올려 보낸다. **자리를 짚지 않는다** — 첫 틱에 번호가
     둘 생겨(빈칸 하나 포함) 자리 계산이 헷갈린다. 줄에 무엇이 실렸는지만 본다. */
  let i = 0;
  const spawn = () => ({ made: 1, kind: i++ < 2 ? 'PART_R' : 'PART_G', count: 3 });
  for (let k = 0; k < 4; k++) Belt.advanceBelt(belt, { d: 2, step: 2, length: 40, spawn });
  const on = belt.kinds.filter(Boolean);
  assert.ok(on.includes('PART_R') && on.includes('PART_G'), `두 종류가 안 실렸다: ${on}`);
  assert.ok(belt.counts.some((c) => c === 3), '개수를 안 든다');
});

t('도착한 것을 **종류별로** 돌려준다', () => {
  const belt = Belt.makeBelt(20);
  let i = 0;
  const spawn = () => ({ made: 1, kind: i++ < 2 ? 'PART_R' : 'PART_G', count: 3 });
  /* 길이 4 짜리 짧은 벨트를 쭉 굴린다 */
  let tally = {};
  for (let k = 0; k < 20; k++) {
    Belt.advanceBelt(belt, { d: 2, step: 2, length: 4, spawn });
    for (const kind of Object.keys(belt.out ?? {})) tally[kind] = (tally[kind] ?? 0) + belt.out[kind];
  }
  assert.ok(tally.PART_R > 0 && tally.PART_G > 0, `두 종류가 안 나왔다 ${JSON.stringify(tally)}`);
  assert.equal(tally.PART_R, 6, '먼저 올린 두 덩어리(3개씩)가 안 맞는다');
});

t('숫자만 돌려주는 **옛 꼴도 받는다**', () => {
  /* 품종이 하나인 도면은 줄에 이름표 하나면 된다 — 그 길이 살아 있어야 한다 */
  const belt = Belt.makeBelt(8);
  for (let k = 0; k < 3; k++) Belt.advanceBelt(belt, { d: 2, step: 2, length: 40, spawn: () => 1, kind: 'PART_R' });
  assert.ok(belt.kinds.filter(Boolean).every((x) => x === 'PART_R'), '줄의 이름표를 안 쓴다');
  assert.ok(belt.kinds.filter(Boolean).length > 0, '아무것도 안 실렸다');
});

/* ---------- 천장이 품종을 나눈다 ------------------------------------------ */
const bal = (recipes, over = {}) => B.lineBalance({
  placed: [{ uid: 'M', name: '설비', itemId: 'EQ', cycleSec: 6, recipes, ...over }],
  links: [], carts: [],
  itemOf: () => ({ id: 'EQ', category: 'equipment', makes: 'PART' }),
  specOf: () => null,
});
const ONE = [{ in: [], out: 'PART_R' }];
const TWO = [{ in: [], out: 'PART_R' }, { in: [], out: 'PART_G' }];

t('**품종이 둘이면 한 품종의 몫은 절반**이다', () => {
  /* 안 나누면 천장이 두 배로 부풀고, 돌려 본 결과가 절반으로 나온다 —
     그러면 사람은 시뮬이 틀렸다고 여긴다. */
  assert.ok(Math.abs(bal(ONE).capacity - 10) < 0.01, '한 품종 천장이 다르다');
  assert.ok(Math.abs(bal(TWO).capacity - 5) < 0.01, `두 품종인데 ${bal(TWO).capacity} 다`);
});

t('천장이 **왜 그런지** 말한다', () => {
  assert.match(bal(ONE).rows[0].why, /^공정 6초\/개$/);
  assert.match(bal(TWO).rows[0].why, /품종 2가지를 번갈아/);
  assert.match(bal(TWO, { lotSize: 20, setupSec: 300 }).rows[0].why, /한 품종에 42\.0초\/개/);
});

/* ---------- 실제로 번갈아 도는가 (끝에서 끝까지) -------------------------- */
await loadModels(['MACHINE_1', 'STILLAGE', 'CONVEYOR']);
const idByKey = new Map(LIB.BUILTIN_LIBRARY.filter((x) => x.modelKey).map((x) => [x.modelKey, x.id]));
const specOf = (it) => (it?.modelKey ? specById(idByKey.get(it.modelKey) ?? '') : null);
const areas = [{ uid: 'F', mp: A.rectMP([-15, -15], [15, 15]) }];
const links = [{
  uid: 'C1', itemId: 'CONVEYOR', from: { uid: 'P1', portId: 'PORT_OUT@Z-' }, to: { uid: 'S1' },
  radius: 0.5, layer: 0, width: 1,
}];
const line = (recipes, lot, setupSec) => [
  {
    uid: 'P1', name: '제작기', itemId: 'MACHINE_1', pos: [-6, 6], rot: 0,
    outputCount: 3, cycleSec: 2, lotSize: lot, setupSec, recipes,
  },
  { uid: 'S1', name: '적치대', itemId: 'STILLAGE', pos: [-6, 0], rot: 0, capacity: 200 },
];
const run = (recipes, lot, setupSec, seconds = 300) => {
  St.clearStock();
  const placed = line(recipes, lot, setupSec);
  const w = Lu.worldOf({
    placed, links, carts: [], areas, walls: [], openings: [], shifts: [], beltSpeed: 0.6, itemOf, specOf,
  });
  R.runOnce({ seconds, world: w.world, flow: w.flow, pick: () => 0 });
  const lots = St.getLots('S1');
  const tally = {};
  for (const k of lots) tally[k] = (tally[k] ?? 0) + 1;
  return { lots, tally, capacity: B.lineBalance({ placed, links, carts: [], itemOf, specOf, beltSpeed: 0.6 }).capacity };
};

t('**두 품종이 로트 단위로 번갈아 도착한다**', () => {
  const r = run(TWO, 20, 30);
  assert.ok(r.tally.PART_R > 0 && r.tally.PART_G > 0, `한 종류만 나왔다 ${JSON.stringify(r.tally)}`);
  /* 앞 40개가 20 + 20 이어야 한다 — 로트 단위로 갈린다 */
  const head = r.lots.slice(0, 40).join(',');
  assert.ok(/^(PART_R,){20}(PART_G,){19}PART_G$/.test(head), `로트 단위가 아니다: ${head.slice(0, 80)}`);
});

t('**천장과 실측이 만난다** — 이것이 이 기능의 값이다', () => {
  /* 갈리면 사람이 시뮬을 안 믿는다. 차이는 벨트를 채우는 시간이다. */
  for (const [recipes, lot, setup] of [[ONE, 0, 0], [ONE, 20, 30], [TWO, 20, 30]]) {
    const r = run(recipes, lot, setup);
    const kinds = Math.max(1, Object.keys(r.tally).length);
    const got = (r.lots.length / kinds) * 12;           // 300초 → 개/시
    const ceil = r.capacity * 60;
    assert.ok(got <= ceil + 1, `천장 ${ceil.toFixed(0)} 을 넘었다 (${got.toFixed(0)})`);
    assert.ok(got > ceil * 0.85, `천장 ${ceil.toFixed(0)} 인데 ${got.toFixed(0)} 밖에 안 나온다`);
  }
});

t('품종을 늘리면 **한 품종은 덜 나온다**', () => {
  const one = run(ONE, 20, 30);
  const two = run(TWO, 20, 30);
  assert.ok(two.tally.PART_R < one.tally.PART_R,
    `품종을 늘렸는데 제작품 1이 안 줄었다 (${two.tally.PART_R} vs ${one.tally.PART_R})`);
});

/* ---------- 굶음이 지금 품종을 본다 --------------------------------------- */
const haltSrc = await readSrc('core/halt.js');
t('굶음은 **지금 만드는 품종**의 재료를 본다', () => {
  /* 첫 레시피만 보면, 제작품 2를 만드는 중에 제작품 1의 재료가 없다고
     「굶었다」고 찍는다 — 멀쩡히 도는 라인이 붉게 선다. */
  assert.ok(haltSrc.includes('recipeAt(p, slotOf(p.uid))'), '첫 레시피만 본다');
  assert.equal(/recipeOf\(p\)/.test(haltSrc), false, '옛 길이 남아 있다');
});

/* ---------- 규칙이 두 벌이 되지 않게 ------------------------------------- */
const repSrc = await readSrc('core/replicate.js');
const sceneSrc = await readSrc('scene/EditorScene.jsx');
t('덩어리 규칙은 **한 곳에** 있다 — 화면과 헤드리스가 같은 것을 부른다', () => {
  for (const src of [repSrc, sceneSrc]) assert.ok(src.includes('takeBundles('), '덩어리 규칙을 안 쓴다');
  assert.equal(/Math\.floor\(getMade\(/.test(repSrc), false, '옛 규칙이 남아 있다');
});
t('도착 처리도 **종류마다** 한다', () => {
  for (const src of [repSrc, sceneSrc]) {
    assert.ok(/for \(const kind of Object\.keys\(/.test(src), '종류를 안 가른다');
  }
});


/* ==========================================================================
 *  화면 — **품종을 여기서 만든다**
 * --------------------------------------------------------------------------
 *  이 칸이 없으면 기능이 아예 닿지 않는다. 도면에 `recipes` 를 적는 곳은
 *  인스펙터의 「만드는 것」 하나뿐이다.
 * ======================================================================== */
const inspSrc = await readSrc('ui/Inspector.jsx');

/* 「만드는 것」 칸의 머리를 **소스에서 떼어** 실제로 눌러 본다 */
const panel = new Function(
  'placed', 'item', 'outKeys', 'useState', 'dispatch',
  'recipesOf', 'outKindOf', 'isSource', 'inputCapOf', 'lotOf', 'normalizeRecipe',
  `${cut(inspSrc, 'const list = recipesOf(placed);', "setPick(Math.max(0, at - 1));\n  };", '만드는 것 칸')}
  return { list, at, recipe, out, source, cap, per, lot, patch, addKind, dropKind };`,
);

const OUT_KEYS = ['PART_R', 'PART_G', 'PART_B'];
const open = (placed, pick = 0) => {
  const saved = [];
  const view = panel(
    placed, { makes: 'part' }, OUT_KEYS, () => [pick, (n) => saved.push(n)],
    (a) => saved.push(a), Bom.recipesOf, Bom.outKindOf, Bom.isSource, Bom.inputCapOf,
    P.lotOf, Bom.normalizeRecipe,
  );
  return { ...view, saved };
};
/** 눌러서 저장된 도면 조각 */
const patched = (saved) => saved.find((x) => x?.type === 'UPDATE_PLACED')?.patch;

const ONE_KIND = { uid: 'M', recipe: { in: [{ kind: 'ASM_C', qty: 2 }], out: 'PART_R' } };
const TWO_KINDS = {
  uid: 'M',
  recipes: [
    { in: [{ kind: 'ASM_C', qty: 2 }], out: 'PART_R' },
    { in: [{ kind: 'ASM_C', qty: 1 }], out: 'PART_G' },
  ],
};

t('한 품종짜리 도면도 그대로 열린다 — 칩이 하나 뜬다', () => {
  const v = open(ONE_KIND);
  assert.equal(v.list.length, 1);
  assert.equal(v.at, 0);
  assert.equal(v.out, 'PART_R');
  assert.equal(v.source, false);
});

t('고른 칩만 고친다 — **옆 품종은 안 건드린다**', () => {
  const v = open(TWO_KINDS, 1);
  assert.equal(v.out, 'PART_G', '고른 칩의 산출물을 안 보여 준다');
  v.patch({ ...v.recipe, out: 'PART_B' });
  const p = patched(v.saved);
  assert.deepEqual(p.recipes.map((r) => r.out), ['PART_R', 'PART_B'], '엉뚱한 자리를 고쳤다');
});

t('도면에는 **줄로** 적고, 첫 줄은 옛 이름에도 남긴다', () => {
  /* 한 품종짜리 도면을 읽는 자리가 아직 많다. `recipe` 를 안 남기면 저장하고
     다시 연 도면이 조용히 원자재 공급원이 된다 */
  const v = open(TWO_KINDS, 0);
  v.patch({ ...v.recipe, out: 'PART_B' });
  const p = patched(v.saved);
  assert.deepEqual(p.recipe, p.recipes[0], '첫 줄과 옛 이름이 어긋난다');
});

t('품종을 더하면 **아직 안 쓴 산출물**을 고른다', () => {
  const v = open(ONE_KIND);
  v.addKind();
  const p = patched(v.saved);
  assert.equal(p.recipes.length, 2);
  assert.equal(p.recipes[1].out, 'PART_G', '같은 것을 두 번 만든다');
  /* 재료는 지금 것을 베껴 준다 — 빈 레시피로 두면 그 자리가 조용히
     「원자재 공급원」이 되어 천장이 부푸는데 화면에는 아무 표시가 안 뜬다 */
  assert.deepEqual(p.recipes[1].in, p.recipes[0].in, '재료를 안 베꼈다');
  assert.ok(v.saved.includes(1), '새로 만든 칩으로 안 옮겨 간다');
});

t('품종을 빼면 **고른 자리가 앞으로** 물러난다', () => {
  const v = open(TWO_KINDS, 1);
  v.dropKind();
  const p = patched(v.saved);
  assert.deepEqual(p.recipes.map((r) => r.out), ['PART_R']);
  assert.ok(v.saved.includes(0), '없어진 자리를 계속 고르고 있다');
});

t('고른 자리는 **목록 밖으로 안 나간다**', () => {
  /* 셋째를 고른 채로 품종을 지우면 `list[2]` 가 사라진다. 안 잡아 두면
     그 다음 렌더에서 빈 레시피를 고친 것이 저장된다 */
  assert.equal(open(TWO_KINDS, 5).at, 1);
  assert.equal(open(ONE_KIND, 3).at, 0);
  assert.equal(open({ uid: 'M' }, 2).at, 0, '레시피가 아예 없는 자리에서 터진다');
});

t('빈 자리에 처음 적어도 줄이 생긴다', () => {
  const v = open({ uid: 'M' });
  assert.deepEqual(v.list, []);
  v.patch({ in: [], out: 'PART_R' });
  assert.equal(patched(v.saved).recipes.length, 1, '첫 레시피가 안 적힌다');
});

t('품종 수에 **뚜껑**이 있다', () => {
  assert.equal(Bom.MAX_KINDS, 4);
  assert.ok(inspSrc.includes('list.length < MAX_KINDS'), '한없이 더할 수 있다');
});

t('로트가 0이면 **안 바뀐다고 말해 준다**', () => {
  /* 품종을 둘 그려 놓고 로트를 안 정하면 첫 품종만 계속 나온다 — 도면에는
     둘이 적혀 있는데 라인에는 하나만 흐르니, 안 짚으면 못 찾는다 */
  assert.ok(inspSrc.includes('로트 크기가 0이라 품종이 안 바뀝니다'), '안 짚는다');
  assert.ok(inspSrc.includes('다음 품종으로 넘어갑니다'), '언제 바뀌는지 안 말한다');
});

t('설비를 바꾸면 **고른 품종도 처음으로** 돌아간다', () => {
  /* key 가 없으면 앞 설비에서 2번 품종을 보던 상태가 그대로 남아, 다른 설비를
     골랐는데 2번 품종이 열린다 — 그 설비에 2번이 없으면 더 헷갈린다 */
  assert.ok(inspSrc.includes('<RecipeSection key={placed.uid}'), '고른 품종이 설비를 따라 안 바뀐다');
});
