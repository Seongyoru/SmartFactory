/**
 * =============================================================================
 *  생산 오더 — 라인에 **끝나는 조건**을 준다
 * =============================================================================
 *  지금까지 이 도면은 켜면 영원히 돌기만 했다. 그래서 계획하는 사람이 실제로 묻는
 *  질문에 답할 수가 없었다 — *조립품 500개 주문 들어왔는데 언제 끝나?*
 *
 *  오더가 생기면 세 가지가 따라온다.
 *    ① 목표가 있으니 **진척**을 말할 수 있다
 *    ② 납기가 있으니 **늦는지**를 말할 수 있다
 *    ③ 끝나는 조건이 있으니 시뮬을 **사람이 눈대중으로 멈추지 않아도** 된다
 *
 *  ── 무엇을 「완료」로 셀 것인가 ───────────────────────────────────────────
 *   둘 다 **누적**이다. 지나간 것은 지나간 것이다.
 *
 *     출하        트럭이 공장 밖으로 싣고 나간 누계
 *     도착 지점   고른 적치대·선반을 **거쳐 간** 누계
 *
 *   처음에는 도착 지점을 「지금 쌓여 있는 수」로 셌다. 그런데 적치대가 200칸이면
 *   400개짜리 오더는 **영영 안 끝난다** — 담을 데가 없어서지 못 만들어서가 아니다.
 *   「이 창고를 채워라」 와 「500개를 만들어라」 는 다른 지시고, 오더는 뒤쪽이다.
 *   그래서 자리는 **세는 지점**이지 채울 그릇이 아니다(simStore 의 arrivedOf).
 *
 *  ── 속도는 **오더 자신의 진척**으로 잰다 ─────────────────────────────────
 *   종류별 생산 속도를 따로 재는 배관을 새로 놓지 않았다. 오더가 시작한 뒤로
 *   얼마나 찼는지를 흐른 시간으로 나누면 그것이 곧 그 오더의 속도다. 라인이
 *   채워지기 전에는 숫자가 사람을 속이므로(몇 초 만에 한 개만 나가도 수천 개/시간)
 *   충분히 흐르기 전에는 **아무 말도 안 한다** — `throughput()` 과 같은 태도다.
 * ---------------------------------------------------------------------------
 */

import { DEFAULT_KIND, canonKind } from '../data/library.js';

/** 완료를 어디서 세는가 */
export const DONE_AT = {
  /** 트럭이 공장 밖으로 싣고 나간 수 */
  SHIP: 'ship',
  /** 고른 적치대·선반에 지금 쌓여 있는 수 */
  STORE: 'store',
};

/** 오더 상태 */
export const ORDER = {
  DONE: 'done',           // 다 채웠다
  MEASURING: 'measuring', // 아직 속도를 못 잰다 (라인이 채워지는 중)
  NO_DUE: 'nodue',        // 납기를 안 정했다
  ON_TIME: 'ontime',      // 이대로면 맞는다
  LATE: 'late',           // 이대로면 늦는다
};

/** 속도를 말하기 전에 최소한 이만큼은 흘러야 한다 (초) */
const WARMUP_SEC = 20;

export const DEFAULT_ORDER = {
  name: '',
  kind: DEFAULT_KIND,
  qty: 100,
  /** 납기(분). 0 이면 납기를 안 따진다 */
  dueMin: 0,
  at: DONE_AT.SHIP,
  /** at 이 STORE 일 때 어디에 쌓이는가 */
  atUid: null,
};

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * 저장된 것을 지금 규약으로 맞춘다.
 *  옛 도면에는 오더가 아예 없다 — 그때는 빈 목록이고, 그러면 이 기능이 통째로
 *  안 보인다(없던 도면이 갑자기 「납기 초과」 로 붉어지면 안 된다).
 */
export function normalizeOrders(list) {
  if (!Array.isArray(list)) return [];
  return list.map((o, i) => ({
    uid: o?.uid ?? `O${i + 1}`,
    name: typeof o?.name === 'string' ? o.name : '',
    kind: canonKind(o?.kind) ?? DEFAULT_KIND,
    qty: Math.max(1, Math.round(num(o?.qty, DEFAULT_ORDER.qty))),
    dueMin: Math.max(0, num(o?.dueMin, 0)),
    at: o?.at === DONE_AT.STORE ? DONE_AT.STORE : DONE_AT.SHIP,
    atUid: o?.at === DONE_AT.STORE ? (o?.atUid ?? null) : null,
  }));
}

/**
 * 이 오더가 지금 몇 개인가 — **둘 다 누적이다.**
 *  @param shipped   { 종류: 개수 } 출하 누계
 *  @param arrivedOf (uid, 종류) => 그 자리를 거쳐 간 누계
 */
export function doneOf(order, { shipped = {}, arrivedOf = () => 0 } = {}) {
  if (!order) return 0;
  if (order.at === DONE_AT.STORE) {
    return order.atUid ? Math.max(0, arrivedOf(order.atUid, order.kind) ?? 0) : 0;
  }
  return Math.max(0, shipped?.[order.kind] ?? 0);
}

export const remainOf = (order, done) => Math.max(0, (order?.qty ?? 0) - Math.max(0, done));

/**
 * 종류마다 **얼마나 급하고 얼마나 밀렸나** — 디스패칭이 읽는 값.
 * ---------------------------------------------------------------------------
 *  설비가 「다음에 무엇을 만들까」를 정할 때 보는 것이 이것뿐이다(`dispatch.js`).
 *  고르는 규칙은 순수 함수로 두고, **재고와 시계를 읽는 일은 여기서** 한다 —
 *  두 곳에서 읽으면 화면과 헤드리스가 서로 다른 값을 본다.
 *
 *  한 종류에 오더가 여럿이면 **가장 급한 것**을 그 종류의 값으로 본다.
 *  다 찬 오더는 안 본다 — 끝난 것을 계속 만들면 남은 오더가 영영 안 끝난다.
 *
 *  ── 열쇠가 **(설비, 종류)** 인 까닭 ──────────────────────────────────────
 *  한때는 종류만이었다. 그러면 그 종류를 만드는 설비가 **전부** 그 오더에 끌려
 *  간다 — 산출이 오더의 목적지에 닿든 말든. 적치대로 보내는 제작기와 조립기로
 *  보내는 제작기가 함께 끌려가 **조립기가 굶어 라인이 섰다**(실측: 조립품 93 → 0,
 *  그런데 적치대 진척은 192 로 똑같았다 — 끌려간 쪽의 기여가 0 이었다).
 *
 *  그래서 설비를 받아 「이 설비가 도울 수 있는 오더」만 본다. 닿는지 모르면
 *  닿는 것으로 본다(`reach.js`) — 덜 걸러내는 쪽으로 틀려야 한다.
 *
 *  @param ctx.reaches (설비 uid, 목적지 uid) => 닿는가 · 없으면 전부 닿는다
 *  @returns (설비 uid) => (종류) => { due, ratio } · 볼 오더가 없으면 null
 *            due   남은 납기(초). 납기를 안 정했으면 Infinity(급하지 않다)
 *            ratio 진척 0~1
 */
export function orderInfoOf(orders, ctx = {}, elapsedSec = 0) {
  const rows = normalizeOrders(orders);
  if (!rows.length) return () => () => null;
  const reaches = typeof ctx.reaches === 'function' ? ctx.reaches : () => true;

  const build = (uid) => {
    const by = new Map();
    for (const o of rows) {
      /**
       * **이 설비가 도울 수 있는 오더인가.**
       *  자리에 쌓는 오더만 가린다. 출하 오더는 어디로 나가는지 도면이 말해
       *  주지 않으므로 전부 해당하는 것으로 본다.
       */
      if (o.at === DONE_AT.STORE && o.atUid && uid && !reaches(uid, o.atUid)) continue;
      const done = doneOf(o, ctx);
      if (done >= o.qty) continue;                       // 다 찼다
      const due = o.dueMin > 0 ? o.dueMin * 60 - elapsedSec : Infinity;
      const cur = { due, ratio: progressOf(o, done) };
      const had = by.get(o.kind);
      /* 같은 종류에 오더가 여럿이면 **더 급한 쪽**을 남긴다 */
      if (!had || cur.due < had.due) by.set(o.kind, cur);
    }
    return (kind) => by.get(kind) ?? null;
  };

  /* 설비마다 한 번만 세운다 — 이 함수 자체가 틱마다 새로 만들어지므로
     여기 담긴 것은 그 틱 동안만 산다 */
  const cache = new Map();
  return (uid) => {
    let f = cache.get(uid);
    if (!f) { f = build(uid); cache.set(uid, f); }
    return f;
  };
}
/**
 * 이 규칙이 **이 도면에서 실제로 도는가** — 안 돌면 그 까닭을 말한다.
 * ---------------------------------------------------------------------------
 *  「납기 먼저」를 골라 두고 오더에 납기를 안 넣으면, 규칙은 아무것도 안 하고
 *  조용히 「차례대로」가 된다. 라인은 잘 돌고 값도 그럴듯해서 **화면만 보고는
 *  알 방법이 없다.** 실제로 그 상태로 한참 시험하다 「납기 먼저는 고장인가」로
 *  이어졌다.
 *
 *  ── 왜 「밀린 것 먼저」는 되고 「납기 먼저」는 안 되나 ────────────────────
 *  같은 오더인데 **한쪽만 읽을 값이 있어서**다. 납기를 안 정하면 남은 납기는
 *  `Infinity` 라 견줄 수가 없어 아예 탈락한다(`dispatch.js`). 진척은 0 이라도
 *  멀쩡한 값이라 견줘진다. 규칙이 고장 난 것이 아니라 **먹일 것이 없던 것**이다.
 *
 *  @param rule  RULE 중 하나
 *  @param orders 도면의 오더 전부
 *  @param kinds 이 설비가 만드는 종류들
 *  @returns 사람에게 할 말 · 아무 문제 없으면 null
 */
export function ruleGap(rule, orders = [], kinds = []) {
  if (rule !== 'due' && rule !== 'behind') return null;
  const mine = normalizeOrders(orders).filter((o) => kinds.includes(o.kind));
  if (!mine.length) {
    return '이 설비가 만드는 품종에 걸린 오더가 없습니다 — 차례대로 돌아갑니다.';
  }
  if (rule === 'due' && !mine.some((o) => o.dueMin > 0)) {
    return '오더에 납기가 없습니다 — 납기를 넣어야 이 규칙이 돕니다. 지금은 차례대로 돌아갑니다.';
  }
  if (mine.length === 1 && kinds.length > 1) {
    /* 견줄 상대가 없다 — 틀린 것은 아니지만 「왜 늘 이것만 만들지」의 답이다 */
    return '오더가 한 품종에만 걸려 있습니다 — 그것을 다 만들 때까지 그것만 만듭니다.';
  }
  return null;
}

export const progressOf = (order, done) =>
  (order?.qty > 0 ? Math.min(1, Math.max(0, done / order.qty)) : 0);

/**
 * 지금까지의 속도 (개/분). 아직 말할 수 없으면 null.
 *  라인이 채워지기 전에는 숫자가 사람을 속인다 — 몇 초 만에 한 개만 나가도
 *  수천 개/시간이 된다.
 */
export function ratePerMin(done, elapsedSec) {
  if (!(elapsedSec >= WARMUP_SEC) || !(done > 0)) return null;
  return (done / elapsedSec) * 60;
}

/** 다 채우기까지 남은 시간(초). 속도를 모르면 null, 이미 다 됐으면 0 */
export function etaSec(order, done, rate) {
  const left = remainOf(order, done);
  if (left <= 0) return 0;
  if (!(rate > 0)) return null;
  return (left / rate) * 60;
}

/**
 * 이 오더가 어떤 상태인가.
 *  @returns { state, done, left, ratio, rate, eta, dueSec, slackSec }
 *           slackSec 은 납기까지 남는 여유(음수면 그만큼 초과)
 */
export function statusOf(order, ctx, elapsedSec) {
  const done = doneOf(order, ctx);
  const left = remainOf(order, done);
  const ratio = progressOf(order, done);
  const rate = ratePerMin(done, elapsedSec);
  const eta = etaSec(order, done, rate);
  const dueSec = (order?.dueMin ?? 0) > 0 ? order.dueMin * 60 : null;

  let state = ORDER.MEASURING;
  let slackSec = null;
  if (left <= 0) state = ORDER.DONE;
  else if (dueSec == null) state = rate == null ? ORDER.MEASURING : ORDER.NO_DUE;
  else if (eta == null) state = ORDER.MEASURING;
  else {
    /* 남은 납기 안에 끝낼 수 있는가 — 지금 속도 그대로라면 */
    slackSec = dueSec - elapsedSec - eta;
    state = slackSec >= 0 ? ORDER.ON_TIME : ORDER.LATE;
  }
  return { state, done, left, ratio, rate, eta, dueSec, slackSec };
}

/** 늦는 오더가 하나라도 있는가 — 원인 사슬을 띄울지 정하는 데 쓴다 */
export const anyLate = (rows) => (rows ?? []).some((r) => r.state === ORDER.LATE);

/** 오더가 있고 **전부** 채워졌는가 (없으면 false — 멈출 이유가 없다) */
export const allDone = (rows) =>
  (rows?.length ?? 0) > 0 && rows.every((r) => r.state === ORDER.DONE);

/** 「3시간 20분」 · 「12분」 · 「40초」 — 남은 시간을 사람이 읽는 단위로 */
export function formatSpan(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분`;
  return `${s}초`;
}
