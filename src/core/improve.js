/**
 * =============================================================================
 *  개선 — 「그래서 얼마 이득인가」
 * =============================================================================
 *  두 모듈이 이미 각자 답을 갖고 있었는데, **아무도 둘을 잇지 않고 있었다.**
 *
 *      balance.js   「제작기2 를 고치면 5 → 10개/분」
 *      cost.js      「지금 개당 1,240원」
 *
 *  실제로 배치를 고민할 때 하는 질문은 그 **사이**에 있다 —
 *  「제작기를 한 대 더 놓을까?」 그 답은 능력만으로도, 돈만으로도 안 나온다.
 *  설비를 한 대 더 놓으면 **분모(만드는 개수)와 분자(나가는 돈)가 함께** 커지고,
 *  어느 쪽이 더 크게 커지느냐가 곧 답이다.
 *
 *  ── 돌리기 전에 답한다 ────────────────────────────────────────────────────
 *  `cost.js` 의 `costOf` 는 **돌린 뒤**의 원가다(잰 시간에 단가를 곱한다). 여기는
 *  돌리기 전이므로 잴 시간이 없다. 대신 **「라인이 쉬지 않고 돈다면」** 을 놓고
 *  시간당으로 센다. 그래서 여기 숫자는 늘 실제보다 **좋게** 나온다 — 고장도
 *  없고 굶지도 않는 라인의 값이다. 그것이 곧 `balance` 가 말하는 천장의 원가이고,
 *  두 화면이 같은 가정 위에 서 있어야 나란히 놓고 견줄 수 있다.
 *
 *  ── 「푼다」 가 무슨 뜻인지 종류마다 다르다 ────────────────────────────────
 *  이것이 이 모듈의 요점이다. 병목이라고 다 같은 병목이 아니다.
 *
 *      설비   한 대 더 놓는다 → 전력·고정비·**사람**이 그만큼 더 든다
 *      벨트   「한 번에」를 늘리거나 빠르게 → **돈이 안 든다**
 *      카트   한 대 더 → 카트 전력만
 *
 *  그래서 **벨트가 병목이면 그것은 공짜로 고칠 수 있는 병목이다.** 이 한 줄을
 *  말해 주는 것만으로도 이 모듈은 값을 한다 — 설비를 사려다 말게 되니까.
 *
 *  ── 사람은 늘 따라 붙는다 ─────────────────────────────────────────────────
 *  설비 한 대를 더 놓으면 그 설비에 붙일 사람도 있어야 한다. 정원을 안 늘리면
 *  그 설비는 **무인으로 선다** — 즉 늘린 값이 없다. 그래서 정원을 어떻게
 *  두었든 인건비를 함께 물린다. 안 물리면 「공짜로 두 배」 라는 거짓말이 된다.
 * ---------------------------------------------------------------------------
 */

import { TIE, bottleneckChain } from './balance.js';
import { crewSeconds, fixedOf, normalizeRates, runKwOf } from './cost.js';
import { crewOf, cycleSeconds } from './crew.js';

/** 설비를 한 대 더 놓으면 그 고리는 두 배가 된다 */
export const DOUBLE = 2;

/**
 * 라인이 **쉬지 않고 돌 때** 시간당 나가는 돈.
 * ---------------------------------------------------------------------------
 *  `costOf` 와 갈라지는 지점은 하나다 — 저기는 「선 시간」을 알고 대기 전력으로
 *  깎지만, 여기는 설 일이 없다고 본다. 천장을 이야기하는 자리이므로 **설비는
 *  늘 돌고 있다**(runKw)고 두는 것이 앞뒤가 맞는다.
 *
 *  @param d.machines 전기를 먹는 설비들(선반·적치대는 부른 쪽에서 뺀다)
 *  @param d.carts    카트·트럭 (`count` 대수만큼 전력을 먹는다)
 *  @param d.shifts   교대조 — 조마다 정원이 다르므로 **한 바퀴 평균**을 쓴다
 *  @param d.crewNeed 정원이 무제한일 때 대신 쓸 실제 필요 인원
 */
export function hourlyCost(d = {}) {
  const rates = normalizeRates(d.rates);
  const machines = d.machines ?? [];
  const carts = d.carts ?? [];

  const power = machines.reduce((t, p) => t + runKwOf(p) * rates.power, 0);
  const fixed = machines.reduce((t, p) => t + fixedOf(p), 0);
  const cartKw = carts.reduce((t, c) => t + Math.max(1, Math.round(c?.count ?? 1)) * rates.cartKw, 0);
  const cart = cartKw * rates.power;

  /* 사람-초를 한 바퀴만큼 내서 시간당 평균 인원으로 되돌린다. 한 시간만 재면
     첫 조만 보게 되는데, 조마다 정원이 다르면 그건 그 도면의 평균이 아니다. */
  const cyc = cycleSeconds(d.shifts) || 3600;
  const heads = crewSeconds(d.shifts, cyc, d.crewNeed ?? 0) / cyc;
  const labor = heads * rates.wage;

  return { rates, power, fixed, cart, labor, heads, total: power + fixed + cart + labor };
}

/**
 * 개당 원가 — 시간당 돈 ÷ 시간당 개수, 거기에 자재비.
 *  자재비는 시간과 무관하게 **개당** 붙으므로 나누는 쪽이 아니라 더하는 쪽이다.
 */
export function unitCost(hourlyWon, perMinute, material = 0) {
  const qty = Math.max(0, perMinute ?? 0) * 60;
  if (!(qty > 0)) return null;
  return Math.max(0, hourlyWon ?? 0) / qty + Math.max(0, material);
}

/**
 * 고리 몇 개에 배수를 걸고 라인 능력을 다시 낸다.
 *  「그다음 병목이 어디서 걸리는가」 를 `bottleneckChain` 의 예측이 아니라
 *  **다시 계산해서** 얻는다 — 배수가 종류마다 다르므로(카트는 2배가 아니다)
 *  묶음의 다음 능력을 그대로 갖다 쓰면 틀린다.
 */
export function capacityWith(rows, boost = {}) {
  let min = Infinity;
  for (const r of rows ?? []) {
    const f = boost[r.uid];
    const c = r.capacity * (f > 0 ? f : 1);
    if (Number.isFinite(c) && c < min) min = c;
  }
  return Number.isFinite(min) ? min : 0;
}

/**
 * 이 고리 하나를 한 단계 키우면 — **무엇을 손보고 얼마가 더 드는가.**
 *  @returns { uid, name, kind, what, factor, won, crew, free }
 */
export function stepFor(row, ctx = {}) {
  const rates = normalizeRates(ctx.rates);
  const base = { uid: row?.uid, name: row?.name, kind: row?.kind };

  if (row?.kind === 'belt') {
    /* 벨트 능력은 「한 번에 몇 개」와 속도에서 나온다(process.spacingFor).
       둘 다 값을 바꾸는 일이지 물건을 사는 일이 아니다 — 그래서 0원이다. */
    return { ...base, what: '「한 번에」를 늘리거나 벨트를 빠르게', factor: DOUBLE, won: 0, crew: 0, free: true };
  }

  if (row?.kind === 'cart' || row?.kind === 'truck') {
    const n = Math.max(1, Math.round(ctx.cart?.count ?? 1));
    return {
      ...base,
      what: `배치 대수 ${n} → ${n + 1}대`,
      /* 대수에 비례해 나른다 — 두 배가 아니라 (n+1)/n 이다 */
      factor: (n + 1) / n,
      won: rates.cartKw * rates.power,
      crew: 0,
      free: false,
    };
  }

  const crew = crewOf(ctx.machine);
  return {
    ...base,
    kind: 'equip',
    what: '같은 설비 1대 더',
    factor: DOUBLE,
    /* 사람을 빼면 「공짜로 두 배」 라는 거짓말이 된다 — 위 머리글 참고 */
    won: runKwOf(ctx.machine) * rates.power + fixedOf(ctx.machine) + crew * rates.wage,
    crew,
    free: false,
  };
}

/**
 * 가장 약한 고리 묶음을 **함께** 풀면 얼마가 이득인가.
 * ---------------------------------------------------------------------------
 *  묶음째 다루는 이유는 `balance.js` 와 같다 — 같은 능력의 고리가 둘이면 하나만
 *  고쳐 봐야 하나도 안 오르고, 그러면 「1대 더 = +0개/분 · +12,000원」 이라는
 *  쓸모없는 답이 나온다.
 *
 *  @returns null 이면 견줄 것이 없다(고리가 없거나 능력이 0)
 */
export function improvePlan(d = {}) {
  const rows = (d.rows ?? []).filter((r) => Number.isFinite(r.capacity));
  if (!rows.length) return null;

  const chain = bottleneckChain(rows, 2);
  if (!chain.length) return null;
  const neck = chain[0];

  const machineBy = new Map((d.machines ?? []).map((p) => [p.uid, p]));
  const cartBy = new Map((d.carts ?? []).map((c) => [c.uid, c]));

  const base = hourlyCost(d);
  const { rates } = base;

  const boost = {};
  const steps = [];
  let addWon = 0;
  let addCrew = 0;
  for (const it of neck.items) {
    const s = stepFor(it, { machine: machineBy.get(it.uid), cart: cartBy.get(it.uid), rates });
    boost[it.uid] = s.factor;
    addWon += s.won;
    addCrew += s.crew;
    steps.push(s);
  }

  const nowCap = capacityWith(rows);
  const afterCap = capacityWith(rows, boost);

  const now = { capacity: nowCap, hourly: base.total, unit: unitCost(base.total, nowCap, rates.material) };
  const afterHourly = base.total + addWon;
  const after = { capacity: afterCap, hourly: afterHourly, unit: unitCost(afterHourly, afterCap, rates.material) };

  const unitDelta = now.unit != null && after.unit != null ? after.unit - now.unit : null;

  /**
   * 「한 대 더」로 **거기까지 못 갈 수도 있다.**
   * -------------------------------------------------------------------------
   *  위 목록은 「이 고리를 없애면 10개/분」 이라고 말한다. 그건 고리를 **통째로
   *  치웠을 때**의 값이다. 그런데 실제로 할 수 있는 일은 한 대 더 놓는 것이고,
   *  3 → 6 이면 아직 10 에 못 미친다. 두 숫자를 나란히 놓고 아무 말도 안 하면
   *  **모순처럼 읽힌다** — 한 대로는 모자란다는 것을 여기서 말해야 한다.
   */
  const ceiling = neck.then ?? null;
  const reaches = ceiling == null || afterCap >= ceiling * (1 - TIE);

  return {
    steps,
    addWon,
    addCrew,
    now,
    after,
    ceiling,
    reaches,
    gain: afterCap - nowCap,
    unitDelta,
    verdict: verdictOf(unitDelta, now.unit),
    worth: verdictOf(unitDelta, now.unit) === 'win',
    /** 돈 한 푼 안 들이고 오르는가 — 벨트만 병목일 때가 그렇다 */
    free: addWon === 0 && afterCap > nowCap,
  };
}

/** 개당 원가가 이 안쪽으로 붙어 있으면 **안 바뀐 것**으로 본다 (0.5%) */
export const UNIT_TIE = 0.005;

/**
 * 남는 장사인가 — **세 갈래다.**
 * ---------------------------------------------------------------------------
 *  처음에는 「싸지면 남는 장사, 아니면 밑지는 장사」 둘로 갈랐다. 그런데 실제로
 *  돌려 보니 가장 흔한 판이 걸렸다 — **설비를 통째로 두 배로 하면 능력도 두 배,
 *  돈도 두 배라 개당 원가가 정확히 같다.** 그걸 「밑지는 장사」라고 빨갛게 찍으면
 *  거짓말이다. 밑지는 게 아니라 **본전**이고, 같은 값에 두 배를 만드는 것은
 *  대개 하고 싶은 일이다.
 *
 *  @returns 'win' 싸진다 · 'even' 그대로(양만 는다) · 'lose' 비싸진다
 */
export function verdictOf(unitDelta, unitNow) {
  if (unitDelta == null || !Number.isFinite(unitDelta)) return null;
  const band = Math.max(1e-9, Math.abs(unitNow ?? 0) * UNIT_TIE);
  if (unitDelta < -band) return 'win';
  if (unitDelta > band) return 'lose';
  return 'even';
}

/**
 * 「얼마나 싸지나」 를 사람이 읽는 문구로. 내리면 ▼, 오르면 ▲.
 *  개당 원가의 차이라 원 단위로 반올림하면 안 된다(cost.js 의 unitWon 참고).
 */
export const deltaText = (delta) => {
  if (delta == null || !Number.isFinite(delta)) return '—';
  const a = Math.abs(delta);
  if (a < 0.001) return '그대로';
  const v = a >= 100 ? Math.round(a).toLocaleString() : a >= 1 ? a.toFixed(2) : a.toFixed(3);
  return `${delta < 0 ? '▼' : '▲'} ${v}원`;
};
