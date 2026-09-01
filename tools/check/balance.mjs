/**
 * 라인 밸런싱 — 돌리기 전에 계산으로 나오는 천장
 * ---------------------------------------------------------------------------
 *  이 값은 「무엇을 늘릴까」 를 정하는 데 쓰인다. 틀리면 엉뚱한 설비를 사게
 *  만드므로, **레시피 비율**과 **묶음**을 특히 촘촘히 본다.
 */
import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('라인 능력');

const B = await import(SRC + 'core/balance.js');
const lib = await import(SRC + 'data/library.js');
const itemOf = (id) => lib.BUILTIN_LIBRARY.find((i) => i.id === id) ?? null;

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const M = 'MACHINE_1';
const A = 'MACHINE_2';

/** 제작기 둘 → 조립기 하나. 조립품 1개에 부품이 `qty` 개씩 들어간다 */
const line = ({ m1 = 3, m2 = 3, asm = 6, qty = 2 } = {}) => ({
  placed: [
    { uid: 'M1', itemId: M, name: '제작기1', pos: [0, 0], cycleSec: m1, recipe: { in: [], out: 'PART_R' } },
    { uid: 'M2', itemId: M, name: '제작기2', pos: [5, 0], cycleSec: m2, recipe: { in: [], out: 'PART_G' } },
    { uid: 'A1', itemId: A, name: '조립기1', pos: [10, 0], cycleSec: asm,
      recipe: { in: [{ kind: 'PART_R', qty }, { kind: 'PART_G', qty }], out: 'ASM_C' } },
  ],
  links: [
    { uid: 'B1', itemId: 'CONVEYOR', name: '벨트1', from: { uid: 'M1' }, to: { uid: 'A1' } },
    { uid: 'B2', itemId: 'CONVEYOR', name: '벨트2', from: { uid: 'M2' }, to: { uid: 'A1' } },
  ],
  carts: [],
  itemOf,
});
const rowOf = (r, name) => r.rows.find((x) => x.name === name);

t('**레시피 비율을 반영한다** — 그냥 견주면 조립기가 병목처럼 보인다', () => {
  /* 제작기 20개/분 · 조립기 10개/분. 조립품 1개에 부품 2개가 드니 셋은 균형이다.
     자기 능력만 비교하면 조립기를 늘리라고 하게 되는데, 그러면 아무것도 안 오른다. */
  const r = B.lineBalance(line({ m1: 3, m2: 3, asm: 6, qty: 2 }));
  near(rowOf(r, '제작기1').own, 20);
  near(rowOf(r, '제작기1').mult, 2, 1e-9);
  near(rowOf(r, '제작기1').capacity, 10);
  near(rowOf(r, '조립기1').capacity, 10);
  near(r.capacity, 10);
});
t('비율이 바뀌면 환산도 바뀐다', () => {
  const one = B.lineBalance(line({ qty: 1 }));
  near(rowOf(one, '제작기1').capacity, 20, 1e-9);   // 1:1 이면 배수 1
  const four = B.lineBalance(line({ qty: 4 }));
  near(rowOf(four, '제작기1').capacity, 5, 1e-9);
});
t('벨트도 같은 단위로 선다 — 실어 나르지 못하면 그것이 천장이다', () => {
  const r = B.lineBalance(line());
  const b = rowOf(r, '벨트1');
  assert.ok(b, '벨트가 목록에 없다');
  near(b.mult, 2, 1e-9);
  assert.ok(b.capacity > 0);
});
t('**쌓는 곳은 능력이 아니다** — 늘려도 정상 상태 처리량은 그대로다', () => {
  /* 적치대가 가득 찬 것은 「작다」 가 아니라 「비우는 쪽이 느리다」 는 뜻이다.
     목록에 넣으면 적치대를 늘리라는 잘못된 처방이 나온다. */
  const d = line();
  d.placed.push({ uid: 'S1', itemId: 'STILLAGE', name: '적치대1', pos: [20, 0] });
  d.placed.push({ uid: 'H1', itemId: 'SHELF', name: '선반1', pos: [25, 0] });
  const r = B.lineBalance(d);
  assert.equal(r.rows.some((x) => /적치대|선반/.test(x.name)), false, '쌓는 곳이 능력으로 들어갔다');
});

/* ---------- 「이걸 풀면 그다음은?」 ---------------------------------------- */

const uneven = B.lineBalance(line({ m1: 3, m2: 6, asm: 4 }));
const chain = B.bottleneckChain(uneven.rows);

t('같은 능력끼리 **묶는다** — 하나만 고치면 하나도 안 오른다', () => {
  /* 제작기2(5개/분) 뒤에 벨트2 가 같은 5개/분으로 서 있다. 하나씩 늘어놓으면
     「제작기2 → +0.0」 이라는 작은 글씨가 되는데, 묶으면 「둘을 함께」 가 보인다. */
  assert.deepEqual(chain[0].items.map((x) => x.name).sort(), ['벨트2', '제작기2']);
  near(chain[0].capacity, 5);
  near(chain[0].then, 10);
  near(chain[0].gain, 5);
});
t('마지막 묶음은 **천장**이다 — 오름폭이 무한대가 아니다', () => {
  const last = chain[chain.length - 1];
  assert.equal(last.last, true);
  assert.equal(last.then, null, '천장 뒤에 다음이 있는 척한다');
  assert.equal(last.gain, null);
});
t('묶음 순서는 느린 것부터', () => {
  const caps = chain.map((g) => g.capacity);
  assert.deepEqual(caps, [...caps].sort((a, b) => a - b));
});
t('모두 같은 능력이면 **한 묶음** — 그중 하나를 짚는 것은 진단이 아니라 뽑기다', () => {
  const rows = [
    { uid: 'a', name: 'A', capacity: 10 },
    { uid: 'b', name: 'B', capacity: 10 },
    { uid: 'c', name: 'C', capacity: 10.05 },   // 1% 안 — 같은 고리로 본다
  ];
  assert.equal(B.bottleneckChain(rows).length, 1);
  assert.equal(B.isBalanced(rows), true);
  assert.equal(B.isBalanced([...rows, { uid: 'd', name: 'D', capacity: 20 }]), false);
});
t('빈 도면도 터지지 않는다', () => {
  const r = B.lineBalance({ itemOf });
  assert.deepEqual(r.rows, []);
  assert.equal(r.capacity, 0);
  assert.equal(r.neck, null);
  assert.deepEqual(B.bottleneckChain([]), []);
});
t('고리가 있어도 멈추지 않는다', () => {
  /* A → B → A. 배수를 따라 내려가다 무한히 돌 수 있어 지나온 곳에서 끊는다 */
  const d = {
    placed: [
      { uid: 'X', itemId: M, name: 'X', pos: [0, 0], cycleSec: 3, recipe: { in: [{ kind: 'PART_G', qty: 1 }], out: 'PART_R' } },
      { uid: 'Y', itemId: M, name: 'Y', pos: [5, 0], cycleSec: 3, recipe: { in: [{ kind: 'PART_R', qty: 1 }], out: 'PART_G' } },
    ],
    links: [
      { uid: 'L1', itemId: 'CONVEYOR', name: 'L1', from: { uid: 'X' }, to: { uid: 'Y' } },
      { uid: 'L2', itemId: 'CONVEYOR', name: 'L2', from: { uid: 'Y' }, to: { uid: 'X' } },
    ],
    carts: [], itemOf,
  };
  const r = B.lineBalance(d);
  assert.ok(r.rows.length >= 2, '고리에서 멈췄다');
  assert.ok(Number.isFinite(r.capacity));
});
t('읽는 문구 — 작은 값은 소수 한 자리까지', () => {
  assert.equal(B.rateText(5), '5.0 개/분');
  assert.equal(B.rateText(120.4), '120 개/분');
  assert.equal(B.rateText(0), '0 개/분');
  assert.equal(B.rateText(Infinity), '제한 없음');
});

/* ---------- 배선 ----------------------------------------------------------- */

const inspector = await readSrc('ui/Inspector.jsx');
t('배치하는 동안 보인다 — 「이번 실행」과 다른 자리다', () => {
  assert.ok(inspector.includes('<LineCapacity />'), '화면에 안 붙어 있다');
  assert.ok(/lineBalance\(\{/.test(inspector), '계산을 안 부른다');
  assert.ok(/bottleneckChain\(bal\.rows\)/.test(inspector), '묶음을 안 쓴다');
});
t('가장 약한 고리가 여럿이면 **그 사실을 말한다**', () => {
  assert.ok(/chain\[0\]\?\.items\.length > 1/.test(inspector), '하나만 고쳐도 되는 것처럼 보인다');
  assert.ok(/하나만 고치면 하나도 안 오릅니다/.test(inspector), '경고 문구가 없다');
});

/* ---------- 배수가 **모든 산출 종류**를 본다 -------------------------------- *
 *  배수를 세는 걸음이 `outputKindOf` 하나만 봤다 — **첫 레시피의 산출**이다.
 *  그러면 제작품 1·2 를 만드는 설비가 제작품 **2** 를 먹는 조립기에 물려 있을 때
 *  그 수요가 통째로 안 보이고 배수가 1 로 남는다. 하류가 두 개씩 먹는데도
 *  「최종 1개당 1개」로 세어 **천장이 두 배 부푼다.**
 *
 *  **규칙과 무관한 별개 버그다** — 차례대로에서도 부푼다.
 * -------------------------------------------------------------------------- */

/** 한 설비가 두 품종을 내고, 조립기는 **둘째 것만** 먹는다 */
const secondOnly = (recipes) => ({
  placed: [
    { uid: 'P1', itemId: M, name: '제작기', pos: [0, 0], cycleSec: 3, recipes },
    { uid: 'A1', itemId: A, name: '조립기', pos: [6, 0], cycleSec: 6,
      recipes: [{ out: 'ASM_Y', in: [{ kind: 'PART_G', qty: 2 }] }] },
  ],
  links: [{ uid: 'B1', itemId: 'CONVEYOR', name: '벨트', from: { uid: 'P1' }, to: { uid: 'A1' } }],
  carts: [],
  itemOf,
});

t('**둘째 품종을 먹는 하류도 배수에 든다**', () => {
  const two = B.lineBalance(secondOnly([{ out: 'PART_R', in: [] }, { out: 'PART_G', in: [] }]));
  const p = rowOf(two, '제작기');
  assert.equal(p.mult, 2, `배수 ${p.mult} — 첫 레시피만 보고 있다`);
});

t('단품종이면 예전과 같다 — 이 고침이 흔한 도면을 안 건드린다', () => {
  const one = B.lineBalance(secondOnly([{ out: 'PART_G', in: [] }]));
  assert.equal(rowOf(one, '제작기').mult, 2);
});

t('배수가 천장을 실제로 낮춘다 — 세기만 하고 안 쓰면 헛일이다', () => {
  /* 배수가 1 이면 천장이 두 배로 부푼다. 그 부풀림이 라인 천장까지 간다 */
  const two = B.lineBalance(secondOnly([{ out: 'PART_R', in: [] }, { out: 'PART_G', in: [] }]));
  const p = rowOf(two, '제작기');
  near(p.capacity, p.own / p.mult);
  assert.ok(two.capacity <= p.own, '배수를 안 나눈 값이 라인 천장이 됐다');
});

t('아무도 안 먹으면 배수는 1 — 최종 공정', () => {
  const alone = {
    placed: [{ uid: 'P1', itemId: M, name: '제작기', pos: [0, 0], cycleSec: 3, recipes: [{ out: 'PART_R', in: [] }] }],
    links: [], carts: [], itemOf,
  };
  assert.equal(rowOf(B.lineBalance(alone), '제작기').mult, 1);
});
