/**
 * 천장과 실측을 나란히 — **천장은 넘을 수 없어야 뜻이 있다**
 * ---------------------------------------------------------------------------
 *  「라인 능력」은 돌리기 전에 계산으로 나오는 값이고, 반복 실행의 처리량은
 *  실제로 돌려서 잰 값이다. 화면은 둘을 나란히 놓고 「천장의 몇 %」라고 말한다.
 *  그러려면 **실측이 천장을 넘지 않아야** 한다.
 *
 *  ── 한때는 넘었다 ───────────────────────────────────────────────────────
 *  천장이 `perMinute(eff) / 품종 수` 였다 — 「품종을 고르게 번갈아 만든다」가
 *  전제다. 그런데 「납기 먼저」는 **번갈지 않는다.** 급한 품종 하나를 계속
 *  만들 수 있어서 실측이 천장의 두 배 가까이 나왔다(8.00 대 15.00).
 *
 *  이제 몰빵할 수 있는 규칙이면 안 나눈다 — 천장은 **상한**이기 때문이다.
 *
 *  ── 이 검사가 왜 필요한가 ───────────────────────────────────────────────
 *  이 자리를 잡는 검사가 **하나도 없었다.** 그래서 천장 계산을 바꾸는 실험
 *  패치가 커밋에 섞여 들어갔는데도 1238건이 그대로 통과했다 — 두 갈래를 아예
 *  못 갈랐다. 값을 박아 두어야 다음에 누가 손댈 때 무엇이 달라지는지 보인다.
 *
 *  **여기 적힌 숫자는 이 도면에서 실제로 잰 값이다.** 천장 계산을 바꾸면 이
 *  검사가 운다 — 그때 값을 새로 재서 고쳐 적을 것. 그리고 마지막 검사
 *  「실측이 천장을 안 넘는다」만은 **어떤 값이 나오든 참이어야 한다.**
 */
import assert from 'node:assert/strict';
import { SRC, group, t } from './_harness.mjs';
import { itemOf, loadModels, specOf as specById } from './_models.mjs';

group('천장과 실측');

const B = await import(SRC + 'core/balance.js');
const A = await import(SRC + 'core/area.js');
const Lu = await import(SRC + 'core/lineup.js');
const R = await import(SRC + 'core/replicate.js');
const St = await import(SRC + 'core/simStore.js');
const LIB = await import(SRC + 'data/library.js');

await loadModels(['MACHINE_1', 'STILLAGE', 'CONVEYOR']);
const idByKey = new Map(LIB.BUILTIN_LIBRARY.filter((x) => x.modelKey).map((x) => [x.modelKey, x.id]));
const specOf = (it) => (it?.modelKey ? specById(idByKey.get(it.modelKey) ?? '') : null);

const areas = [{ uid: 'F', mp: A.rectMP([-15, -15], [15, 15]) }];
const links = [{
  uid: 'C1', itemId: 'CONVEYOR', from: { uid: 'P1', portId: 'PORT_OUT' }, to: { uid: 'S1' },
  radius: 0.5, layer: 0, width: 1,
}];
const TWO = [{ out: 'PART_R', need: [] }, { out: 'PART_G', need: [] }];

/** 급한 오더 하나 · 여유 있는 오더 하나 — 「납기 먼저」가 한쪽으로 몰리게 */
const ORDERS = [
  { uid: 'A', kind: 'PART_R', qty: 500, dueMin: 5, at: 'store', atUid: 'S1' },
  { uid: 'B', kind: 'PART_G', qty: 500, dueMin: 30, at: 'store', atUid: 'S1' },
];

const SEC = 300;

/** 규칙 하나로 돌려 「천장 · 최다 품종 · 전체」를 잰다 (개/분) */
function run(rule) {
  St.clearStock();
  St.resetArrived?.();
  St.resetRun?.();
  const placed = [
    {
      uid: 'P1', name: '제작기', itemId: 'MACHINE_1', pos: [-6, 6], rot: 0,
      outputCount: 3, cycleSec: 3, lotSize: 20, setupSec: 15, recipes: TWO, dispatch: rule,
    },
    { uid: 'S1', name: '적치대', itemId: 'STILLAGE', pos: [-6, 0], rot: 0, capacity: 400 },
  ];
  const w = Lu.worldOf({
    placed, links, carts: [], areas, walls: [], openings: [], shifts: [],
    orders: ORDERS, beltSpeed: 0.6, itemOf, specOf,
  });
  R.runOnce({ seconds: SEC, world: w.world, flow: w.flow, pick: () => 0 });

  const lots = St.getLots('S1');
  const tally = {};
  for (const k of lots) tally[k] = (tally[k] ?? 0) + 1;
  const min = SEC / 60;
  return {
    cap: B.lineBalance({ placed, links, carts: [], itemOf, specOf, beltSpeed: 0.6 }).capacity,
    top: Math.max(0, ...Object.values(tally)) / min,
    all: lots.length / min,
    tally,
  };
}

const order = run('order');
const due = run('due');
const behind = run('behind');
const r1 = (v) => Math.round(v * 100) / 100;

/* ---------- 전제가 성립할 때 ------------------------------------------------ */

t('차례대로면 한 품종이 천장에 딱 붙는다 — 전제가 참인 경우', () => {
  assert.equal(r1(order.cap), 8, `천장 ${r1(order.cap)}`);
  assert.equal(r1(order.top), 8, `최다 품종 ${r1(order.top)}`);
});

/* ---------- 전제가 깨질 때 -------------------------------------------------- */

t('**납기 먼저는 몰빵할 수 있다** — 그래서 안 나눈다', () => {
  /* 급한 품종 하나를 계속 만드므로 「고르게 번갈아」가 깨진다. 나눈 값을
     천장이라 부르면 실측이 그것을 넘는다(고치기 전: 천장 8.00 대 실측 15.00,
     ×1.88). 몰빵할 수 있는 규칙이면 안 나눈다 — 천장은 **상한**이다. */
  assert.equal(r1(due.cap), 16, `천장 ${r1(due.cap)}`);
  assert.equal(r1(due.top), 15, `최다 품종 ${r1(due.top)}`);
  assert.ok(due.top <= due.cap, `실측이 천장을 넘는다 — ${r1(due.top)} > ${r1(due.cap)}`);
});

t('밀린 것 먼저도 몰빵할 수 있다 — 실제로 안 몰아도 상한은 상한이다', () => {
  /* 이 도면에서는 결과적으로 고르게 나눠 만든다(최다 8.00). 그래도 천장은
     16.00 이다 — 상한은 「이 규칙이 할 수 있는 최대」이지 「이번에 한 것」이
     아니다. 헐거워 보이지만, 넘는 것보다 헐거운 쪽이 낫다. */
  assert.equal(r1(behind.cap), 16, `천장 ${r1(behind.cap)}`);
  assert.equal(r1(behind.top), 8, `최다 품종 ${r1(behind.top)}`);
  assert.ok(behind.top <= behind.cap);
});

t('**어느 규칙이든 실측이 천장을 안 넘는다** — 이것이 이 파일의 요점', () => {
  for (const [name, r] of [['차례대로', order], ['납기 먼저', due], ['밀린 것', behind]]) {
    assert.ok(r.top <= r.cap + 1e-9, `${name}: 실측 ${r1(r.top)} > 천장 ${r1(r.cap)}`);
  }
});

/* ---------- 단위 ------------------------------------------------------------ */

t('천장은 **품종당**, 실측 합계는 품종 전부 — 그냥 견주면 안 된다', () => {
  /* 화면(`RunDock`)은 합계를 품종당 천장으로 나눠 「천장의 몇 %」라고 말한다.
     2품종이면 차례대로에서도 180% 가 나온다 — 규칙과 무관한 별개의 어긋남이다. */
  assert.equal(r1(order.all), 14.4, `전체 ${r1(order.all)}`);
  assert.ok(order.all > order.cap * 1.5, '합계가 품종당 천장을 크게 넘지 않는다');
});
