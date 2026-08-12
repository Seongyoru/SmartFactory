/* 버퍼 자리 나누기 — 교착이 **생길 수 없는지** 값으로 확인한다 */
import assert from 'node:assert/strict';
import { SRC, group, t } from './_harness.mjs';

group('버퍼 자리 나누기');

const bom = await import(SRC + 'core/bom.js');
const sim = await import(SRC + 'core/simStore.js');

/* 스크린샷의 그 설비: 제작품3 × 3 + 제작품1 × 3 → 조립품 2, 버퍼 200 */
const R = { in: [{ kind: 'PART_B', qty: 3 }, { kind: 'PART_R', qty: 3 }], out: 'ASM_M' };

t('비율대로 나눈다 — 3:3 이면 반반', () => {
  assert.deepEqual(bom.slotShares(R, 200), { PART_B: 100, PART_R: 100 });
});
t('2:1 이면 자리도 2:1 — 많이 먹는 쪽에 많이 준다', () => {
  const r = { in: [{ kind: 'PART_R', qty: 2 }, { kind: 'PART_G', qty: 1 }] };
  const s = bom.slotShares(r, 300);
  assert.equal(s.PART_R, 200);
  assert.equal(s.PART_G, 100);
  assert.equal(s.PART_R + s.PART_G, 300);      // 한 칸도 안 놀린다
});
t('내림으로 생긴 빈칸은 마지막 종류가 가져간다', () => {
  const r = { in: [{ kind: 'PART_R', qty: 1 }, { kind: 'PART_G', qty: 1 }, { kind: 'PART_B', qty: 1 }] };
  const s = bom.slotShares(r, 100);
  assert.equal(Object.values(s).reduce((a, b) => a + b, 0), 100);
});
t('공급원은 자리가 없다', () => {
  assert.deepEqual(bom.slotShares(null, 200), {});
  assert.deepEqual(bom.slotShares({ in: [], out: 'PART_R' }, 200), {});
});

/* ---------- 교착이 생길 수 있나 ---------- */
t('빠른 쪽이 아무리 밀어 넣어도 느린 쪽 자리를 못 먹는다', () => {
  sim.clearStock();
  const slots = bom.slotShares(R, 200);
  const slotsOf = (k) => slots[k] ?? 0;
  /* 제작품 3 이 1000개 밀려 들어온다 (제작품 1 은 아직 하나도 안 옴) */
  sim.addLotsShared('X', Array(1000).fill('PART_B'), slotsOf);
  const have = bom.countKinds(sim.getLots('X'));
  assert.equal(have.PART_B, 100, '제 몫만 채웠어야 한다');
  assert.equal(sim.getStock('X'), 100);
  /* 그리고 제작품 1 이 뒤늦게 와도 **자리가 있다** — 이게 핵심이다 */
  const { moved } = sim.addLotsShared('X', Array(100).fill('PART_R'), slotsOf);
  assert.equal(moved, 100);
  assert.equal(sim.getStock('X'), 200);
  /* 한 덩어리(3층)를 만들 재료가 있다 = 굶지 않는다 */
  assert.ok(bom.buildableCount(bom.countKinds(sim.getLots('X')), R) >= 3);
});
t('안 쓰는 종류는 한 개도 안 들어간다 (자리 0)', () => {
  sim.clearStock();
  const slots = bom.slotShares(R, 200);
  const { moved, left } = sim.addLotsShared('Y', Array(50).fill('PART_G'), (k) => slots[k] ?? 0);
  assert.equal(moved, 0);
  assert.equal(left.length, 50);              // 전부 못 넣었다 → 벨트가 선다
  assert.equal(sim.getStock('Y'), 0);
});
t('섞여 오면 넣을 수 있는 것만 넣고 나머지는 돌려준다 (카트)', () => {
  sim.clearStock();
  const slots = { PART_R: 2, PART_B: 1 };
  const { moved, left } = sim.addLotsShared('Z', ['PART_R', 'PART_G', 'PART_B', 'PART_R', 'PART_B'], (k) => slots[k] ?? 0);
  assert.equal(moved, 3);                                    // R 2개 + B 1개
  assert.deepEqual(left, ['PART_G', 'PART_B']);               // 안 쓰는 것 + 자리 찬 것
  assert.deepEqual(bom.countKinds(sim.getLots('Z')), { PART_R: 2, PART_B: 1 });
});

/**
 * 오래 돌려도 교착이 안 생기는지 — 빠른 쪽이 느린 쪽의 10배로 밀어 넣는
 * 상황을 1000번 되풀이한다. 예전 규칙(전체 수용량만 봄)이면 반드시 죽는다.
 */
t('10배로 밀어 넣어도 라인이 안 죽는다 (1000회)', () => {
  sim.clearStock();
  const slots = bom.slotShares(R, 200);
  const slotsOf = (k) => slots[k] ?? 0;
  const per = 3;
  let built = 0;
  for (let i = 0; i < 1000; i++) {
    sim.addLotsShared('W', Array(10).fill('PART_B'), slotsOf);   // 빠른 쪽
    sim.addLotsShared('W', Array(1).fill('PART_R'), slotsOf);    // 느린 쪽
    if (sim.takeEach('W', bom.needFor(R, per))) built++;
  }
  assert.ok(built > 100, `한 개도 못 만들었거나 너무 적다: ${built}`);
  /* 끝난 뒤에도 살아 있어야 한다 — 자리가 남아 있다 */
  const have = bom.countKinds(sim.getLots('W'));
  assert.ok((have.PART_B ?? 0) <= 100 && (have.PART_R ?? 0) <= 100);
});

t('옛 규칙(전체 수용량)이면 실제로 죽는다 — 나눈 이유', () => {
  /* 스크린샷의 그 상황을 그대로 재현한다: 빠른 종류 + **레시피가 안 쓰는 종류**가
     함께 들어오고, 안 쓰는 것은 영영 안 빠져 자리를 영구히 먹는다 */
  sim.clearStock();
  for (let i = 0; i < 1000; i++) {
    sim.addStock('V', 10, 200, 'PART_B');     // 빠른 재료
    sim.addStock('V', 2, 200, 'PART_G');      // 안 쓰는 것 (옛 벨트는 걸러 주지 않았다)
    sim.addStock('V', 1, 200, 'PART_R');      // 느린 재료
    sim.takeEach('V', bom.needFor(R, 3));
  }
  /* 버퍼가 꽉 찼고, 자리가 없으니 느린 재료는 **한 개도 더 못 들어온다** */
  assert.equal(sim.getStock('V'), 200);
  const before = sim.getLots('V').length;
  sim.addStock('V', 50, 200, 'PART_R');
  assert.equal(sim.getLots('V').length, before, '한 개도 못 들어간다');

  /* 가진 것으로 남은 몇 개를 만들고 나면 **영원히** 못 만든다 */
  let more = 0;
  while (sim.takeEach('V', bom.needFor(R, 3))) more++;
  assert.ok(more < 5, "가진 것으로 몇 개만 더 만들고 끝난다");
  /* 굶음 판정은 **한 덩어리(3개)** 기준이다 — 개수가 2 여도 덩어리는 못 만든다 */
  assert.ok(bom.buildableCount(bom.countKinds(sim.getLots("V")), R) < 3, "이제 한 덩어리도 못 만든다");
  /* 그런데 버퍼에는 아직 쓸모없는 것이 잔뜩 남아 있다 = 사람이 비워 주기 전엔 죽은 설비 */
  assert.ok(sim.getStock('V') > 0);
});

/* ---------- 버퍼가 작을 때 ---------- */
t('한 덩어리치가 안 들어가면 짚어 준다', () => {
  /* 3+3 을 3층씩 = 종류마다 9개씩 필요한데 버퍼가 10 이면 자리가 5씩뿐 */
  const tight = bom.tooSmallFor(R, 10, 3);
  assert.equal(tight.length, 2);
  assert.equal(tight[0].need, 9);
  assert.ok(tight[0].slots < 9);
});
t('넉넉하면 아무 말도 안 한다', () => {
  assert.deepEqual(bom.tooSmallFor(R, 200, 3), []);
  assert.deepEqual(bom.tooSmallFor(null, 10, 3), []);
});

/* ---------- 종류만 버리기 ---------- */
t('한 종류만 버리고 나머지는 그대로', () => {
  sim.clearStock();
  sim.addLots('D', ['PART_R', 'PART_G', 'PART_R', 'PART_B'], 100);
  assert.equal(sim.dropKind('D', 'PART_G'), 1);
  assert.deepEqual(sim.getLots('D'), ['PART_R', 'PART_R', 'PART_B']);
  assert.equal(sim.getStock('D'), 3);                   // 개수와 목록이 늘 같다
  assert.equal(sim.dropKind('D', 'PART_G'), 0);         // 없으면 아무 일도 없다
});

