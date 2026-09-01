/**
 * 천장과 실측을 나란히 — **천장은 넘을 수 없어야 뜻이 있다**
 * ---------------------------------------------------------------------------
 *  「라인 능력」은 돌리기 전에 계산으로 나오는 값이고, 반복 실행의 처리량은
 *  실제로 돌려서 잰 값이다. 화면은 둘을 나란히 놓고 「천장의 몇 %」라고 말한다.
 *  그러려면 **실측이 천장을 넘지 않아야** 한다.
 *
 *  ── 지금은 넘는다 ───────────────────────────────────────────────────────
 *  천장은 `perMinute(eff) / 품종 수` 다 — 「품종을 고르게 번갈아 만든다」가
 *  전제다. 그런데 디스패칭 규칙 「납기 먼저」는 **번갈지 않는다.** 급한 품종
 *  하나를 계속 만들 수 있고, 그러면 그 품종의 산출이 천장의 두 배 가까이 된다.
 *
 *  ── 이 검사가 왜 필요한가 ───────────────────────────────────────────────
 *  이 자리를 잡는 검사가 **하나도 없었다.** 그래서 천장 계산을 바꾸는 실험
 *  패치가 커밋에 섞여 들어갔는데도 1238건이 그대로 통과했다 — 두 갈래를 아예
 *  못 갈랐다. 값을 박아 두어야 다음에 누가 손댈 때 무엇이 달라지는지 보인다.
 *
 *  **여기 적힌 숫자는 「맞는 값」이 아니라 「지금 값」이다.** 천장을 제대로
 *  고치면 이 검사가 울어야 한다 — 그때 값을 새로 재서 고쳐 적을 것.
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

t('**납기 먼저면 실측이 천장을 넘는다** — 지금 알려진 어긋남', () => {
  /* 급한 품종 하나를 계속 만들므로 「고르게 번갈아」가 깨진다. 천장은 그 전제
     위에서 나눈 값이라 실제보다 낮게 나온다. 이 값은 「맞는 값」이 아니라
     「지금 값」이다 — 천장을 제대로 고치면 여기가 울어야 한다. */
  assert.equal(r1(due.cap), 8, `천장 ${r1(due.cap)}`);
  assert.equal(r1(due.top), 15, `최다 품종 ${r1(due.top)}`);
  assert.ok(due.top > due.cap, '넘김이 사라졌다 — 고쳤으면 이 검사를 다시 쓸 것');
});

t('밀린 것 먼저는 고르게 나눠 만든다 — 규칙마다 답이 다르다', () => {
  /* 진척이 뒤처진 쪽을 고르므로 결과적으로 번갈아 만든다 — 그래서 안 넘는다.
     「규칙이 ORDER 가 아니면 다 깨진다」가 아니라는 것을 값으로 남겨 둔다. */
  assert.equal(r1(behind.top), 8, `최다 품종 ${r1(behind.top)}`);
  assert.ok(behind.top <= behind.cap, '밀린 것 먼저도 넘는다');
});

/* ---------- 단위 ------------------------------------------------------------ */

t('천장은 **품종당**, 실측 합계는 품종 전부 — 그냥 견주면 안 된다', () => {
  /* 화면(`RunDock`)은 합계를 품종당 천장으로 나눠 「천장의 몇 %」라고 말한다.
     2품종이면 차례대로에서도 180% 가 나온다 — 규칙과 무관한 별개의 어긋남이다. */
  assert.equal(r1(order.all), 14.4, `전체 ${r1(order.all)}`);
  assert.ok(order.all > order.cap * 1.5, '합계가 품종당 천장을 크게 넘지 않는다');
});
