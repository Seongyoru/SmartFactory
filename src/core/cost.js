/**
 * =============================================================================
 *  원가 — 「이 배치가 남는 장사인가」
 * =============================================================================
 *  지금까지 이 도구는 **얼마나 만드나** 는 답했지만 **얼마가 드나** 는 못 답했다.
 *  처리량이 높은 배치가 늘 나은 배치는 아니다 — 설비를 두 배로 깔아 처리량을
 *  20% 올렸다면 그건 나쁜 배치다. 그 판단을 숫자로 하게 만드는 것이 여기다.
 *
 *  ── 새로 재는 것이 하나도 없다 ────────────────────────────────────────────
 *   필요한 값은 **전부 이미 재고 있다.**
 *
 *     시간   metrics 의 ran · blocked · starved · unmanned · cartRan
 *     개수   simStore 의 출하 누계, faults 의 made · scrapped
 *     인원   crew 의 교대조 정원
 *
 *   여기서 시간을 다시 세기 시작하면 화면의 가동률과 보고서의 원가가 갈리고,
 *   그때는 둘 중 뭘 믿을지 알 수 없어진다. 이 모듈은 **곱하기만** 한다.
 *
 *  ── 정지 사유는 서로 겹치지 않는다 ────────────────────────────────────────
 *   `SimClock` 이 무인 → 막힘 → 굶음 순서로 **하나만** 고르기 때문에
 *   (`else if` 사슬), 셋을 그냥 더해도 시간을 두 번 세지 않는다.
 *
 *       가동 시간 = 돈 시간 − (막힘 + 굶음 + 무인)
 *
 *   고장 시간은 `jammed` 안에 들어 있다(고장 난 설비는 막힌 것으로 친다).
 *
 *  ── 놀아도 나가는 돈과 놀면 안 나가는 돈 ──────────────────────────────────
 *   이 구분이 이 모듈의 핵심이다.
 *
 *     인건비    놀아도 **그대로** 나간다 — 사람은 일이 없어도 급여를 받는다
 *     고정비    놀아도 **그대로** 나간다 — 감가상각·임차료는 시간이 지나면 나간다
 *     전력비    놀면 **대기 전력만** 나간다 (runKw → idleKw)
 *
 *   그래서 설비가 노는 것의 대가는 「덜 만든 것」만이 아니다. 노는 동안에도
 *   돈은 계속 타고 있고, 그 액수를 `idleBurn` 으로 따로 낸다. 진단(diagnose)이
 *   짚어 준 원인 옆에 이 숫자가 붙으면 **고칠 값어치가 있는지**가 보인다.
 * ---------------------------------------------------------------------------
 */

import { UNLIMITED, normalizeShifts } from './crew.js';

/* ---------- 단가 ---------------------------------------------------------- */

/**
 * 도면 전체에 걸리는 단가. 설비마다 다른 값(kW)은 `placed` 에 따로 둔다.
 *  기본값은 한국 산업용 기준의 흔한 값이다 — **맞는 값이 아니라 시작점**이고,
 *  쓰는 사람이 자기 숫자로 바꾸는 것을 전제한다.
 */
export const DEFAULT_RATES = {
  power: 130,        // 원/kWh
  wage: 12000,       // 원/사람·시간
  cartKw: 0.4,       // 카트 한 대가 먹는 전력(kW) — 주행 중이든 서 있든
  material: 0,       // 원/개 — 투입 자재비. 모르면 0으로 두고 가공비만 본다
};

export const POWER_RANGE = [0, 2000, 5];        // 원/kWh
export const WAGE_RANGE = [0, 100000, 500];     // 원/시간
export const KW_RANGE = [0, 200, 0.1];          // kW
export const FIXED_RANGE = [0, 1000000, 100];   // 원/시간

/**
 * 자재비 — **슬라이더가 훑는 범위**와 **값의 한계**가 다르다.
 * ---------------------------------------------------------------------------
 *  처음엔 슬라이더 최대가 100만이었다. 그러면 2,000원짜리 자재를 맞추려 해도
 *  손잡이가 왼쪽 끝에 붙어 있어 **움직여도 뭐가 달라지는지 안 보인다** — 흔한
 *  값이 눈금의 0.2% 안에 다 몰려 있으니 슬라이더가 제 노릇을 못 한다.
 *
 *  그래서 슬라이더는 흔한 범위(1만원)만 덮고, 그보다 비싼 부품은 **손으로
 *  적는다.** 적은 값을 슬라이더 최대에 맞춰 잘라 버리면 조용히 틀린 원가가
 *  나오므로, 값의 한계는 따로 넉넉히 둔다.
 */
export const MATERIAL_RANGE = [0, 10000, 50];   // 슬라이더
export const MATERIAL_MAX = 100000000;          // 값의 한계 — 손으로 적은 것만 여기까지

/** 설비 한 대의 기본값 — 중형 가공기 한 대쯤을 생각한 값이다 */
export const RUN_KW = 7;
export const IDLE_KW = 1.2;
export const FIXED_PER_HOUR = 0;

const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/** 저장된 값이 깨졌거나 없어도 항상 온전한 단가표를 돌려준다 */
export function normalizeRates(r) {
  const s = r ?? {};
  return {
    power: clamp(num(s.power, DEFAULT_RATES.power), POWER_RANGE),
    wage: clamp(num(s.wage, DEFAULT_RATES.wage), WAGE_RANGE),
    cartKw: clamp(num(s.cartKw, DEFAULT_RATES.cartKw), KW_RANGE),
    /* 자재비만 슬라이더 범위가 아니라 **값의 한계**로 자른다 (위 주석 참고) */
    material: clamp(num(s.material, DEFAULT_RATES.material), [0, MATERIAL_MAX]),
  };
}

/** 설비가 자기 값을 안 가졌으면 기본값 — 가동 kW 는 대기 kW 아래로 못 내려간다 */
export const runKwOf = (p) => clamp(num(p?.runKw, RUN_KW), KW_RANGE);
export const idleKwOf = (p) => Math.min(runKwOf(p), clamp(num(p?.idleKw, IDLE_KW), KW_RANGE));
export const fixedOf = (p) => clamp(num(p?.fixedPerHour, FIXED_PER_HOUR), FIXED_RANGE);

/* ---------- 시간 → 돈 ------------------------------------------------------ */

/** kW 로 sec 초 → kWh. 여기 하나에만 3600 을 둔다 */
export const kwh = (kw, sec) => (Math.max(0, kw) * Math.max(0, sec)) / 3600;

/** 시간당 얼마로 sec 초 → 원 */
export const perHour = (won, sec) => (Math.max(0, won) * Math.max(0, sec)) / 3600;

/**
 * 설비 한 대의 원가.
 *  @param stop 이 설비가 선 시간(초) — 막힘+굶음+무인의 합
 *  @returns runSec/idleSec 까지 같이 돌려준다. 화면이 "왜 이만큼인지" 를 보여줘야
 *           하는데, 받아 놓고 다시 나누면 반올림이 어긋난다
 */
export function machineCost(p, ranSec, stopSec, rates) {
  const r = normalizeRates(rates);
  const ran = Math.max(0, ranSec ?? 0);
  const idle = Math.min(ran, Math.max(0, stopSec ?? 0));
  const run = ran - idle;
  const energy = kwh(runKwOf(p), run) + kwh(idleKwOf(p), idle);
  const power = energy * r.power;
  const fixed = perHour(fixedOf(p), ran);
  return {
    uid: p?.uid,
    runSec: run,
    idleSec: idle,
    kwh: energy,
    power,
    fixed,
    /** 노는 동안 탄 돈 — 대기 전력 + 그 시간 몫의 고정비 */
    idleBurn: kwh(idleKwOf(p), idle) * r.power + perHour(fixedOf(p), idle),
    total: power + fixed,
  };
}

/**
 * 급여를 준 **사람-초**.
 * ---------------------------------------------------------------------------
 *  일한 시간이 아니라 **붙여 놓은 시간**이다. 교대조 정원이 10명이면 그 시간
 *  동안 설비가 다 서 있어도 10명 몫의 급여가 나간다 — 그게 인건비의 성질이고,
 *  「놀리면 손해」 라는 말이 숫자가 되는 지점이다.
 *
 *  정원을 **무제한(0)** 으로 둔 조는 액수를 낼 수 없으므로, 그 도면이 실제로
 *  필요로 하는 인원(`need`)만큼 뒀다고 본다.
 */
export function crewSeconds(shifts, ranSec, need = 0) {
  const list = normalizeShifts(shifts);
  const ran = Math.max(0, ranSec ?? 0);
  if (!list.length || !ran) return 0;

  const headOf = (s) => (s.headcount === UNLIMITED ? Math.max(0, need) : s.headcount);
  const spans = list.map((s) => ({ sec: Math.max(0, s.minutes) * 60, head: headOf(s) }));
  const cycle = spans.reduce((t, s) => t + s.sec, 0);
  if (!cycle) return 0;

  const whole = Math.floor(ran / cycle);
  let acc = whole * spans.reduce((t, s) => t + s.sec * s.head, 0);
  let left = ran - whole * cycle;
  for (const s of spans) {
    if (left <= 0) break;
    const took = Math.min(left, s.sec);
    acc += took * s.head;
    left -= took;
  }
  return acc;
}

/* ---------- 한 판 전체 ----------------------------------------------------- */

const sum = (m) => Object.values(m ?? {}).reduce((t, n) => t + (Number(n) || 0), 0);

/**
 * 이번 실행의 원가 한 덩어리.
 *
 *  @param d.machines  [{ uid, name, placed }] — 원가를 물릴 설비
 *  @param d.ranSec    실제로 돈 시간
 *  @param d.stopOf    (uid) => 선 시간(초). 막힘+굶음+무인을 이미 더한 값
 *  @param d.cartSec   카트-초 합 (metrics 의 cartRan 을 다 더한 것)
 *  @param d.shifts    교대조
 *  @param d.crewNeed  정원이 무제한일 때 쓸 실제 필요 인원
 *  @param d.made      만든 개수 (불량 포함)
 *  @param d.good      쓸 수 있는 개수 (불량 뺀 것) — 개당 원가의 분모
 *  @param d.rates     단가표
 */
export function costOf(d = {}) {
  const rates = normalizeRates(d.rates);
  const ran = Math.max(0, d.ranSec ?? 0);
  const stopOf = d.stopOf ?? (() => 0);

  const rows = (d.machines ?? []).map((m) => ({
    name: m.name,
    ...machineCost(m.placed ?? m, ran, stopOf(m.uid), rates),
  }));

  const machine = {
    power: rows.reduce((t, r) => t + r.power, 0),
    fixed: rows.reduce((t, r) => t + r.fixed, 0),
    kwh: rows.reduce((t, r) => t + r.kwh, 0),
    idleBurn: rows.reduce((t, r) => t + r.idleBurn, 0),
  };

  const cartKwh = kwh(rates.cartKw, Math.max(0, d.cartSec ?? 0));
  const cart = cartKwh * rates.power;

  const manSec = crewSeconds(d.shifts, ran, d.crewNeed);
  const labor = perHour(rates.wage, manSec);

  const made = Math.max(0, d.made ?? 0);
  const good = Math.max(0, d.good ?? made);
  const material = rates.material * made;          // 불량도 자재는 먹었다

  const total = machine.power + machine.fixed + cart + labor + material;

  /**
   * 노는 동안 탄 돈. 인건비는 **통째로** 손실 몫에 들어가지 않는다 —
   * 라인이 100% 돌아도 인건비는 나가니까. 라인이 선 시간 비율만큼만 잡는다.
   */
  const stopSum = rows.reduce((t, r) => t + r.idleSec, 0);
  const runSum = rows.reduce((t, r) => t + r.runSec, 0);
  const stopShare = stopSum + runSum > 0 ? stopSum / (stopSum + runSum) : 0;
  const idleBurn = machine.idleBurn + labor * stopShare;

  return {
    rates,
    rows,
    ranSec: ran,
    parts: [
      { key: 'power', label: '설비 전력', won: machine.power },
      { key: 'labor', label: '인건비', won: labor },
      { key: 'cart', label: '카트 전력', won: cart },
      { key: 'fixed', label: '설비 고정비', won: machine.fixed },
      { key: 'material', label: '자재비', won: material },
    ].filter((p) => p.won > 0),
    total,
    /** 개당 원가 — 분모는 **쓸 수 있는 것**이다. 불량까지 나눠 담으면 싸 보인다 */
    per: good > 0 ? total / good : null,
    kwh: machine.kwh + cartKwh,
    manHours: manSec / 3600,
    made,
    good,
    /** 불량으로 버린 돈 — 만드는 데 든 돈 그대로 */
    scrapWon: made > 0 ? total * ((made - good) / made) : 0,
    idleBurn,
    stopShare,
    /** 한 시간에 얼마씩 타는가 — 배치끼리 견주기 좋은 단위 */
    perHour: ran > 0 ? (total * 3600) / ran : 0,
  };
}

/* ---------- 길게 보면 얼마인가 ---------------------------------------------
     시뮬은 몇 분 돌린다. 그런데 사람이 궁금한 것은 「그래서 1년이면 얼마냐」다.
     시간당 값은 **돌린 길이와 무관**하므로 곱하기만 하면 되는데, 그 곱셈을
     사람에게 시키면 아무도 안 한다.
--------------------------------------------------------------------------- */

/** 며칠·몇 달을 볼 것인가 — 시간으로 환산해 둔다 */
export const HORIZONS = [
  ['하루', 24],
  ['한 주', 24 * 7],
  ['한 달', 24 * 30],
  ['한 해', 24 * 365],
];

/**
 * **이 속도가 그대로 이어진다면** 그 기간에 얼마가 들고 얼마가 나오나.
 * ---------------------------------------------------------------------------
 *  단순한 곱셈이지만 가정이 하나 숨어 있다 — **쉬지 않고 이 속도로 돈다**는 것.
 *  고장·정비·명절·주문 공백은 안 들어 있다. 그래서 이 값은 「예상 비용」이
 *  아니라 **「지금 배치의 상한」** 이고, 화면과 보고서가 그 말을 같이 해야 한다.
 *
 *  @param perHour   시간당 원가 (costOf 의 perHour)
 *  @param madePerHour 시간당 산출 개수 (metrics 의 throughput)
 */
export function projectRun(perHour, madePerHour, horizons = HORIZONS) {
  const rate = Math.max(0, Number(perHour) || 0);
  const out = Math.max(0, Number(madePerHour) || 0);
  return horizons.map(([label, hours]) => ({
    label,
    hours,
    won: rate * hours,
    made: out * hours,
  }));
}

/**
 * 이만큼 돌린 것으로 **말이 되는가**.
 * ---------------------------------------------------------------------------
 *  짧게 돌린 결과를 1년으로 곱하면 틀린 숫자가 아주 그럴듯한 얼굴로 나온다.
 *  무엇이 기간을 정하는지는 그 도면이 정한다 —
 *
 *    · 라인이 차는 시간   비기 전까지는 처리량이 실제보다 높게 나온다
 *    · 고장 주기(MTBF)    한 번도 안 고장 나면 가동률이 100% 로 보인다
 *    · 교대 한 바퀴       조가 안 바뀌면 사람 부족이 드러나지 않는다
 *
 *  @returns { ok, need, why } — need 는 「적어도 이만큼(초)」
 */
export function longEnough(ranSec, { mtbfSec = 0, shiftCycleSec = 0, warmSec = 60 } = {}) {
  /* 셋 중 **가장 긴 것**이 기간을 정하고, 말도 그것을 따라가야 한다.
     처음엔 이유를 순서대로 쌓고 첫 줄을 돌려줬더니, 교대가 정한 8시간을
     놓고 「고장이 몇 번은 나야」 라고 말했다 — 엉뚱한 데를 고치게 만든다. */
  const cands = [
    { need: warmSec, why: '라인이 다 차기 전에는 처리량이 실제보다 높게 나온다' },
    ...(mtbfSec > 0 ? [{ need: mtbfSec * 3, why: '고장이 몇 번은 나야 가동률이 사실이 된다' }] : []),
    ...(shiftCycleSec > 0 ? [{ need: shiftCycleSec, why: '교대가 한 바퀴는 돌아야 사람 부족이 드러난다' }] : []),
  ];
  const top = cands.reduce((a, b) => (b.need > a.need ? b : a));
  return { ok: (ranSec ?? 0) >= top.need, need: top.need, why: top.why };
}

/** 원 단위 사람이 읽는 표기 — 1,234만 원 / 12.3억 원 */
export function won(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)}억 원`;
  if (a >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만 원`;
  return `${Math.round(v).toLocaleString()}원`;
}

/**
 * **개당** 원가처럼 작고 촘촘한 금액.
 * ---------------------------------------------------------------------------
 *  `won()` 은 원 단위로 반올림한다. 총액에서는 그게 맞지만 개당 원가에서는
 *  **3.03원과 2.87원이 둘 다 「3원」이 된다** — 개당 원가를 나란히 놓고 견주는
 *  자리에서 그 반올림은 곧 「안 바뀌었다」 는 거짓말이다. 개선 계산이 「싸진다」
 *  고 말하는데 숫자 둘이 똑같이 찍히면 그 화면은 못 믿는다.
 */
export function unitWon(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e4) return won(v);
  if (a >= 100) return `${Math.round(v).toLocaleString()}원`;
  if (a >= 1) return `${v.toFixed(2)}원`;
  return `${v.toFixed(3)}원`;
}
