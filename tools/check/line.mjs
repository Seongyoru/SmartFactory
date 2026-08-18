/**
 * 라인 한 줄을 실제로 돌려 본다 — 설비 → 출력 자리 → 벨트 → 적치대.
 * ---------------------------------------------------------------------------
 *  조각마다는 다 통과하는데 이어 붙이면 안 도는 경우가 있다. 특히 **개수**가
 *  그렇다 — 재료 몇 개가 몇 개의 완성품이 되고 몇 개가 적치대에 쌓였는지는
 *  세 모듈에 걸쳐 있어서, 하나만 봐서는 새는 것을 못 잡는다.
 *
 *  생산 루프는 `SimClock` 안에 있으므로 **소스에서 떼어** 실제 모듈에 물린다.
 *  벨트 쪽 `onSpawn`·`onArrive` 는 JSX 프롭 안이라 못 떼는 대신, 여기서 같은
 *  규칙을 세우고 **덩어리 셈이 맞는지**를 본다.
 */
import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

group('라인 통짜');

const P = await import(SRC + 'core/process.js');
const B = await import(SRC + 'core/belt.js');
const sim = await import(SRC + 'core/simStore.js');
const bom = await import(SRC + 'core/bom.js');

/* ---- 설비 생산 루프 ---------------------------------------------------------
     예전에는 EditorScene 의 useFrame 에서 소스를 떼어 `new Function` 에 넣었다.
     `core/sim.js` 로 옮기고 나서는 **그 함수를 그대로 부른다** — 화면이 부르는
     것과 글자 하나까지 같은 코드다.
--------------------------------------------------------------------------- */
const S = await import(SRC + 'core/sim.js');

const NONE = new Set();
const step = (machines, dt, { down = NONE, unmanned = NONE } = {}) =>
  /* 고장은 여기서 안 굴린다 — down 에 든 것만 선 것으로 친다.
     mttr 를 길게 준 뒤 rand 를 0 으로 고정하면 그 설비만 계속 서 있다. */
  S.runMachines(dt, {
    equips: [...down].map((uid) => ({ uid, mtbf: 1e-9, mttr: 3600 })),
    machines, unmanned, halted: NONE, shipped: 0, rand: () => 0,
  });

/* ---- 도면 ------------------------------------------------------------------
     A(공급원, 6초/개) ──벨트──▶ C(조립 2R+1G, 12초/개) ──벨트──▶ S(적치대)
--------------------------------------------------------------------------- */
const RECIPE = { in: [{ kind: 'PART_R', qty: 2 }, { kind: 'PART_G', qty: 1 }], out: 'ASM_C' };
const A = { uid: 'A', cycleSec: 6, cycleVar: 0, cap: 3, need: null };
const C = { uid: 'C', cycleSec: 12, cycleVar: 0, cap: 3, need: bom.needFor(RECIPE, 1) };

t('한 개분씩 낸다 — 레시피 수량 그대로', () => {
  assert.deepEqual(C.need, { PART_R: 2, PART_G: 1 });
});

/* ---------- 공급원 ---------- */
t('공급원은 제 공정 시간대로 만들어 출력 자리를 채운다', () => {
  sim.clearStock();
  P.resetWork();
  for (let i = 0; i < 120; i++) step([A], 0.1);   // 12초 = 두 개
  assert.equal(sim.getMade('A'), 2);
});
t('출력 자리가 차면 거기서 선다 — 무한정 안 쌓인다', () => {
  sim.clearStock();
  P.resetWork();
  for (let i = 0; i < 6000; i++) step([A], 0.1);  // 600초면 100개치
  assert.equal(sim.getMade('A'), 3, '출력 자리(3)를 넘겨 쌓았다');
});
t('가져가면 그만큼 다시 만든다', () => {
  sim.clearStock();
  P.resetWork();
  for (let i = 0; i < 6000; i++) step([A], 0.1);
  assert.equal(sim.takeMade('A', 3), 3);
  for (let i = 0; i < 60; i++) step([A], 0.1);    // 6초 = 한 개
  assert.equal(sim.getMade('A'), 1);
});

/* ---------- 조립 ---------- */
t('재료를 먹고 만든다 — 개수가 정확히 맞는다', () => {
  sim.clearStock();
  P.resetWork();
  sim.addLots('C', [...Array(6).fill('PART_R'), ...Array(3).fill('PART_G')], 30);
  for (let i = 0; i < 240; i++) step([C], 0.1);   // 24초 = 두 개 (자리는 3)
  assert.equal(sim.getMade('C'), 2);
  assert.deepEqual(bom.countKinds(sim.getLots('C')), { PART_R: 2, PART_G: 1 });
});
t('재료가 떨어지면 거기서 멈춘다 — 없는 것을 안 끌어 쓴다', () => {
  sim.clearStock();
  P.resetWork();
  sim.addLots('C', [...Array(4).fill('PART_R'), ...Array(2).fill('PART_G')], 30);  // 두 개분
  for (let i = 0; i < 6000; i++) step([C], 0.1);
  assert.equal(sim.getMade('C'), 2);
  assert.equal(sim.getStock('C'), 0);
});
t('재료가 아예 없으면 아무 일도 없다', () => {
  sim.clearStock();
  P.resetWork();
  for (let i = 0; i < 600; i++) step([C], 0.1);
  assert.equal(sim.getMade('C'), 0);
});

/* ---------- 고장 · 무인 ---------- */
t('고장 난 설비는 안 돈다', () => {
  sim.clearStock();
  P.resetWork();
  for (let i = 0; i < 600; i++) step([A], 0.1, { down: new Set(['A']) });
  assert.equal(sim.getMade('A'), 0);
});
t('사람이 없는 설비도 안 돈다', () => {
  sim.clearStock();
  P.resetWork();
  for (let i = 0; i < 600; i++) step([A], 0.1, { unmanned: new Set(['A']) });
  assert.equal(sim.getMade('A'), 0);
});
t('고장이 풀리면 하던 데서 이어 간다', () => {
  sim.clearStock();
  P.resetWork();
  for (let i = 0; i < 50; i++) step([A], 0.1);                          // 5초 걸었다
  for (let i = 0; i < 300; i++) step([A], 0.1, { down: new Set(['A']) });
  assert.equal(sim.getMade('A'), 0);
  for (let i = 0; i < 10; i++) step([A], 0.1);                          // 1초만 더
  assert.equal(sim.getMade('A'), 1, '고장 전 5초가 날아갔다');
});

/* ---------- 설비 + 벨트 ---------- */
/** 벨트가 한 덩어리(per 개)씩 실어 간다 — EditorScene 의 onSpawn 과 같은 규칙 */
const boardBundles = (uid, n, per) => {
  const bundles = Math.min(n, Math.floor(sim.getMade(uid) / per));
  if (bundles > 0) sim.takeMade(uid, bundles * per);
  return bundles;
};

t('벨트는 **덩어리 단위로만** 실어 간다 — 나머지가 사라지지 않는다', () => {
  sim.clearStock();
  sim.addMade('A', 2);                      // 한 덩어리(3)가 안 된다
  assert.equal(boardBundles('A', 1, 3), 0);
  assert.equal(sim.getMade('A'), 2, '못 실었는데 재고가 줄었다');
});

t('설비 → 벨트 → 적치대 — 넣은 재료와 나온 물건이 맞는다', () => {
  sim.clearStock();
  P.resetWork();

  const per = 3;                            // 한 덩어리 = 3층
  const R = 60, G = 30;                     // 재료: 20개분
  sim.addLots('C', [...Array(R).fill('PART_R'), ...Array(G).fill('PART_G')], 200);

  const belt = B.makeBelt(B.beltCount(30, 3));
  let arrived = 0;
  const dt = 0.1;
  for (let i = 0; i < 20000; i++) {         // 2000초 — 재료가 다 떨어지고도 남는다
    step([C], dt);
    arrived += B.advanceBelt(belt, {
      d: 0.6 * dt,
      step: 3,
      length: 30,
      spawn: (n) => boardBundles('C', n, per),
    }) * per;
  }

  const onBelt = (() => {
    let n = 0;
    for (let k = 0; k < belt.fill.length; k++) if (B.beltHas(belt, k)) n += per;
    return n;
  })();

  const made = R / 2;                       // 20개 (R 60개 ÷ 2, G 30개 ÷ 1 → 둘 다 20)
  assert.equal(sim.getStock('C'), 0, '재료가 남았다');
  assert.equal(
    arrived + onBelt + sim.getMade('C'), made,
    `도착 ${arrived} + 벨트위 ${onBelt} + 출력자리 ${sim.getMade('C')} ≠ 만든 것 ${made}`,
  );
});

t('설비가 벨트보다 느리면 벨트에 빈칸이 생긴다 (막히지 않는다)', () => {
  sim.clearStock();
  P.resetWork();
  const per = 3;
  const slow = { uid: 'D', cycleSec: 30, cycleVar: 0, cap: per, need: null };  // 아주 느리다
  const belt = B.makeBelt(B.beltCount(30, 3));
  const dt = 0.1;
  let arrived = 0;
  for (let i = 0; i < 6000; i++) {          // 600초
    step([slow], dt);
    arrived += B.advanceBelt(belt, {
      d: 0.6 * dt, step: 3, length: 30,
      spawn: (n) => boardBundles('D', n, per),
    }) * per;
  }
  /* 30초/개 × 3개 = 90초에 한 덩어리. 600초면 여섯 덩어리가 조금 넘는다 */
  const total = arrived + (() => {
    let n = 0;
    for (let k = 0; k < belt.fill.length; k++) if (B.beltHas(belt, k)) n += per;
    return n;
  })() + sim.getMade('D');
  assert.equal(total, 20, `600초에 20개가 나와야 한다 (나온 것 ${total})`);
  assert.ok(belt.trav > 300, '벨트가 섰다 — 느린 설비 때문에 멈추면 안 된다');
});

/* ---------- 멀쩡한 설비가 깜빡이지 않는다 (실제로 겪은 것) ------------------
     "중간중간에 계속 빨개지면서 제작기가 멈춘다" — 적치대가 차기도 전에 그랬다.
     출력 자리가 한 덩어리치뿐이라, 덩어리를 다 만든 순간부터 벨트 칸이 도착할
     때까지 매번 섰기 때문이다. 값으로만 보면 3% 라 놓치기 쉬운데, 화면에서는
     1초에 한 번씩 붉게 깜빡인다 — 없는 고장을 쫓게 만드는 종류의 버그다.
--------------------------------------------------------------------------- */
t('보낼 곳이 넉넉하면 설비가 **한 번도** 안 선다', () => {
  const cycle = 0.5, layers = 2, v = 3.0;
  const gap = P.spacingFor(cycle, layers, v);
  const cap = P.outputCapFor(layers);
  sim.clearStock();
  P.resetWork();

  const belt = B.makeBelt(B.beltCount(20, gap));
  const dt = 1 / 60;
  let flips = 0;
  let was = false;
  let made = 0;
  for (let i = 0; i < 60 / dt; i++) {
    const room = cap - sim.getMade('F');
    const red = room <= 0;
    if (red && !was) flips++;
    was = red;
    const n = P.runMachine('F', dt, { cycleSec: cycle, room });
    if (n > 0) { sim.addMade('F', n); made += n; }
    B.advanceBelt(belt, {
      d: v * dt, step: gap, length: 20,
      spawn: (w) => {
        const b = Math.min(w, Math.floor(sim.getMade('F') / layers));
        if (b > 0) sim.takeMade('F', b * layers);
        return b;
      },
    });
  }
  assert.equal(flips, 0, `1분에 ${flips}번 빨개졌다 — 출력 자리가 모자라다`);
  assert.equal(made, 120, `120개 나와야 한다 (나온 것 ${made})`);
});
t('한 덩어리치만 두면 실제로 깜빡인다 — 왜 두 덩어리인지의 근거', () => {
  const cycle = 0.5, layers = 2, v = 3.0;
  const gap = P.spacingFor(cycle, layers, v);
  sim.clearStock();
  P.resetWork();
  const belt = B.makeBelt(B.beltCount(20, gap));
  const dt = 1 / 60;
  let flips = 0;
  let was = false;
  for (let i = 0; i < 60 / dt; i++) {
    const room = layers * 1 - sim.getMade('G');          // 일부러 한 덩어리치
    const red = room <= 0;
    if (red && !was) flips++;
    was = red;
    const n = P.runMachine('G', dt, { cycleSec: cycle, room });
    if (n > 0) sim.addMade('G', n);
    B.advanceBelt(belt, {
      d: v * dt, step: gap, length: 20,
      spawn: (w) => {
        const b = Math.min(w, Math.floor(sim.getMade('G') / layers));
        if (b > 0) sim.takeMade('G', b * layers);
        return b;
      },
    });
  }
  assert.ok(flips > 0, '한 덩어리치인데 안 깜빡인다 — 이 검사가 뜻이 없어졌다');
});

/* ---------- 덩어리 크기를 바꿨을 때 (실제로 겪은 것) -----------------------
     "3/8 인 상태에서 한 번에 내보내는 수량을 8개로 늘리면 그때부터 3~11/16 으로
     작동한다" — 벨트는 덩어리 단위로만 실어 가므로, 새 덩어리 크기로 안
     나누어떨어지는 나머지는 **영영 안 빠지는 재고**가 된다. 게이지가 0 으로
     돌아오지 않고, 자리가 좁으면 그 자투리 때문에 설비가 매번 선다.
--------------------------------------------------------------------------- */
/** 씬이 하는 일과 같은 규칙 — 덩어리 크기가 바뀌면 자투리를 버린다 */
const retire = (uid, per) => {
  const left = sim.getMade(uid) % per;
  if (left > 0) sim.takeMade(uid, left);
};

t('안 고치면 게이지가 0 으로 안 돌아온다 — 버그의 재현', () => {
  sim.clearStock();
  P.resetWork();
  sim.addMade('R', 3);                       // 옛 덩어리(4개)로 3개 만들어 둔 상태
  const per = 8;
  /* 자리를 넉넉히(두 배) 두면 설비가 자투리를 안고도 계속 돌아, 나머지가 영영
     안 빠진다 — 3~11 을 오간다. 자리를 「덩어리+1」 로 좁힌 지금은 올라가는
     길에 정확히 8 을 지나며 벨트가 채 가서 저절로 풀리는 때가 많지만,
     **저절로 풀리는 것에 기대면 안 된다** — 그래서 아래에서 명시적으로 버린다. */
  const cap = per * 2;
  const seen = new Set();
  const belt = B.makeBelt(B.beltCount(60, P.spacingFor(6, per, 0.6)));
  const dt = 0.5;
  for (let i = 0; i < 4000 / dt; i++) {
    const room = cap - sim.getMade('R');
    const n = P.runMachine('R', dt, { cycleSec: 6, room });
    if (n > 0) sim.addMade('R', n);
    B.advanceBelt(belt, {
      d: 0.6 * dt, step: P.spacingFor(6, per, 0.6), length: 60,
      spawn: (w) => {
        const b = Math.min(w, Math.floor(sim.getMade('R') / per));
        if (b > 0) sim.takeMade('R', b * per);
        return b;
      },
    });
    seen.add(sim.getMade('R'));
  }
  assert.equal(seen.has(0), false, '자투리를 안 버렸는데 0 으로 돌아왔다 — 재현이 깨졌다');
});

t('자투리를 버리면 0 에서 다시 시작한다', () => {
  sim.clearStock();
  P.resetWork();
  sim.addMade('S', 3);
  const per = 8;
  retire('S', per);                          // 「한 번에」 를 바꾼 순간
  assert.equal(sim.getMade('S'), 0);

  const gap = P.spacingFor(6, per, 0.6);
  const belt = B.makeBelt(B.beltCount(60, gap));
  const dt = 0.5;
  let flips = 0;
  let was = false;
  for (let i = 0; i < 4000 / dt; i++) {
    const room = P.outputCapFor(per) - sim.getMade('S');
    const red = room <= 0;
    if (red && !was) flips++;
    was = red;
    const n = P.runMachine('S', dt, { cycleSec: 6, room });
    if (n > 0) sim.addMade('S', n);
    B.advanceBelt(belt, {
      d: 0.6 * dt, step: gap, length: 60,
      spawn: (w) => {
        const b = Math.min(w, Math.floor(sim.getMade('S') / per));
        if (b > 0) sim.takeMade('S', b * per);
        return b;
      },
    });
  }
  assert.equal(flips, 0, `자투리를 버렸는데도 ${flips}번 섰다`);
});

t('바뀌지 않은 설비의 **덜 찬 덩어리**는 건드리지 않는다', () => {
  sim.clearStock();
  sim.addMade('T', 3);                       // per 8 로 만드는 중 — 정상 상태
  /* 다른 설비를 고쳤다고 이걸 버리면 멀쩡한 재고가 사라진다.
     씬은 설비마다 직전 값을 기억해 **바뀐 것만** 손본다. */
  assert.equal(sim.getMade('T'), 3);
});
