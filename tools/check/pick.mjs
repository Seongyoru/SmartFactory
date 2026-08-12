/* 카트가 여러 종류를 고르는 것 — pickSet 과 takeLots(집합) */
import assert from 'node:assert/strict';
import { SRC, group, t } from './_harness.mjs';

group('카트 복수 선택');

const cart = await import(SRC + 'core/cart.js');
const sim = await import(SRC + 'core/simStore.js');
const bom = await import(SRC + 'core/bom.js');

const S = (...k) => new Set(k);

/* ---------- pickSet ---------- */
t('아무것도 안 고르면 빈 집합 = 가리지 않는다', () => {
  assert.equal(cart.pickSet(null).size, 0);
  assert.equal(cart.pickSet({}).size, 0);
  assert.equal(cart.pickSet({ pickKinds: [] }).size, 0);
});
t('여러 개를 고른다', () => {
  const p = cart.pickSet({ pickKinds: ['PART_R', 'PART_B'] });
  assert.deepEqual([...p].sort(), ['PART_B', 'PART_R']);
});
t('옛 도면의 pickKind(하나짜리)도 읽는다', () => {
  assert.deepEqual([...cart.pickSet({ pickKind: 'PART_G' })], ['PART_G']);
  /* 옛 종류 이름까지 — OBJ2 는 지금 제작품 2 다 */
  assert.deepEqual([...cart.pickSet({ pickKind: 'OBJ2' })], ['PART_G']);
  assert.deepEqual([...cart.pickSet({ pickKinds: ['OBJ', 'OBJ3'] })].sort(), ['ASM_C', 'PART_R']);
});
t('모르는 이름은 떨군다', () => {
  assert.deepEqual([...cart.pickSet({ pickKinds: ['NOPE', 'PART_R'] })], ['PART_R']);
});
t('새 필드가 있으면 그쪽이 이긴다', () => {
  const p = cart.pickSet({ pickKinds: ['PART_B'], pickKind: 'PART_R' });
  assert.deepEqual([...p], ['PART_B']);
  /* 빈 배열도 "고르지 않음" 이라는 뜻이므로 옛 값이 되살아나면 안 된다 */
  assert.equal(cart.pickSet({ pickKinds: [], pickKind: 'PART_R' }).size, 0);
});

/* ---------- takeLots (집합) ---------- */
t('가리지 않으면 위에서부터 아무거나', () => {
  sim.clearStock();
  sim.addLots('A', ['PART_R', 'PART_G', 'PART_B'], 10);
  assert.deepEqual(sim.takeLots('A', 2, null), ['PART_G', 'PART_B']);
  assert.deepEqual(sim.takeLots('A', 5, new Set()), ['PART_R']);   // 빈 집합도 안 가린다
});
t('고른 종류들만 골라 온다', () => {
  sim.clearStock();
  sim.addLots('B', ['PART_R', 'PART_G', 'PART_B', 'PART_R', 'PART_G'], 10);
  const got = sim.takeLots('B', 10, S('PART_R', 'PART_B'));
  assert.deepEqual(bom.countKinds(got), { PART_R: 2, PART_B: 1 });
  assert.deepEqual(sim.getLots('B'), ['PART_G', 'PART_G']);       // 나머지는 순서 그대로
});
t('요청한 개수까지만 — 위에서부터', () => {
  sim.clearStock();
  sim.addLots('C', ['PART_R', 'PART_G', 'PART_R', 'PART_B', 'PART_R'], 10);
  const got = sim.takeLots('C', 2, S('PART_R'));
  assert.deepEqual(got, ['PART_R', 'PART_R']);
  assert.equal(sim.getStock('C'), 3);
  /* 아래쪽 PART_R 하나가 남아 있어야 한다 (위에서부터 둘만 가져갔으므로) */
  assert.deepEqual(bom.countKinds(sim.getLots('C')), { PART_R: 1, PART_G: 1, PART_B: 1 });
});
t('고른 것이 하나도 없으면 아무것도 안 가져간다', () => {
  sim.clearStock();
  sim.addLots('D', ['PART_G', 'PART_G'], 10);
  assert.deepEqual(sim.takeLots('D', 5, S('PART_R', 'PART_B')), []);
  assert.equal(sim.getStock('D'), 2);                             // 재고는 그대로
});
t('개수와 목록이 늘 같다', () => {
  sim.clearStock();
  sim.addLots('E', ['PART_R', 'PART_G', 'PART_R'], 10);
  sim.takeLots('E', 1, S('PART_R'));
  assert.equal(sim.getStock('E'), sim.getLots('E').length);
});

/**
 * 왜 여러 개를 고를 수 있어야 하나 — 조립 설비 하나가 재료를 둘 먹는 상황.
 * 한 종류만 고를 수 있으면 카트 한 대로는 절반밖에 못 나른다.
 */
t('한 바퀴에 두 재료를 다 실어 온다', () => {
  sim.clearStock();
  sim.addLots('SHELF', ['PART_R', 'PART_B', 'PART_R', 'PART_B', 'PART_R', 'PART_B'], 20);

  /* 옛 방식: 한 종류만 → 세 개를 실어도 전부 같은 것이라 조립을 못 한다 */
  const one = sim.takeLots('SHELF', 3, S('PART_R'));
  assert.deepEqual(bom.countKinds(one), { PART_R: 3 });

  /* 새 방식: 둘 다 고르면 섞어 온다 */
  sim.clearStock();
  sim.addLots('SHELF', ['PART_R', 'PART_B', 'PART_R', 'PART_B', 'PART_R', 'PART_B'], 20);
  const both = sim.takeLots('SHELF', 4, S('PART_R', 'PART_B'));
  const c = bom.countKinds(both);
  assert.ok(c.PART_R > 0 && c.PART_B > 0, `섞여 오지 않았다: ${JSON.stringify(c)}`);
  assert.equal(both.length, 4);
});

