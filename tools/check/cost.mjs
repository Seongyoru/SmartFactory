/**
 * 원가 — 「이 배치가 남는 장사인가」
 * ---------------------------------------------------------------------------
 *  이 값은 **회의에 들고 나간다.** 처리량이 틀리면 시뮬레이터가 이상한 것이지만
 *  원가가 틀리면 잘못된 결정이 내려진다. 그래서 여기는 산수 하나하나를 못 박고,
 *  「화면·보고서·비교표가 같은 값을 보는가」 까지 소스로 확인한다.
 */
import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('원가');

const C = await import(SRC + 'core/cost.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const HOUR = 3600;
/** 전기만 따지게 만든 단가 — 다른 항목이 섞이면 뭘 보고 있는지 알 수 없다 */
const ONLY_POWER = { power: 100, wage: 0, cartKw: 0, material: 0 };

/* ---------- 단가 읽기 ----------------------------------------------------- */

t('단가가 없거나 깨져도 온전한 표를 돌려준다', () => {
  assert.deepEqual(C.normalizeRates(undefined), C.DEFAULT_RATES);
  assert.deepEqual(C.normalizeRates(null), C.DEFAULT_RATES);
  assert.equal(C.normalizeRates({ power: 'abc' }).power, C.DEFAULT_RATES.power);
  assert.equal(C.normalizeRates({ wage: NaN }).wage, C.DEFAULT_RATES.wage);
});
t('단가는 범위 밖으로 못 나간다 — 음수 원가가 나오면 안 된다', () => {
  assert.equal(C.normalizeRates({ power: -50 }).power, C.POWER_RANGE[0]);
  assert.equal(C.normalizeRates({ wage: 9e9 }).wage, C.WAGE_RANGE[1]);
  assert.equal(C.normalizeRates({ material: -1 }).material, 0);
});
t('자재비는 **슬라이더 범위와 값의 한계가 다르다**', () => {
  /* 슬라이더 최대가 100만이면 2,000원짜리 자재는 손잡이가 왼쪽 끝에 붙어
     움직여도 뭐가 달라지는지 안 보인다 — 흔한 값이 눈금의 0.2% 안에 몰린다.
     그래서 슬라이더는 1만까지만 훑고, 비싼 부품은 손으로 적는다. */
  assert.equal(C.MATERIAL_RANGE[1], 10000, '슬라이더가 흔한 값을 못 훑는다');
  assert.ok(C.MATERIAL_MAX > C.MATERIAL_RANGE[1], '손으로 적을 여지가 없다');
  /* 손으로 적은 값을 **슬라이더 최대에 맞춰 자르면 안 된다** — 조용히 틀린다 */
  assert.equal(C.normalizeRates({ material: 250000 }).material, 250000);
  assert.equal(C.normalizeRates({ material: 9e12 }).material, C.MATERIAL_MAX);
});
t('전기 단가는 2,000원/kWh 까지 — 산업용 밖의 요금도 넣어 본다', () => {
  assert.equal(C.POWER_RANGE[1], 2000);
  assert.equal(C.normalizeRates({ power: 1800 }).power, 1800);
});
t('설비가 자기 값을 안 가졌으면 기본 kW', () => {
  assert.equal(C.runKwOf({}), C.RUN_KW);
  assert.equal(C.idleKwOf({}), C.IDLE_KW);
  assert.equal(C.fixedOf({}), 0, '고정비 기본은 0 — 모르는 숫자를 지어내면 안 된다');
});
t('**대기 kW 는 가동 kW 를 넘을 수 없다** — 서 있는 게 더 비싸면 거꾸로다', () => {
  assert.equal(C.idleKwOf({ runKw: 3, idleKw: 10 }), 3);
  assert.equal(C.idleKwOf({ runKw: 10, idleKw: 3 }), 3);
});

/* ---------- 시간 → 돈 ------------------------------------------------------ */

t('kWh 는 kW × 시간 — 3600 이 한 곳에만 있다', () => {
  near(C.kwh(7, HOUR), 7);
  near(C.kwh(7, HOUR / 2), 3.5);
  assert.equal(C.kwh(7, -5), 0, '음수 시간은 0');
  assert.equal(C.kwh(-7, HOUR), 0, '음수 kW 도 0');
});
t('시간당 얼마 × 초 = 원', () => {
  near(C.perHour(12000, HOUR), 12000);
  near(C.perHour(12000, 600), 2000);
});

/* ---------- 설비 한 대 ----------------------------------------------------- */

t('가동과 대기를 갈라 센다 — 서 있는 설비는 공짜가 아니다', () => {
  const r = C.machineCost({ runKw: 10, idleKw: 2 }, HOUR, HOUR / 4, ONLY_POWER);
  near(r.runSec, 2700);
  near(r.idleSec, 900);
  near(r.kwh, 10 * 0.75 + 2 * 0.25);          // 7.5 + 0.5
  near(r.power, 8 * 100);
});
t('한 값만 쓰면 안 되는 이유 — 갈라 세지 않으면 놀리는 배치가 이긴다', () => {
  const split = C.machineCost({ runKw: 10, idleKw: 2 }, HOUR, HOUR, ONLY_POWER);
  assert.ok(split.power > 0, '온종일 서 있었는데 전기값이 0이다');
  near(split.power, 2 * 100);
});
t('정지 시간은 돈 시간을 넘을 수 없다', () => {
  const r = C.machineCost({ runKw: 10, idleKw: 2 }, 600, 99999, ONLY_POWER);
  near(r.idleSec, 600);
  near(r.runSec, 0);
});
t('고정비는 **돈 시간 전체**에 붙는다 — 놀아도 감가상각은 나간다', () => {
  const r = C.machineCost({ runKw: 0, idleKw: 0, fixedPerHour: 6000 }, HOUR, HOUR / 2, ONLY_POWER);
  near(r.fixed, 6000);
  near(r.idleBurn, 3000, 1e-6);              // 절반은 노는 몫
});
t('놀며 탄 돈 = 대기 전력 + 그 시간 몫의 고정비', () => {
  const r = C.machineCost({ runKw: 10, idleKw: 2, fixedPerHour: 3600 }, HOUR, HOUR / 2, ONLY_POWER);
  near(r.idleBurn, 2 * 0.5 * 100 + 1800);
});
t('한 번도 안 돌았으면 전부 0 — 방금 놓은 설비가 돈을 쓰면 안 된다', () => {
  const r = C.machineCost({}, 0, 0, ONLY_POWER);
  near(r.total, 0);
  near(r.idleBurn, 0);
});

/* ---------- 사람-초 -------------------------------------------------------- */

const SHIFTS = [
  { name: '주', minutes: 480, headcount: 6 },
  { name: '야', minutes: 480, headcount: 3 },
];

t('한 조 안에서는 그 조의 정원만큼', () => {
  near(C.crewSeconds(SHIFTS, HOUR), 6 * HOUR);
});
t('조가 바뀌면 정원도 바뀐다 — 경계를 걸치면 나눠 센다', () => {
  const ran = 9 * HOUR;                        // 주 8시간 + 야 1시간
  near(C.crewSeconds(SHIFTS, ran), 6 * 8 * HOUR + 3 * HOUR);
});
t('한 바퀴를 넘겨도 정확하다 — 되풀이해서 더한다', () => {
  const cycle = 16 * HOUR;
  near(C.crewSeconds(SHIFTS, cycle), (6 + 3) * 8 * HOUR);
  near(C.crewSeconds(SHIFTS, 2 * cycle), 2 * (6 + 3) * 8 * HOUR);
  near(C.crewSeconds(SHIFTS, 2 * cycle + HOUR), 2 * (6 + 3) * 8 * HOUR + 6 * HOUR);
});
t('정원 **무제한(0)** 은 그 도면이 실제로 쓰는 인원으로 본다', () => {
  /* 무한대에 시급을 곱할 수는 없다. 0명으로 두면 인건비가 통째로 사라져
     「사람이 공짜인 공장」이 되므로, 실제 필요 인원만큼 뒀다고 본다. */
  const one = [{ name: '상시', minutes: 1440, headcount: 0 }];
  near(C.crewSeconds(one, HOUR, 4), 4 * HOUR);
  near(C.crewSeconds(one, HOUR, 0), 0);
});
t('안 돌았으면 사람-초도 0', () => {
  near(C.crewSeconds(SHIFTS, 0), 0);
  near(C.crewSeconds(null, HOUR), 0, 1e-6);
});

/* ---------- 한 판 전체 ----------------------------------------------------- */

const M = (uid, extra = {}) => ({ uid, name: uid, placed: { uid, ...extra } });

t('항목을 다 더한 것이 총원가다', () => {
  const c = C.costOf({
    machines: [M('A', { runKw: 10, idleKw: 0, fixedPerHour: 1000 })],
    ranSec: HOUR, stopOf: () => 0, cartSec: 2 * HOUR,
    shifts: [{ name: '상시', minutes: 1440, headcount: 2 }],
    made: 100, good: 100,
    rates: { power: 100, wage: 5000, cartKw: 1, material: 30 },
  });
  const parts = c.parts.reduce((s, p) => s + p.won, 0);
  near(parts, c.total);
  near(c.total, 10 * 100 + 1000 + 2 * 1 * 100 + 2 * 5000 + 100 * 30);
});
t('개당 원가의 분모는 **양품**이다 — 불량까지 나누면 싸 보인다', () => {
  const d = {
    machines: [M('A', { runKw: 10, idleKw: 0 })], ranSec: HOUR, stopOf: () => 0,
    shifts: [], made: 100, rates: ONLY_POWER,
  };
  const all = C.costOf({ ...d, good: 100 });
  const some = C.costOf({ ...d, good: 80 });
  near(all.per, 1000 / 100);
  near(some.per, 1000 / 80);
  assert.ok(some.per > all.per, '불량이 늘었는데 개당이 안 비싸졌다');
});
t('불량으로 버린 돈은 만든 몫 그대로', () => {
  const c = C.costOf({
    machines: [M('A', { runKw: 10, idleKw: 0 })], ranSec: HOUR, stopOf: () => 0,
    shifts: [], made: 100, good: 75, rates: ONLY_POWER,
  });
  near(c.scrapWon, c.total * 0.25);
});
t('자재비는 **만든 개수**에 붙는다 — 불량도 자재는 먹었다', () => {
  const c = C.costOf({
    machines: [], ranSec: HOUR, stopOf: () => 0, shifts: [],
    made: 100, good: 60, rates: { power: 0, wage: 0, cartKw: 0, material: 50 },
  });
  near(c.total, 100 * 50);
});
t('아무것도 안 만들었으면 개당은 **측정 중** — 0으로 나누지 않는다', () => {
  const c = C.costOf({ machines: [M('A')], ranSec: HOUR, stopOf: () => 0, shifts: [], made: 0, good: 0 });
  assert.equal(c.per, null);
  assert.ok(c.total > 0, '만든 것이 없어도 전기는 썼다');
});
t('0원짜리 항목은 목록에 안 뜬다 — 안 넣은 값이 표를 채우면 안 된다', () => {
  const c = C.costOf({
    machines: [M('A', { runKw: 10, idleKw: 0 })], ranSec: HOUR, stopOf: () => 0,
    shifts: [], made: 10, good: 10, rates: ONLY_POWER,
  });
  assert.deepEqual(c.parts.map((p) => p.key), ['power']);
});
t('인건비는 정지 비중만큼만 손실로 잡는다 — 100% 돌아도 급여는 나간다', () => {
  const base = {
    machines: [M('A', { runKw: 0, idleKw: 0 })], ranSec: HOUR,
    shifts: [{ name: '상시', minutes: 1440, headcount: 1 }],
    made: 10, good: 10, rates: { power: 0, wage: 6000, cartKw: 0, material: 0 },
  };
  const busy = C.costOf({ ...base, stopOf: () => 0 });
  const half = C.costOf({ ...base, stopOf: () => HOUR / 2 });
  near(busy.idleBurn, 0, 1e-6);
  near(half.idleBurn, 3000, 1e-6);
});
t('시간당 원가는 돌린 길이와 무관하게 견줄 수 있다', () => {
  const d = (sec) => C.costOf({
    machines: [M('A', { runKw: 10, idleKw: 10 })], ranSec: sec, stopOf: () => 0,
    shifts: [], made: 1, good: 1, rates: ONLY_POWER,
  });
  near(d(HOUR).perHour, d(3 * HOUR).perHour, 1e-6);
  assert.ok(d(3 * HOUR).total > d(HOUR).total, '오래 돌렸는데 누적이 안 늘었다');
});
t('설비 목록이 비어도 터지지 않는다', () => {
  const c = C.costOf({});
  near(c.total, 0);
  assert.equal(c.per, null);
  near(c.perHour, 0);
});

/* ---------- 사람이 읽는 표기 ----------------------------------------------- */

t('금액 표기는 자릿수에 따라 단위가 바뀐다', () => {
  assert.equal(C.won(3200), '3,200원');
  assert.equal(C.won(52000), '5만 원');
  assert.equal(C.won(3.4e8), '3.40억 원');
  assert.equal(C.won(null), '—');
  assert.equal(C.won(NaN), '—');
});

/* ---------- 배선 — 세 화면이 **같은 값**을 보는가 --------------------------- */

const store = await readSrc('core/store.jsx');
const persist = await readSrc('core/persistence.js');
const inspector = await readSrc('ui/Inspector.jsx');
const scenarios = await readSrc('core/scenarios.js');
const scenView = await readSrc('ui/Scenarios.jsx');
const report = await readSrc('core/report.js');
const hook = await readSrc('ui/useCost.js');
const dockSrc = await readSrc('ui/RunDock.jsx');

t('단가는 도면에 **저장된다** — 새로고침하면 원가가 달라지면 안 된다', () => {
  assert.ok(/DOC_KEYS = \[[^\]]*'rates'/.test(store), 'DOC_KEYS 에 rates 가 없다');
  assert.ok(/rates: state\.rates/.test(persist), 'layoutSnapshot 에 rates 가 없다');
});
t('저장 목록 두 벌이 서로 어긋나지 않는다', () => {
  /* 앞서 openings·shifts·beltSpeed 가 이 사고를 냈다. 네 번째를 만들지 않는다. */
  const keys = store.match(/DOC_KEYS = \[([^\]]*)\]/)[1]
    .split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean).sort();
  const snap = persist.match(/layoutSnapshot = \(state\) => \(\{([\s\S]*?)\n\}\)/)[1]
    .split('\n').map((l) => l.match(/^\s*(\w+):/)?.[1]).filter(Boolean).sort();
  assert.deepEqual(snap, keys, `snapshot ${snap.join(',')} ≠ DOC_KEYS ${keys.join(',')}`);
});
t('단가를 고치는 길이 있다', () => {
  assert.ok(store.includes("case 'SET_RATES':"), '리듀서에 SET_RATES 가 없다');
  assert.ok(store.includes('normalizeRates'), '저장하면서 정규화를 안 한다');
  assert.ok(dockSrc.includes("type: 'SET_RATES'"), '화면에서 단가를 못 고친다');
});
t('옛 도면도 원가가 나온다 — 없는 rates 는 기본값으로', () => {
  assert.ok(/rates: normalizeRates\(action\.data\.rates\)/.test(store), '불러올 때 정규화를 안 한다');
});
t('**모으는 자리는 하나다** — 화면·보고서·비교표가 같은 훅을 쓴다', () => {
  assert.ok(hook.includes('export function useCostInput'), '훅이 없다');
  /* 띠(화면)·보고서·비교표 **셋 다** 부른다. 하나라도 스스로 모으면 값이 갈린다 */
  for (const [name, src] of [['RunDock', dockSrc], ['Inspector(보고서)', inspector], ['Scenarios', scenView]]) {
    assert.ok(/from '\.\/useCost\.js'/.test(src), `${name} 가 훅을 안 가져온다`);
    assert.ok(/useCostInput\(\)/.test(src), `${name} 이 훅을 안 부른다`);
  }
});
/** 주석을 걷어낸 소스 — 「여기서는 안 부른다」 를 확인할 때 주석 속 이름에 걸린다 */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

t('보고서는 원가를 **받아 적기만** 한다 — 다시 곱하지 않는다', () => {
  assert.ok(report.includes("head('원가')"), '보고서에 원가 구획이 없다');
  assert.equal(/costOf|kwh\(|crewSeconds/.test(code(report)), false,
    'report.js 가 원가를 다시 계산한다 — 화면과 갈릴 자리다');
  assert.ok(inspector.includes('cost,'), '보고서에 원가를 안 넘긴다');
});
t('비교표도 밖에서 받는다 — scenarios.js 는 계산하지 않는다', () => {
  assert.ok(/captureRun\(placed, shipped, cost = null\)/.test(scenarios), '원가를 안 받는다');
  assert.equal(/costOf|normalizeRates/.test(code(scenarios)), false, 'scenarios.js 가 원가를 계산한다');
  assert.ok(/captureRun\(state\.placed, shipped, cost\)/.test(scenView), '화면이 원가를 안 넘긴다');
});
t('개당 원가는 **낮을수록** 이긴다', () => {
  assert.ok(/LOWER_IS_BETTER = new Set\(\[[^\]]*'costPer'/.test(scenarios),
    '개당 원가가 높을수록 좋은 값으로 잡혀 있다');
  assert.ok(scenarios.includes("key === 'costPer' ? r.run?.cost?.per"), 'bestOf 가 원가를 못 읽는다');
});

/* ---------- 아래 띠 — 씬을 16:9 로 남긴다 --------------------------------- */

const D = await import(SRC + 'ui/dockLayout.js');
const app = await readSrc('App.jsx');
const dock = dockSrc;

t('띠는 **폭의 9/16 을 씬에 남기고** 나머지를 가진다', () => {
  /* 1920 창의 씬 영역: 폭 1364 · 높이 1004 → 씬 767, 띠 237 (실제로 그렇게 나온다) */
  assert.equal(D.dockHeight(1364, 1004), 237);
  near(1364 / (1004 - D.dockHeight(1364, 1004)), 16 / 9, 2e-3);
  const h = D.dockHeight(1044, 924);
  near(1044 / (924 - h), 16 / 9, 2e-3);
});
t('창이 낮으면 띠가 최소만 가져간다 — 글자가 잘리면 계기판이 아니다', () => {
  assert.equal(D.dockHeight(1600, 700), D.MIN_H);
  assert.equal(D.dockHeight(1600, 200), D.MIN_H, '나머지가 음수여도 버틴다');
  assert.equal(D.dockHeight(), D.MIN_H, '아직 못 잰 상태에서도 값이 있다');
});
t('창이 높으면 남는 몫은 **씬이** 갖는다 — 계기판이 도면을 밀어내지 않는다', () => {
  assert.equal(D.dockHeight(1000, 2000), D.MAX_H);
  assert.ok(D.MAX_H > D.MIN_H);
});
t('씬 쪽에 aspect 를 같이 주지 않는다 — 플렉스와 다퉈 반씩 갈린다', () => {
  /* 실제로 그렇게 나왔다: 씬 322 · 띠 323(비율 2.25). 되돌리면 이 검사가 잡는다. */
  assert.equal(/aspect-\[16\/9\]/.test(code(app)), false, 'App 이 씬에 aspect 를 다시 걸었다');
  assert.ok(app.includes('<RunDock />'), '띠가 화면에 안 붙어 있다');
});

/* ---------- 띠 안의 배치 — 가로로 펴고 스크롤을 만들지 않는다 -------------- */

t('탭 둘 — 실행이 앞, 원가가 뒤', () => {
  /* 한 줄에 다섯 칸을 늘어놓았더니 폭이 모자라 글자가 잘리고 값이 빠졌다.
     띠 높이는 씬을 16:9 로 남기고 나온 나머지라 못 늘린다 — 남은 방법이 탭이다. */
  const tabs = [...dock.matchAll(/\['(\w+)', '([^']+)'\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(tabs, [['run', '실행'], ['cost', '원가']]);
  assert.ok(dock.includes("tab === 'run'") && dock.includes("tab === 'cost'"), '탭으로 안 갈린다');
  assert.ok(/runTab: 'run'/.test(store), '기본 탭이 도면 상태에 없다');
});
t('보고서·다시 재기는 **실행 탭에만** 붙는다', () => {
  /* 단가를 만지는 중에 「다시 재기」 가 옆에 있으면 잘못 눌러 기록이 날아간다 */
  assert.ok(/tab === 'run' && <ReportButtons \/>/.test(dock), '원가 탭에서도 다시 재기가 눌린다');
});
t('접힌 채로 탭을 누르면 펴면서 간다 — 두 번 누르게 하지 않는다', () => {
  assert.ok(/runTab: id, showRunDock: true/.test(dock), '탭을 눌러도 안 펴진다');
});
t('네 칸의 제목', () => {
  const cols = [...dock.matchAll(/<Col title="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cols, [
    '지표', '생산 추이', '작동 시간 (낮은 순)', '병목 시간',
    '원가', '원가 구성', '손실 원가', '단가', '원가', '단가',
  ]);
});
t('높이가 없는 것은 **두 열로** 푼다 — 세로로 쌓으면 잘린다', () => {
  /* 설비 순위는 세 대에서 끊겼고, 단가는 넷째 슬라이더가 잘려 그 자리에 아래
     설명이 겹쳐 찍혔다. 띠에 남는 높이는 200px 남짓인데 폭은 남는다. */
  assert.equal((dock.match(/grid-cols-2/g) ?? []).length, 2,
    '작동 시간 목록과 단가 중 하나가 다시 한 열로 쌓인다');
});
t('스크롤은 **넘치는 칸 안에서만** — 띠 전체가 밀리면 안 된다', () => {
  assert.ok(dock.includes('overflow-hidden'), '칸이 넘치는 것을 안 자른다');
  /* 길이가 도면에 따라 변하는 둘(작동 시간·병목)만 스스로 스크롤한다 */
  assert.equal((dock.match(/overflow-y-auto/g) ?? []).length, 2,
    '스크롤이 붙는 칸 수가 둘이 아니다');
  assert.equal(/RANK_ROWS/.test(dock), false,
    '아직 목록을 끊는다 — 끊으면 그 뒤를 볼 방법이 없다');
});
t('단가는 슬라이더로도, **손으로 적어서도** 넣는다', () => {
  /* 슬라이더만으로는 12,000 을 못 맞추고, 범위 밖 값은 아예 못 넣는다 */
  assert.ok(/type="text"/.test(dock), '손으로 적는 칸이 없다');
  assert.ok(dock.includes('inputMode="decimal"'), '숫자 자판이 안 뜬다');
  assert.ok(dock.includes('hardMax={MATERIAL_MAX}'), '자재비만 더 크게 적을 수 있어야 한다');
  /* 타이핑 중에는 손댄 그대로 둔다 — 한 글자마다 되돌리면 못 고친다 */
  assert.ok(/const \[draft, setDraft\] = useState\(null\)/.test(dock), '입력 중 상태가 없다');
  assert.ok(/value={Math\.min\(max, value\)}/.test(dock),
    '슬라이더가 자기 범위 밖 값을 받으면 React 가 값을 되돌린다');
});
t('목록의 설비를 누르면 **이동하고 선택된다** — 이름만 주면 다시 찾아야 한다', () => {
  assert.ok(dock.includes("dispatch({ type: 'SELECT', selected: { kind: 'equip', uid } })"), '선택이 안 된다');
  assert.ok(/focusOn\(\[p\.pos\[0\], p\.pos\[1\]\], \{ look: true \}\)/.test(dock), '카메라가 안 간다');
  for (const who of ['<LossRank', '<Bottleneck']) {
    const tag = dock.slice(dock.indexOf(who), dock.indexOf(who) + 220);
    assert.ok(tag.includes('onPick={pick}'), `${who} 가 누르는 길을 안 받는다`);
  }
});
t('띠는 **고른 것과 무관하게** 남는다 — 인스펙터에서는 뺐다', () => {
  const summary = inspector.slice(inspector.indexOf('function Summary('));
  for (const tag of ['<RunReport />', '<CostPanel />', '<ReportButtons />']) {
    assert.equal(summary.includes(tag), false, `Summary 에 ${tag} 가 남아 있다 — 두 곳에서 뜬다`);
  }
  assert.ok(inspector.includes('export function ReportButtons'), '보고서 버튼을 띠가 못 쓴다');
  assert.ok(dock.includes('<ReportButtons />'), '띠에 보고서 버튼이 없다');
});
t('보고서 모으기는 **한 곳에만** 남는다 — 띠가 다시 모으지 않는다', () => {
  assert.ok(inspector.includes('const buildReport = ()'), '보고서 모으기가 사라졌다');
  assert.equal(/runReportCSV/.test(dock), false, 'RunDock 이 보고서를 따로 만든다');
});

/* ---------- 길게 보면 얼마인가 -------------------------------------------- */

t('시간당 값을 곱하기만 한다 — 돌린 길이와 무관하다', () => {
  const r = C.projectRun(1000, 60);
  const day = r.find((x) => x.label === '하루');
  near(day.won, 24000);
  near(day.made, 1440);
  const year = r.find((x) => x.label === '한 해');
  near(year.won, 1000 * 24 * 365);
});
t('안 돌렸으면 0 — 없는 값을 지어내지 않는다', () => {
  for (const r of C.projectRun(null, undefined)) { near(r.won, 0); near(r.made, 0); }
});
t('**얼마나 돌려야 하는지는 그 도면이 정한다**', () => {
  /* 짧은 결과를 1년으로 곱하면 틀린 숫자가 그럴듯한 얼굴로 나온다. 무엇이
     기간을 정하는지 — 라인이 차는 시간 · 고장 주기 · 교대 한 바퀴. */
  assert.equal(C.longEnough(300, {}).ok, true, '아무 조건 없으면 5분으로 충분하다');
  /* 고장이 몇 번은 나야 가동률이 사실이 된다 */
  const mtbf = C.longEnough(300, { mtbfSec: 1800 });
  assert.equal(mtbf.ok, false);
  near(mtbf.need, 5400, 1e-9);
  /* 교대가 한 바퀴는 돌아야 사람 부족이 드러난다 — 더 긴 쪽이 이긴다 */
  const both = C.longEnough(300, { mtbfSec: 1800, shiftCycleSec: 86400 });
  near(both.need, 86400, 1e-9);
  /* **정하는 쪽과 말이 따라가야 한다** — 교대가 정했는데 고장 이야기를 하면
     엉뚱한 데를 고치게 된다(실제로 그렇게 나왔다) */
  assert.match(both.why, /교대/, '기간을 정한 이유와 다른 말을 한다');
  assert.match(C.longEnough(60, { mtbfSec: 1800 }).why, /고장/);
  assert.match(C.longEnough(10, {}).why, /라인/);
  assert.ok(C.longEnough(90000, { mtbfSec: 1800, shiftCycleSec: 86400 }).ok, '충분히 돌렸는데 모자라다고 한다');
});
