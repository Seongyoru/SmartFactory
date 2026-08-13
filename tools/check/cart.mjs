/* cart.js — 차간 간격(followDistance) · 수용 판정(fleetFits) · stepCart 와의 합 */
import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('카트 간격 · 수용');

const cart = await import(SRC + 'core/cart.js');
const { followDistance, fleetFits, stepCart, CART_MARGIN } = cart;
const C = cart;

const L = 100;
const GAP = 3;

/* ---------- followDistance ---------- */
t('앞이 비면 무제한', () => {
  assert.equal(followDistance({ s: 10, dir: 1 }, [], { length: L, closed: false, gap: GAP }), Infinity);
});
t('뒤에 있는 차는 안 막는다', () => {
  const me = { s: 50, dir: 1 };
  const room = followDistance(me, [{ s: 20, dir: 1 }], { length: L, closed: false, gap: GAP });
  assert.equal(room, Infinity);
});
t('앞차까지 거리에서 간격을 뺀 만큼', () => {
  const me = { s: 50, dir: 1 };
  assert.equal(followDistance(me, [{ s: 60, dir: 1 }], { length: L, closed: false, gap: GAP }), 7);
});
t('이미 붙었으면 0 (음수로 새지 않는다)', () => {
  const me = { s: 50, dir: 1 };
  assert.equal(followDistance(me, [{ s: 51, dir: 1 }], { length: L, closed: false, gap: GAP }), 0);
});
t('역방향도 같은 규칙 — 앞은 s 가 작은 쪽', () => {
  const me = { s: 50, dir: -1 };
  assert.equal(followDistance(me, [{ s: 40, dir: -1 }], { length: L, closed: false, gap: GAP }), 7);
  assert.equal(followDistance(me, [{ s: 60, dir: -1 }], { length: L, closed: false, gap: GAP }), Infinity);
});
t('마주 오는 차는 막지 않는다 (왕복 교착 방지)', () => {
  const me = { s: 50, dir: 1 };
  assert.equal(followDistance(me, [{ s: 52, dir: -1 }], { length: L, closed: false, gap: GAP }), Infinity);
});
t('고리에서는 감아서 잰다', () => {
  const me = { s: 95, dir: 1 };
  // 5 앞에 있는 차 → 앞으로 10m
  assert.equal(followDistance(me, [{ s: 5, dir: 1 }], { length: L, closed: true, gap: GAP }), 7);
  // 고리에서는 "뒤" 가 없다 — 90 은 앞으로 95m
  assert.equal(followDistance(me, [{ s: 90, dir: 1 }], { length: L, closed: true, gap: GAP }), 95 - GAP);
});
t('가장 가까운 앞차가 정한다', () => {
  const me = { s: 0, dir: 1 };
  const room = followDistance(me, [{ s: 40, dir: 1 }, { s: 10, dir: 1 }, { s: 70, dir: 1 }],
    { length: L, closed: false, gap: GAP });
  assert.equal(room, 7);
});
t('자기 자신은 건너뛴다', () => {
  const me = { s: 10, dir: 1 };
  assert.equal(followDistance(me, [me], { length: L, closed: false, gap: GAP }), Infinity);
  // 같은 자리에 있는 다른 차도 (간격 0) 앞으로 치지 않는다 — 뒤로 본다
  assert.equal(followDistance(me, [{ s: 10, dir: 1 }], { length: L, closed: false, gap: GAP }), Infinity);
});
t('빈 칸(사라진 차)이 섞여 있어도 넘어간다', () => {
  const me = { s: 10, dir: 1 };
  const room = followDistance(me, [undefined, null, { s: 20, dir: 1 }], { length: L, closed: false, gap: GAP });
  assert.equal(room, 7);
});

/* ---------- fleetFits ---------- */
t('한 대는 언제나 들어간다', () => {
  assert.equal(fleetFits(1, 1, 10).fits, true);
});
t('대수 × 간격이 경로보다 길면 못 돈다', () => {
  assert.equal(fleetFits(20, 4, 6).fits, false);      // 24 > 20
  assert.equal(fleetFits(30, 4, 6).fits, true);       // 24 < 30
  assert.equal(fleetFits(24, 4, 6).fits, false);      // 딱 맞으면 서로 닿는다
  assert.equal(fleetFits(20, 4, 6).need, 24);
});

/* ---------- stepCart 와의 합 ---------- */
const OPT = { length: L, closed: true, oneWay: false, dwell: 1.2 };
t('속도를 0 으로 깎으면 제자리에 선다', () => {
  const r = stepCart({ s: 50, dir: 1, pause: 0, lastKey: null }, { ...OPT, speed: 0 }, [], 0.1);
  assert.equal(r.s, 50);
  assert.equal(r.dir, 1);
  assert.equal(r.arrived, null);
});
t('깎인 속도로도 지나친 역은 정확히 잡는다', () => {
  const stations = [{ s: 50.5, kind: 'load', uid: 'A', key: 'A' }, { s: 55, kind: 'load', uid: 'B', key: 'B' }];
  // 1 m/s 로 1초 → 51 까지. 50.5 만 지난다 (55 는 아직)
  const r = stepCart({ s: 50, dir: 1, pause: 0, lastKey: null }, { ...OPT, speed: 1 }, stations, 1);
  assert.equal(r.arrived.uid, 'A');
});
t('막혀 못 간 자리의 역은 밟지 않는다 — 되밀지 않고 속도를 깎기 때문', () => {
  const stations = [{ s: 50.5, kind: 'load', uid: 'A', key: 'A' }];
  // 갈 수 있는 거리가 0.2m 뿐 → 0.2 m/s × 1s. 50.5 를 안 넘는다
  const r = stepCart({ s: 50, dir: 1, pause: 0, lastKey: null }, { ...OPT, speed: 0.2 }, stations, 1);
  assert.equal(r.arrived, null);
  assert.ok(Math.abs(r.s - 50.2) < 1e-9);
});

/* ---------- 두 대가 실제로 뭉치지 않는지 ---------- */
t('고리 두 대 — 앞차가 서 있으면 뒤차가 그 앞에 선다', () => {
  const gap = 3;
  const fleet = [{ s: 0, dir: 1 }, { s: 50, dir: 1 }];
  // 0 번 차가 1 번(50) 을 향해 달린다. 1 번은 정차 중이라 안 움직인다고 두자
  for (let i = 0; i < 2000; i++) {
    const room = followDistance(fleet[0], fleet, { length: L, closed: true, gap });
    const speed = Math.min(1.4, room / 0.05);
    const r = stepCart({ s: fleet[0].s, dir: 1, pause: 0, lastKey: null },
      { ...OPT, speed }, [], 0.05);
    fleet[0] = { s: r.s, dir: r.dir };
  }
  const d = fleet[1].s - fleet[0].s;
  assert.ok(d >= gap - 1e-6, `간격 ${d.toFixed(4)} < ${gap}`);
  assert.ok(d < gap + 0.1, `너무 멀리 섰다: ${d.toFixed(4)}`);
});

t('고리 세 대 — 오래 돌려도 서로 통과하지 않는다', () => {
  const gap = 3;
  const count = 3;
  const fleet = Array.from({ length: count }, (_, k) => ({ s: (k / count) * L, dir: 1 }));
  const order0 = fleet.map((f) => f.s);
  for (let step = 0; step < 5000; step++) {
    for (let k = 0; k < count; k++) {
      const room = followDistance(fleet[k], fleet, { length: L, closed: true, gap });
      // 2번 차만 가끔 정차 — 이게 원래 뭉침을 만들던 상황이다
      const paused = k === 2 && step % 200 < 40;
      const speed = paused ? 0 : Math.min(1.4, room / 0.05);
      const r = stepCart({ s: fleet[k].s, dir: 1, pause: 0, lastKey: null }, { ...OPT, speed }, [], 0.05);
      fleet[k] = { s: r.s, dir: r.dir };
    }
    for (let k = 0; k < count; k++) {
      const lead = fleet[(k + 1) % count];
      let ahead = lead.s - fleet[k].s;
      ahead = ((ahead % L) + L) % L;
      assert.ok(ahead >= gap - 1e-6 || ahead === 0, `${step}프레임: ${k}번 차가 ${ahead.toFixed(3)}m 까지 붙었다`);
    }
  }
  assert.equal(order0.length, 3);
});


/* ---------- 수송 능력 -------------------------------------------------------
     설비 능력과 나란히 놓고 보는 값. **손으로 계산하다 20배를 틀렸다** —
     적치대의 dispatch(3) 를 썼는데 실제로는 카트의 loadCount(20) 가 이기고,
     배치 대수(3대)도 안 봤다. 그래서 규칙을 한 곳에 두고 소스와 대조한다.
--------------------------------------------------------------------------- */
const cartView = await readSrc('scene/CartView.jsx');

t('실을 양의 규칙이 CartView 와 같다 — 차량 값이 역의 값을 이긴다', () => {
  /* CartView 가 실제로 부르는 식. 이게 바뀌면 stationWant 도 같이 바뀌어야 한다 */
  assert.ok(
    cartView.includes('loadRoom(carried, capacity, topUp, cart.loadCount ?? a.dispatch ?? 0)'),
    'CartView 의 싣기 규칙이 바뀌었다 — stationWant 를 맞춰야 한다',
  );
  const st = { kind: 'shelf-out', dispatch: 3 };
  assert.equal(C.stationWant({ loadCount: 20 }, st), 20, '차량 값이 안 이긴다');
  assert.equal(C.stationWant({}, st), 3, '차량 값이 없으면 역의 값');
});
t('설비 유출부는 그 설비의 덩어리 크기를 따른다', () => {
  /* 설비에서 싣는 쪽은 a.count 를 쓴다 — 차량 값이 아니다 */
  assert.ok(cartView.includes('Math.min(a.count, loadRoom(carried, capacity, topUp, a.count))'));
  assert.equal(C.stationWant({ loadCount: 20 }, { kind: 'load', count: 4 }), 4);
});
t('적재량 기본값도 CartView 와 같다', () => {
  assert.ok(cartView.includes('cart.loadCount ?? (shipOutside ? 10 : 3)'));
  assert.equal(C.cartCapacity({}, false), 3);
  assert.equal(C.cartCapacity({}, true), 10);
  assert.equal(C.cartCapacity({ loadCount: 20 }, false), 20);
});

const LOOP = { uid: 'K', points: [[0, 0], [10, 0], [10, 5], [0, 5]], closed: true, speed: 1.4, dwell: 1.2 };
const pathOf = (c) => C.cartPath(c);
const ST = [
  { kind: 'shelf-out', uid: 'S1', dispatch: 3 },
  { kind: 'shelf-in', uid: 'S2' },
];

t('대수 × 한 번에 싣는 양 ÷ 한 바퀴', () => {
  const c = { ...LOOP, count: 3, loadCount: 20 };
  const p = pathOf(c);
  const h = C.haulPerMinute(c, p, ST);
  assert.equal(h.fleet, 3);
  assert.equal(h.perLap, 20);
  const lap = p.length / 1.4 + 2 * 1.2;          // 카트는 한 바퀴에 두 번 선다
  assert.ok(Math.abs(h.lapSec - lap) < 1e-9);
  assert.ok(Math.abs(h.perMinute - (3 * 20) / lap * 60) < 1e-9);
});
t('대수를 늘리면 그만큼 는다', () => {
  const p = pathOf(LOOP);
  const one = C.haulPerMinute({ ...LOOP, count: 1, loadCount: 10 }, p, ST).perMinute;
  const four = C.haulPerMinute({ ...LOOP, count: 4, loadCount: 10 }, p, ST).perMinute;
  assert.ok(Math.abs(four - one * 4) < 1e-9);
});
t('적재량보다 많이 실으라고 해도 적재량까지만', () => {
  const c = { ...LOOP, count: 1, loadCount: 5 };
  assert.equal(C.haulPerMinute(c, pathOf(c), [{ kind: 'load', uid: 'M', count: 99 }, ST[1]]).perLap, 5);
});
t('실을 데나 내릴 데가 없으면 0 — 나르는 게 없다', () => {
  const p = pathOf(LOOP);
  assert.equal(C.haulPerMinute(LOOP, p, [ST[1]]).perMinute, 0, '실을 데가 없는데 0 이 아니다');
  assert.equal(C.haulPerMinute(LOOP, p, [ST[0]]).perMinute, 0, '내릴 데가 없는데 0 이 아니다');
});
t('트럭은 내릴 데가 없어도 나른다 — 밖으로 싣고 나간다', () => {
  const p = pathOf(LOOP);
  const h = C.haulPerMinute({ ...LOOP, count: 1, loadCount: 12 }, p, [ST[0]], { truck: true });
  assert.equal(h.perLap, 12, '트럭은 적재량 전부를 채운다');
  assert.ok(h.perMinute > 0);
});
t('경로가 길수록·느릴수록 적게 나른다', () => {
  const slow = { ...LOOP, count: 1, loadCount: 10, speed: 0.7 };
  const fast = { ...LOOP, count: 1, loadCount: 10, speed: 1.4 };
  assert.ok(C.haulPerMinute(slow, pathOf(slow), ST).perMinute
          < C.haulPerMinute(fast, pathOf(fast), ST).perMinute);
});
t('정차 시간이 길수록 적게 나른다', () => {
  const a = { ...LOOP, count: 1, loadCount: 10, dwell: 0 };
  const b = { ...LOOP, count: 1, loadCount: 10, dwell: 5 };
  assert.ok(C.haulPerMinute(b, pathOf(b), ST).perMinute
          < C.haulPerMinute(a, pathOf(a), ST).perMinute);
});
