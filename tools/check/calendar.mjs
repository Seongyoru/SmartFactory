/**
 * =============================================================================
 *  달력 · 계획정지 — **원래 안 도는 시간**
 * =============================================================================
 *  주말 · 야간 · 정기보전(PM). 공장이 안 도는 시간은 **고장이 아니다.**
 *
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **① 이미 그린 도면이 안 바뀐다.** 쉬는 조가 없으면 예전과 값이 똑같다.
 *  **② 쉬는 동안은 아무것도 안 돈다.** 설비 · 벨트 · 카트가 한 번에 선다 —
 *     한 곳이라도 남아서 돌면 주말에 물건이 만들어진다.
 *  **③ 지표에서 통째로 뺀다.** OEE 의 분모는 「돌리기로 한 시간」이다. 안 빼면
 *     토요일에 쉬었다는 이유로 성적표가 나빠지고, 거꾸로 **덜 돌린 공장이 더
 *     좋은 성적**을 받는다.
 *  **④ 달력은 쉬는 동안에도 흐른다.** 안 그러면 주말에 들어간 순간 시계가 멎어
 *     영영 못 깬다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';
import { itemOf, loadModels, specOf as specById } from './_models.mjs';

group('달력 · 계획정지');

const C = await import(SRC + 'core/crew.js');
const Mt = await import(SRC + 'core/metrics.js');
const Sim = await import(SRC + 'core/sim.js');
const St = await import(SRC + 'core/simStore.js');
const Lu = await import(SRC + 'core/lineup.js');
const R = await import(SRC + 'core/replicate.js');
const A = await import(SRC + 'core/area.js');
const LIB = await import(SRC + 'data/library.js');

/* ---------- 교대표가 「쉼」을 든다 ---------------------------------------- */
t('쉬는 조는 **기본이 아니다** — 이미 그린 도면은 다 돈다', () => {
  assert.equal(C.normalizeShifts([{ minutes: 480, headcount: 2 }])[0].closed, false);
  assert.equal(C.normalizeShifts([])[0].closed, false, '기본 교대표가 쉰다');
  assert.equal(C.normalizeShifts([{ minutes: 480, closed: true }])[0].closed, true);
  /* 손으로 고친 도면에 이상한 값이 들어와도 참으로 안 본다 */
  assert.equal(C.normalizeShifts([{ minutes: 480, closed: 'yes' }])[0].closed, false);
});

const WEEK = [
  { name: '평일', minutes: 300, headcount: 0 },
  { name: '주말', minutes: 100, headcount: 0, closed: true },
];

t('**언제 쉬는지**를 한 곳에서 답한다', () => {
  /* 화면(clock.js)과 헤드리스(replicate.js)가 같은 함수를 본다 */
  assert.equal(C.isClosedAt(WEEK, 0), false);
  assert.equal(C.isClosedAt(WEEK, 300 * 60 - 1), false);
  assert.equal(C.isClosedAt(WEEK, 300 * 60 + 1), true);
  /* 한 바퀴를 돌면 다시 평일이다 */
  assert.equal(C.isClosedAt(WEEK, 400 * 60 + 1), false);
  assert.equal(C.isClosedAt([], 99999), false, '교대표가 없으면 늘 돈다');
});

t('한 바퀴 중 **실제로 도는 시간**을 센다', () => {
  assert.equal(C.cycleSeconds(WEEK), 400 * 60);
  assert.equal(C.openSeconds(WEEK), 300 * 60);
  /* 쉬는 조가 없으면 둘이 같다 */
  assert.equal(C.openSeconds([{ minutes: 480, headcount: 2 }]), 480 * 60);
});

t('쉬는 조가 있으면 **한 바퀴는 돌려야** 한다', () => {
  /* 주말을 안 지나고 성적을 내면 「쉬지 않는 공장」의 값이다 */
  assert.equal(C.shiftsVary(WEEK), true);
  /* 인원이 같고 쉬는 조도 없으면 예전처럼 「안 바뀐다」 */
  assert.equal(C.shiftsVary([{ minutes: 480, headcount: 2 }, { minutes: 480, headcount: 2 }]), false);
});

/* ---------- 지표에서 뺀다 -------------------------------------------------- */
t('**계획정지는 부하시간이 아니다**', () => {
  Mt.resetMetrics();
  Sim.runMachines(100, { machines: [], closed: true });
  assert.equal(Mt.getRan(), 0, '쉬는 시간이 부하시간에 들어갔다');
  assert.equal(Mt.getPlanned(), 100, '계획정지를 안 셌다');
  /* 도는 시간은 예전 그대로 */
  Sim.runMachines(50, { machines: [] });
  assert.equal(Mt.getRan(), 50);
  assert.equal(Mt.getPlanned(), 100);
});

t('쉬는 동안은 **서 있는 이유도 안 센다**', () => {
  /* 라인이 안 도는 것이 정상인 시간에 「막혔다 · 굶었다」를 세면 그게 거짓말이다 */
  Mt.resetMetrics();
  Sim.runMachines(100, {
    machines: [], closed: true,
    halted: new Set(['M']), starved: new Set(['M']), unmanned: new Set(['M']),
  });
  assert.equal(Mt.getBlocked().M ?? 0, 0, '쉬는데 막혔다고 센다');
  assert.equal(Mt.getStarved().M ?? 0, 0, '쉬는데 굶었다고 센다');
  assert.equal(Mt.getUnmanned().M ?? 0, 0, '쉬는데 사람이 없다고 센다');
});

t('초기화가 계획정지도 지운다', () => {
  Mt.resetMetrics();
  Sim.runMachines(10, { machines: [], closed: true });
  assert.ok(Mt.getPlanned() > 0);
  Mt.resetMetrics();
  assert.equal(Mt.getPlanned(), 0);
});

/* ---------- 끝에서 끝까지 ------------------------------------------------- */
await loadModels(['MACHINE_1', 'STILLAGE', 'CONVEYOR']);
const idByKey = new Map(LIB.BUILTIN_LIBRARY.filter((x) => x.modelKey).map((x) => [x.modelKey, x.id]));
const specOf = (it) => (it?.modelKey ? specById(idByKey.get(it.modelKey) ?? '') : null);
const areas = [{ uid: 'F', mp: A.rectMP([-20, -20], [20, 20]) }];
const links = [{
  uid: 'C1', itemId: 'CONVEYOR', from: { uid: 'P1', portId: 'PORT_OUT@Z-' }, to: { uid: 'S1' },
  radius: 0.5, layer: 0, width: 1,
}];
const placed = [
  {
    uid: 'P1', name: '제작기', itemId: 'MACHINE_1', pos: [-6, 6], rot: 0, outputCount: 3, cycleSec: 12,
    recipe: { in: [], out: 'PART_R' },
  },
  { uid: 'S1', name: '적치대', itemId: 'STILLAGE', pos: [-6, 0], rot: 0, capacity: 200 },
];
const run = (shifts, sec) => {
  St.clearStock();
  const w = Lu.worldOf({
    placed, links, carts: [], areas, walls: [], openings: [], shifts: [], beltSpeed: 0.6, itemOf, specOf,
  });
  R.runOnce({ seconds: sec, world: w.world, flow: w.flow, pick: () => 0, shifts });
  return { n: St.getLots('S1').length, ran: Mt.getRan(), planned: Mt.getPlanned() };
};

/**
 * 절반을 쉬는 교대표 — **10분 돌고 10분 쉰다.**
 *  조 길이의 최소가 10분이다(`clampShiftMinutes`). 5분으로 적으면 조용히 10분이
 *  되어, 600초를 돌려도 첫 조를 못 벗어난다 — 처음에 그렇게 써서 「쉬는 동안에도
 *  돈다」는 거짓 실패를 봤다.
 */
const HALF = [
  { name: '주간', minutes: 10, headcount: 0 },
  { name: '정기보전', minutes: 10, headcount: 0, closed: true },
];

t('**쉬는 동안은 한 개도 안 만든다**', () => {
  const all = run([], 1200);
  const half = run(HALF, 1200);
  assert.ok(all.n > 0, '아무것도 안 만들었다');
  /* 절반을 쉬었으니 절반쯤 나와야 한다 — 안 쉬면 같은 값이 나온다 */
  assert.ok(half.n < all.n * 0.62,
    `절반을 쉬었는데 ${half.n} / ${all.n} 나왔다 — 쉬는 동안에도 돌고 있다`);
  assert.ok(half.n > all.n * 0.38, `너무 적게 나왔다 (${half.n} / ${all.n})`);
});

t('**부하시간이 절반이다** — 그래서 성적이 안 나빠진다', () => {
  const half = run(HALF, 1200);
  assert.ok(Math.abs(half.ran - 600) < 20, `부하시간이 ${half.ran.toFixed(0)}초다 (600초여야 한다)`);
  assert.ok(Math.abs(half.planned - 600) < 20, `계획정지가 ${half.planned.toFixed(0)}초다`);
  assert.ok(Math.abs(half.ran + half.planned - 1200) < 1, '부하시간 + 계획정지가 경과 시간이 아니다');
});

t('쉬는 조가 없으면 **예전 값 그대로**', () => {
  const a = run([], 1200);
  const b = run([{ name: '상시', minutes: 1440, headcount: 0 }], 1200);
  assert.equal(a.n, b.n);
  assert.equal(a.planned, 0);
});

/* ---------- 배선 ---------------------------------------------------------- */
const clockSrc = await readSrc('core/clock.js');
const sceneSrc = await readSrc('scene/EditorScene.jsx');
const repSrc = await readSrc('core/replicate.js');
const inspSrc = await readSrc('ui/Inspector.jsx');
const dockSrc = await readSrc('ui/RunDock.jsx');

t('**멈추는 자리는 한 곳이다** — 시계가 0을 준다', () => {
  /* 움직이는 것들이 전부 simStep 에서 시간을 받아 간다. 소비자마다 「쉬는
     중인가」를 따로 물으면 반드시 하나를 빠뜨린다 — 벨트만 주말에 돈다든지. */
  assert.ok(clockSrc.includes('export const simStep = (dt) => (isClosed() ? 0 : rawStep(dt));'),
    '벨트·카트가 쉬는 시간에도 돈다');
  /* 달력은 쉬는 동안에도 흘러야 한다 — 멎으면 영영 못 깬다 */
  assert.ok(clockSrc.includes('const d = rawStep(dt);'), '쉬는 동안 시계가 멎는다');
  assert.ok(clockSrc.includes('elapsed += d;'), '시계가 안 흐른다');
});

t('두 길이 **같은 판정**을 본다', () => {
  assert.ok(clockSrc.includes('isClosedAt(shifts, elapsed)'), '시계가 따로 판단한다');
  assert.ok(repSrc.includes('isClosedAt(d.shifts ?? [], i * step)'), '헤드리스가 따로 판단한다');
  assert.ok(repSrc.includes('if (closed) continue;'), '쉬는데 물건을 옮긴다');
});

t('화면이 쉬는 조를 받고, **왜 그런지** 말한다', () => {
  assert.ok(inspSrc.includes('set(i, { closed: !s.closed })'), '쉼 단추가 없다');
  assert.ok(inspSrc.includes('계획정지'), '지금 조가 쉬는 중인지 안 말한다');
  assert.ok(inspSrc.includes('openSeconds(shifts)'), '실제로 도는 시간을 안 적는다');
  /* 부하시간과 경과 시간이 다른 이유를 안 적으면 도구를 못 믿게 된다 */
  assert.ok(dockSrc.includes('getPlanned()'), '실행 탭이 계획정지를 안 보여 준다');
});

t('씬이 쉬는 시간을 **세기는 한다**', () => {
  /* tick 이 0 을 돌려주므로 runMachines 를 안 부른다 — 거기서 끝내면 그 시간이
     어디에도 안 남아 「경과 8시간 · 부하 6시간」의 2시간이 사라진다 */
  assert.ok(sceneSrc.includes('if (running && isClosed()) { plannedStop(rawStep(real)); return; }'),
    '쉬는 시간을 안 센다');
  assert.ok(sceneSrc.includes('useEffect(() => { setShifts(shifts); }, [shifts]);'),
    '교대표를 시계에 안 물린다');
});
