/* improve.js — 능력과 돈을 잇는다. 「한 대 더 놓으면 남는 장사인가」 */
import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

group('개선 — 그래서 얼마 이득인가');

const I = await import(SRC + 'core/improve.js');
const { DEFAULT_RATES, unitWon } = await import(SRC + 'core/cost.js');

const RATES = { ...DEFAULT_RATES };
/** 상시 1조 · 정원 2명 */
const SHIFTS = [{ name: '상시', minutes: 1440, headcount: 2 }];

const row = (uid, capacity, kind = 'equip', name = uid) => ({ uid, name, kind, own: capacity, mult: 1, capacity });

/* ---------- 시간당 돈 ---------------------------------------------------- */

t('설비는 늘 돌고 있다고 본다 — 천장을 이야기하는 자리니까', () => {
  const h = I.hourlyCost({ machines: [{ uid: 'M1' }], carts: [], shifts: SHIFTS, rates: RATES });
  /* 기본 7kW × 130원 = 910원/시 */
  assert.equal(Math.round(h.power), 910);
});

t('교대 정원은 한 바퀴 평균으로 — 첫 조만 보면 그 도면의 평균이 아니다', () => {
  /* 4명인 조와 0명인 조가 반반이면 평균 2명이다 */
  const half = [{ minutes: 480, headcount: 4 }, { minutes: 480, headcount: 0 }];
  const h = I.hourlyCost({ machines: [], carts: [], shifts: half, rates: RATES });
  assert.equal(Math.round(h.heads), 2);
  assert.equal(Math.round(h.labor), 2 * RATES.wage);
});

t('카트는 대수만큼 전기를 먹는다', () => {
  const one = I.hourlyCost({ carts: [{ uid: 'K1', count: 1 }], shifts: SHIFTS, rates: RATES });
  const four = I.hourlyCost({ carts: [{ uid: 'K1', count: 4 }], shifts: SHIFTS, rates: RATES });
  assert.ok(Math.abs(four.cart - one.cart * 4) < 1e-9);
});

/* ---------- 개당 원가 ---------------------------------------------------- */

t('개당 원가 = 시간당 돈 ÷ 시간당 개수 + 자재비', () => {
  /* 6,000원/시 · 10개/분(=600개/시) → 10원/개, 자재 50원 더해 60원 */
  assert.equal(I.unitCost(6000, 10, 50), 60);
});

t('안 만드는 라인은 개당 원가가 없다 — 0 이 아니라 없는 것이다', () => {
  assert.equal(I.unitCost(6000, 0, 0), null);
});

/* ---------- 배수 걸고 다시 세기 ------------------------------------------ */

t('가장 약한 고리가 라인을 정한다', () => {
  const rows = [row('A', 5), row('B', 12), row('C', 30)];
  assert.equal(I.capacityWith(rows), 5);
});

t('약한 고리를 키우면 그다음 고리에서 멈춘다 — 무한정 안 오른다', () => {
  const rows = [row('A', 5), row('B', 12), row('C', 30)];
  assert.equal(I.capacityWith(rows, { A: 2 }), 10, '10 은 아직 B(12) 아래라 A 가 그대로 병목');
  assert.equal(I.capacityWith(rows, { A: 4 }), 12, 'A 를 4배 해도 B 에서 걸린다');
});

/* ---------- 무엇을 손보나 ------------------------------------------------ */

t('벨트는 **공짜로** 고치는 병목이다 — 값을 바꾸는 일이지 사는 일이 아니다', () => {
  const s = I.stepFor(row('L1', 5, 'belt'), { rates: RATES });
  assert.equal(s.won, 0);
  assert.equal(s.free, true);
  assert.equal(s.factor, I.DOUBLE);
});

t('설비는 전력·고정비에 **사람까지** 물린다 — 안 물리면 공짜로 두 배가 된다', () => {
  const p = { uid: 'M1', crew: 2 };
  const s = I.stepFor(row('M1', 5), { machine: p, rates: RATES });
  assert.equal(s.crew, 2);
  assert.equal(Math.round(s.won), Math.round(7 * RATES.power + 2 * RATES.wage));
  assert.ok(s.won > 0 && s.free === false);
});

t('카트는 두 배가 아니라 (n+1)/n 이다 — 대수에 비례해 나른다', () => {
  const s = I.stepFor(row('K1', 5, 'cart'), { cart: { uid: 'K1', count: 3 }, rates: RATES });
  assert.ok(Math.abs(s.factor - 4 / 3) < 1e-9);
  assert.ok(/3 → 4대/.test(s.what));
});

/* ---------- 한 판 ---------------------------------------------------------- */

const PLAN = (over = {}) => I.improvePlan({
  rows: [row('M1', 5), row('M2', 20)],
  machines: [{ uid: 'M1', crew: 0 }, { uid: 'M2', crew: 0 }],
  carts: [],
  shifts: [{ minutes: 480, headcount: 0 }],
  rates: { ...RATES, wage: 0 },
  ...over,
});

t('설비를 늘리면 능력이 오르고 돈도 오른다 — 둘 다 말한다', () => {
  const p = PLAN();
  assert.equal(p.now.capacity, 5);
  assert.equal(p.after.capacity, 10);
  assert.equal(p.gain, 5);
  assert.ok(p.addWon > 0, '한 대 더 놓는데 돈이 안 든다고 한다');
  assert.ok(p.after.hourly > p.now.hourly);
});

t('개당 원가가 내려가면 남는 장사 — 그 판정이 이 모듈의 결론이다', () => {
  const p = PLAN();
  /* 설비 둘(1,820원/시)에 한 대 더(+910원) = 2,730원/시, 능력은 5 → 10개/분.
     돈은 1.5배인데 개수는 2배이므로 개당은 내려간다. */
  assert.ok(p.unitDelta < 0);
  assert.equal(p.worth, true);
});

t('통째로 두 배는 **본전**이다 — 밑지는 장사라고 하면 거짓말', () => {
  /* 실제로 화면에서 나온 판이다. 설비 둘과 벨트가 모두 10개/분이면 셋을 함께
     두 배로 하는데, 능력도 돈도 정확히 두 배라 개당 원가가 **같다.**
     그걸 빨갛게 「밑지는 장사」 라고 찍으면 안 하게 된다 — 같은 값에 두 배를
     만드는 일인데. */
  const p = PLAN({ rows: [row('M1', 10), row('M2', 10)] });
  assert.equal(p.after.capacity, 20);
  assert.ok(Math.abs(p.unitDelta) < 1e-9, '두 배로 하면 개당은 그대로여야 한다');
  assert.equal(p.verdict, 'even');
  assert.equal(p.worth, false, '본전은 「남는 장사」가 아니다');
});

t('세 갈래를 가르는 띠 — 아주 조금 움직인 것은 안 움직인 것', () => {
  assert.equal(I.verdictOf(-1, 100), 'win');
  assert.equal(I.verdictOf(1, 100), 'lose');
  assert.equal(I.verdictOf(0, 100), 'even');
  assert.equal(I.verdictOf(-0.1, 100), 'even', '0.5% 안쪽은 그대로로 본다');
  assert.equal(I.verdictOf(null, 100), null);
});

t('개당 원가는 원 단위로 반올림하지 않는다 — 3.03과 2.87이 둘 다 3원이 된다', () => {
  assert.notEqual(unitWon(3.03), unitWon(2.87));
  assert.equal(unitWon(3.03), '3.03원');
  assert.equal(unitWon(0.4321), '0.432원');
  assert.equal(unitWon(1240), '1,240원');
  assert.equal(unitWon(null), '—');
});

t('바뀐 값을 읽는 문구도 같은 자리까지 지킨다', () => {
  assert.equal(I.deltaText(-0.16), '▼ 0.160원');
  assert.equal(I.deltaText(2.5), '▲ 2.50원');
  assert.equal(I.deltaText(0), '그대로');
});

t('개수는 그대로인데 돈만 늘면 손해라고 말한다', () => {
  /* 바로 뒤에 같은 능력의 고리가 하나 더 있으면, 하나만 늘려도 안 오른다.
     그런데 chain 은 그 둘을 **한 묶음**으로 잡으므로 함께 늘린다 — 그러면
     오른다. 안 오르는 판을 만들려면 아주 가까운(1% 밖) 고리를 둔다. */
  const p = PLAN({ rows: [row('M1', 5), row('M2', 5.2)] });
  assert.equal(p.now.capacity, 5);
  assert.ok(p.after.capacity <= 5.2, 'M2 에서 걸려야 한다');
  assert.ok(p.addWon > 0);
  assert.equal(p.worth, false, '개당 원가가 안 내려갔는데 남는 장사라고 한다');
});

t('벨트만 병목이면 **한 푼도 안 들이고** 오른다', () => {
  const p = PLAN({ rows: [row('L1', 5, 'belt'), row('M2', 20)] });
  assert.equal(p.addWon, 0);
  assert.equal(p.free, true);
  assert.equal(p.gain, 5);
  assert.equal(p.worth, true, '공짜로 두 배인데 남는 장사가 아니라고 한다');
});

t('같은 능력의 고리 둘은 **함께** 늘린다 — 하나만 늘리면 헛일이라서', () => {
  const p = PLAN({ rows: [row('M1', 5), row('M2', 5), row('M3', 30)] });
  assert.equal(p.steps.length, 2, '묶음을 하나만 집었다');
  assert.equal(p.after.capacity, 10);
});

t('한 대로 천장까지 못 가면 그렇다고 말한다 — 두 숫자가 모순처럼 읽힌다', () => {
  /* 위 목록은 「이 고리를 없애면 10개/분」 이라 한다. 그건 고리를 통째로 치운
     값이다. 한 대 더 놓아 3 → 6 이면 아직 10 이 아니다. */
  const p = PLAN({ rows: [row('M1', 3), row('M2', 10)] });
  assert.equal(p.ceiling, 10, '없애면 어디까지 가는지를 안 들고 있다');
  assert.equal(p.after.capacity, 6);
  assert.equal(p.reaches, false);
});

t('한 대로 천장까지 가면 군말을 안 한다', () => {
  const p = PLAN({ rows: [row('M1', 6), row('M2', 10)] });
  assert.equal(p.after.capacity, 10, '6 을 두 배 하면 12 지만 M2(10) 에서 걸린다');
  assert.equal(p.reaches, true);
});

t('고리가 없으면 아무 말도 안 한다', () => {
  assert.equal(I.improvePlan({ rows: [] }), null);
});

/* ---------- 화면 배선 ------------------------------------------------------ */

const inspector = await readSrc('ui/Inspector.jsx');

/** improvePlan 에 넘기는 인자 한 줄을 집어 온다 (의존성 배열에 같은 이름이
 *  또 나오므로, 칸 전체에서 정규식을 돌리면 끊어져도 통과한다 — 실제로 그랬다) */
const argOf = (sec, key) =>
  sec.split(/\r?\n/).find((l) => new RegExp(`^\\s*${key}:`).test(l)) ?? '';

t('라인 능력 칸이 개선 계산을 실제로 부른다', () => {
  assert.match(inspector, /import \{[^}]*improvePlan[^}]*\} from '\.\.\/core\/improve\.js'/,
    'improve 를 안 들여온다 — 부르는 곳만 있으면 화면이 통째로 죽는다');
  const sec = cut(inspector, 'function LineCapacity', '\nfunction ', '라인 능력 칸');
  assert.ok(sec.includes('improvePlan('), '천장만 말하고 그래서 얼마인지는 안 말한다');
  assert.ok(/손보면 얼마 이득인가/.test(sec), '이득을 말하는 문구가 없다');
});

t('원가와 같은 단가표를 쓴다 — 두 화면이 다른 값을 보면 둘 다 못 믿는다', () => {
  const sec = cut(inspector, 'function LineCapacity', '\nfunction ', '라인 능력 칸');
  assert.match(argOf(sec, 'rates'), /state\.rates/, '단가를 자기 나름대로 만든다');
  assert.match(argOf(sec, 'shifts'), /state\.shifts/, '교대를 안 보고 인건비를 센다');
  assert.match(argOf(sec, 'carts'), /state\.carts/, '카트 전력을 빠뜨린다');
});

t('전기를 안 먹는 것은 빼고 센다 — 선반·적치대에 전기료를 물리면 안 된다', () => {
  /* 칸 어딘가에 isWorkable 이 있는 것으로는 모자라다 — 인원을 세는 데도 쓰기
     때문에 machines 를 안 걸러도 통과한다(실제로 그렇게 새 나갔다).
     **machines 에 넘기는 그 줄**을 집어서 본다. */
  const sec = cut(inspector, 'function LineCapacity', '\nfunction ', '라인 능력 칸');
  const line = sec.split(/\r?\n/).find((l) => /^\s*machines:/.test(l));
  assert.ok(line, 'improvePlan 에 machines 를 안 넘긴다');
  assert.match(line, /filter\(.*isWorkable/, '선반·적치대까지 전력을 물린다');
});
