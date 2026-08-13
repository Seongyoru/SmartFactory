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
