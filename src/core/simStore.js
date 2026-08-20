/**
 * =============================================================================
 *  시뮬레이션 상태 — 선반 재고
 * =============================================================================
 *  카트가 선반에 부린 수량은 "도면" 이 아니라 "지금 돌아가는 상황" 이다.
 *  에디터 상태(useReducer)에 넣으면 자재를 내려놓을 때마다 자동 저장이 돌고
 *  화면 전체가 리렌더된다. 그래서 도면과 분리된 작은 저장소에 둔다.
 *
 *  새로고침하면 비워진다 — 재고는 배치 결과가 아니라 시뮬레이션 결과이므로
 *  도면 파일에 섞이지 않는 편이 낫다.
 * ---------------------------------------------------------------------------
 */

import { useSyncExternalStore } from 'react';
/* 종류 이름을 문자열로 박아 두지 않는다 — 목록에서 사라진 이름이 재고에만 남으면
   그리는 쪽이 아무것도 못 그린다. 기준은 라이브러리 한 곳에 있다. */
import { DEFAULT_KIND, canonKind } from '../data/library.js';

let stock = {};            // { [선반 uid]: 적재 수량 }

/**
 * 무엇이 쌓여 있는가 — { [uid]: [종류, 종류, …] }
 * ---------------------------------------------------------------------------
 *  **자리마다 따로** 기억한다. 배열의 i 번째가 i 번 슬롯(아래에서부터)에 놓인
 *  물건의 종류다. 그래서 한 선반에 회색과 노란색이 섞여 쌓일 수 있다.
 *
 *  처음에는 자리마다 종류 하나만("여기는 노란 물건 자리") 들고 있었는데, 그러면
 *  다른 물건이 하나만 들어와도 **쌓여 있던 것 전체가** 그 색으로 바뀐다.
 *  개수 하나로는 "몇 개 중 몇 개가 무엇" 을 표현할 수 없기 때문이다.
 *
 *  개수(stock)는 그대로 둔다. 수용량·게이지·카트 판정이 전부 개수를 보고
 *  움직이고 있어서, 배열 길이로 갈아치우면 그 계산들이 전부 이 배열의 형태를
 *  알아야 한다. 둘은 **항상 같은 길이**로 유지한다.
 */
let lots = {};
const EMPTY = [];
const subs = new Set();

const emit = () => subs.forEach((f) => f());
const subscribe = (f) => {
  subs.add(f);
  return () => subs.delete(f);
};

export const getStock = (uid) => stock[uid] ?? 0;
export const getAllStock = () => stock;

/** 자리별 종류 목록 (아래에서부터). 없으면 빈 배열 — 참조는 항상 같은 것을 준다 */
export const getLots = (uid) => lots[uid] ?? EMPTY;

export const useLots = (uid) =>
  useSyncExternalStore(subscribe, () => lots[uid] ?? EMPTY, () => EMPTY);

/** 맨 위(마지막)에 있는 종류 — 요약 표시용 */
export const getKind = (uid) => {
  const l = lots[uid];
  return l?.length ? l[l.length - 1] : null;
};

/* --------------------------------------------------------------------------
 * 여기까지 **거쳐 간** 수 — 생산 오더가 세는 값
 * --------------------------------------------------------------------------
 *  처음에는 오더를 「지금 쌓여 있는 수」로 셌다. 그런데 적치대가 200칸이면
 *  400개짜리 오더는 **영영 안 끝난다** — 담을 데가 없어서지 못 만들어서가 아니다.
 *  「이 창고를 채워라」 와 「500개를 만들어라」 는 다른 지시다.
 *
 *  그래서 자리마다 **누적 도착 수**를 따로 센다. 쌓인 것이 카트에 실려 나가도
 *  이 수는 안 준다 — 지나간 것은 지나간 것이다. 출하 누계와 같은 성질이라
 *  같은 자리에 둔다.
 */
let arrived = {};             // { [uid]: { [종류]: 누적 도착 수 } }
const EMPTY_ARRIVED = {};

export const arrivedOf = (uid, kind) => arrived[uid]?.[kind] ?? 0;
export const arrivedAt = (uid) => arrived[uid] ?? EMPTY_ARRIVED;
export const getAllArrived = () => arrived;

/** 실제로 자리에 놓인 것만 센다 — 못 넣고 되돌아간 것은 안 센다 */
function noteArrival(uid, kinds) {
  if (!kinds?.length) return;
  const cur = arrived[uid] ?? {};
  const next = { ...cur };
  for (const k of kinds) next[k] = (next[k] ?? 0) + 1;
  arrived = { ...arrived, [uid]: next };
}

export const resetArrived = () => { arrived = {}; emit(); };

/** 개수와 종류 목록을 한 번에 맞춘다 — 둘이 어긋나면 그리는 쪽이 무너진다 */
function commit(uid, list) {
  stock = { ...stock, [uid]: list.length };
  lots = { ...lots, [uid]: list };
  emit();
}

/**
 * 적재 — 수용량을 넘지 않는 만큼만 받고, 실제로 받은 수를 돌려준다.
 *  @param kind 들어오는 물건의 종류. 받은 개수만큼 **위에 쌓인다**.
 */
export function addStock(uid, amount, capacity = Infinity, kind = DEFAULT_KIND) {
  return addLots(uid, Array.from({ length: Math.max(0, Math.round(amount)) }, () => kind), capacity);
}

/**
 * 여러 종류를 한 번에 적재한다 (카트가 섞어 온 짐을 내릴 때).
 *  들어온 순서 그대로 위로 쌓인다 — 섞여 온 것은 섞인 채로 남아야 한다.
 */
export function addLots(uid, kindList, capacity = Infinity) {
  const cur = getLots(uid);
  const room = Math.max(0, Math.floor(capacity) - cur.length);
  const take = kindList.slice(0, room);
  if (!take.length) return 0;
  noteArrival(uid, take);
  commit(uid, [...cur, ...take]);
  return take.length;
}

/**
 * **종류마다 자리가 정해진** 적재 (조립 설비의 입력 버퍼).
 * ---------------------------------------------------------------------------
 *  전체 수용량만 보고 받으면 빨리 들어오는 종류가 느린 종류의 자리를 먹어 치워
 *  **되돌릴 수 없는 교착**이 된다(bom.js 의 slotShares 참고). 자리를 미리 나눠
 *  두면 제 몫이 찬 종류는 더 못 들어오고, 그 벨트가 서면서 "앞 공정이 너무
 *  빠르다" 가 화면에 드러난다.
 *
 *  @param slotsOf (종류) => 그 종류에 배정된 자리 수. 없는 종류는 0 — **안 받는다**
 *  @returns { moved, left } · left 는 자리가 없어 못 넣은 것들
 *
 *  못 넣은 것을 **목록으로** 돌려주는 이유는 카트 때문이다. 개수만 주면 "몇 개가
 *  들어갔다" 는 알아도 **무엇이** 들어갔는지 몰라서, 카트에 남은 짐을 맞출 수가
 *  없다(앞에서부터 잘라 내면 안 들어간 종류가 사라진다).
 */
export function addLotsShared(uid, kindList, slotsOf) {
  const cur = getLots(uid);
  const have = {};
  for (const k of cur) have[k] = (have[k] ?? 0) + 1;

  const take = [];
  const left = [];
  for (const k of kindList ?? []) {
    if ((have[k] ?? 0) < (slotsOf(k) ?? 0)) {
      have[k] = (have[k] ?? 0) + 1;
      take.push(k);
    } else {
      left.push(k);
    }
  }
  if (take.length) { noteArrival(uid, take); commit(uid, [...cur, ...take]); }
  return { moved: take.length, left };
}

/**
 * **묶음마다 자리가 정해진** 적재 (줄을 나눈 선반).
 * ---------------------------------------------------------------------------
 *  `addLotsShared` 와 닮았지만 자리를 **종류가 아니라 묶음**으로 센다. 선반의
 *  「안 정한 줄」 은 여러 종류가 함께 쓰는 한 통이라, 종류마다 따로 세면 그 통이
 *  종류 수만큼 뻥튀기된다 — 공용 두 줄에 세 종류가 오면 여섯 줄치가 들어간다.
 *
 *  @param binOf (종류) => { id, cap } · id 가 null 이면 그 종류는 **안 받는다**
 *  @returns { moved, left } · left 는 자리가 없어 못 넣은 것들 (카트가 싣고 간다)
 */
export function addByGroup(uid, kindList, binOf) {
  const cur = getLots(uid);
  const used = {};
  for (const k of cur) {
    const b = binOf(k);
    if (b?.id) used[b.id] = (used[b.id] ?? 0) + 1;
  }

  const take = [];
  const left = [];
  for (const k of kindList ?? []) {
    const b = binOf(k);
    if (b?.id && (used[b.id] ?? 0) < b.cap) {
      used[b.id] = (used[b.id] ?? 0) + 1;
      take.push(k);
    } else {
      left.push(k);
    }
  }
  if (take.length) { noteArrival(uid, take); commit(uid, [...cur, ...take]); }
  return { moved: take.length, left };
}

/**
 * 한 종류만 통째로 버린다 (엉킨 버퍼를 손으로 푸는 자리).
 *  @returns 버린 개수
 */
export function dropKind(uid, kind) {
  const cur = getLots(uid);
  const left = cur.filter((k) => k !== kind);
  if (left.length === cur.length) return 0;
  commit(uid, left);
  return cur.length - left.length;
}

/**
 * 출고 — 있는 만큼만 내주고, **무엇을 내줬는지** 종류 목록으로 돌려준다.
 *  위(마지막)에서부터 꺼낸다. 아래에서 빼면 쌓여 있던 것이 아래로 주저앉는
 *  그림이 되는데, 실제로 물건을 집어 가는 순서와도 맞지 않는다.
 *
 *  @param want 가져갈 종류들(Set). 비어 있거나 없으면 **가리지 않는다**.
 *              한 종류만 고르던 시절에는 문자열 하나였는데, 카트가 여러 종류를
 *              고를 수 있게 되면서 집합이 됐다 — "이것 아니면 저것" 을 한 번에
 *              말할 수 있어야 한 바퀴에 필요한 것을 다 실어 온다.
 */
export function takeLots(uid, amount, want = null) {
  const cur = getLots(uid);
  const n0 = Math.max(0, Math.round(amount));
  if (!n0 || !cur.length) return [];

  if (!want || !want.size) {
    const n = Math.min(cur.length, n0);
    const taken = cur.slice(cur.length - n);
    commit(uid, cur.slice(0, cur.length - n));
    return taken;
  }

  /**
   * 골라서 집어 가기.
   * -------------------------------------------------------------------------
   *  섞여 쌓인 더미에서 **고른 종류들만** 가져간다. **위에서부터** 훑어 원하는
   *  것만 빼고 나머지는 순서 그대로 둔다 — 위에서부터인 이유는 종류를 안 가릴
   *  때와 같다(집는 순서가 그렇다). 사이에서 빠진 자리는 위의 것이 내려앉는다.
   *
   *  더미 전체를 뒤져야 하지만 한 선반의 자리 수는 수십 개라 값이 싸다.
   */
  const taken = [];
  const left = [];
  for (let i = cur.length - 1; i >= 0; i--) {
    if (taken.length < n0 && want.has(cur[i])) taken.push(cur[i]);
    else left.push(cur[i]);
  }
  if (!taken.length) return [];
  commit(uid, left.reverse());          // 위에서부터 훑었으니 되돌린다
  return taken;
}

/** 개수만 필요한 곳을 위해 남겨 둔다 */
export const takeStock = (uid, amount) => takeLots(uid, amount).length;

/**
 * 여러 종류를 **한꺼번에, 전부 아니면 아무것도** 가져간다 (조립 설비의 재료 소비).
 * ---------------------------------------------------------------------------
 *  레시피가 "A 2개 + B 1개" 라면, A 는 있는데 B 가 없을 때 **A 를 먹으면 안 된다.**
 *  먹어 놓고 못 만들면 그 A 는 어디에도 없이 사라진다 — 라인을 오래 돌릴수록
 *  재료가 조용히 새고, 처리량이 왜 안 나오는지 도면 어디에도 단서가 남지 않는다.
 *  그래서 먼저 세어 보고, 다 있을 때만 손을 댄다.
 *
 *  빼는 순서는 `takeLots` 와 같다 — **위에서부터**. 집는 순서가 그렇다.
 *
 *  @param need { 종류: 개수 }
 *  @returns 가져갔으면 true, 하나라도 모자라면 false (재고는 그대로)
 */
export function takeEach(uid, need) {
  const rows = Object.entries(need ?? {}).filter(([, n]) => n > 0);
  if (!rows.length) return true;                 // 먹을 것이 없다 (원자재 공급원)

  const cur = getLots(uid);
  const have = {};
  for (const k of cur) have[k] = (have[k] ?? 0) + 1;
  for (const [kind, n] of rows) if ((have[kind] ?? 0) < n) return false;

  const rest = Object.fromEntries(rows);
  const left = [];
  for (let i = cur.length - 1; i >= 0; i--) {
    const k = cur[i];
    if (rest[k] > 0) { rest[k]--; continue; }
    left.push(k);
  }
  commit(uid, left.reverse());                   // 위에서부터 훑었으니 되돌린다
  return true;
}

/**
 * 수용량을 넘은 재고를 잘라 낸다.
 *  길이나 단 수를 줄이면 수용량이 줄어드는데, 이미 쌓여 있던 값이 그대로면
 *  "54 / 27" 처럼 말이 안 되는 표시가 남는다. 위에서부터 덜어 낸다.
 */
export function clampStock(uid, capacity) {
  const cur = getLots(uid);
  const cap = Math.max(0, Math.floor(capacity));
  if (cur.length <= cap) return;
  commit(uid, cur.slice(0, cap));
}

/** 인스펙터의 "가득 채우기" — 이미 있는 것과 같은 종류로 채운다 */
export function setStock(uid, value, kind = null) {
  const v = Math.max(0, Math.round(value));
  const cur = getLots(uid);
  if (cur.length === v) return;
  if (v < cur.length) return commit(uid, cur.slice(0, v));
  const fill = kind ?? getKind(uid) ?? DEFAULT_KIND;
  commit(uid, [...cur, ...Array.from({ length: v - cur.length }, () => fill)]);
}

export function clearStock(uid) {
  /* 완성 자리도 함께 비운다 — 「비우기」 를 눌렀는데 나갈 차례를 기다리던 것이
     남아 있으면, 화면의 재고는 0 인데 벨트로 물건이 계속 나간다 */
  clearMade(uid);
  if (uid == null) {
    if (!Object.keys(stock).length) return;
    stock = {};
    lots = {};
  } else {
    if (!(uid in stock)) return;
    stock = { ...stock };
    delete stock[uid];
    lots = { ...lots };
    delete lots[uid];
  }
  emit();
}

/* --------------------------------------------------------------------------
 * 완성돼 나갈 차례를 기다리는 것 (설비의 출력 자리)
 * --------------------------------------------------------------------------
 *  오래 "설비는 출력 버퍼를 두지 않는다" 로 버텼다 — 가지러 온 만큼 그 자리에서
 *  만들었다. 공정 시간이 생기면서 그게 불가능해졌다. **한 개를 만드는 데 12초가
 *  걸린다면, 다 만들어 놓고 가져갈 사람을 기다리는 순간이 반드시 있다.**
 *
 *  그래도 이건 "버퍼" 가 아니다. 사용자가 늘릴 수 있는 값이 아니라 **두 덩어리치**
 *  로 고정이다(process.js 의 OUT_BUNDLES). 한 덩어리치만 두면 다 만든 순간부터
 *  벨트 칸이 도착할 때까지 매번 서서, 멀쩡한 라인이 1초에 한 번씩 붉게 깜빡였다
 *  — 실측으로 1분에 4번, 120개 나올 것이 116개만 나왔다.
 *
 *  자리가 차면 설비가 선다 — 그게 "만들어 놨는데 아무도 안 가져간다" 는 막힘이다.
 *  다만 **상류로는 안 번진다.** 못 내보낼 뿐 재료는 계속 받을 수 있다(무인과 같다).
 */
let made = {};             // { [설비 uid]: [종류, …] } — 앞이 먼저 나간다

/**
 * =============================================================================
 *  출력 자리 — **무엇을 만들어 놓았는가**
 * =============================================================================
 *  예전에는 개수 하나였다(`made[uid] = 12`). 설비 하나가 한 가지만 만들었으니
 *  종류를 적어 둘 이유가 없었다.
 *
 *  **품종 전환이 생기면서 달라졌다.** 같은 설비가 제작품 1을 스무 개 만들고
 *  제작품 2로 바꾸면, 출력 자리에는 두 종류가 앞뒤로 서 있다. 개수만 세면
 *  벨트가 「무엇을 실어야 하는지」를 모른다.
 *
 *  그래서 **적치대·선반과 같은 꼴**로 바꿨다 — 종류를 늘어놓은 줄(`lots`).
 *  앞에서부터 나간다(FIFO): 먼저 만든 것이 먼저 실린다.
 */
export const getMade = (uid) => (made[uid] ?? EMPTY).length;
export const getMadeLots = (uid) => made[uid] ?? EMPTY;
export const getAllMade = () => made;

/**
 * 출력 자리 맨 앞에서 **같은 종류가 몇 개나 이어져 있는가.**
 *  벨트 한 덩어리는 같은 종류라야 한다 — 한 덩어리에 두 종류를 섞으면 화면에
 *  섞여 쌓인 것이 그려지고, 도착해서 나누는 규칙도 두 벌이 된다.
 *  품종이 바뀌는 자리에서는 이 값이 잠깐 작아지고, 벨트는 그만큼 기다린다.
 */
export function madeRun(uid) {
  const list = made[uid] ?? EMPTY;
  if (!list.length) return { kind: null, n: 0 };
  const kind = list[0];
  let n = 1;
  while (n < list.length && list[n] === kind) n++;
  return { kind, n };
}

/** 완성 — 넣은 만큼 쌓인다 (자리 확인은 부르는 쪽이 한다) */
export function addMade(uid, n, kind = DEFAULT_KIND) {
  const add = Math.max(0, Math.round(n));
  if (!add) return 0;
  const k = canonKind(kind) ?? DEFAULT_KIND;
  made = { ...made, [uid]: [...(made[uid] ?? EMPTY), ...Array.from({ length: add }, () => k)] };
  emit();
  return add;
}

/**
 * 앞에서부터 꺼낸다.
 *  @returns 실제로 꺼낸 개수 (종류가 궁금하면 꺼내기 **전에** `madeRun` 을 볼 것)
 */
export function takeMade(uid, n) {
  const list = made[uid] ?? EMPTY;
  const take = Math.min(list.length, Math.max(0, Math.round(n)));
  if (!take) return 0;
  const next = { ...made };
  if (list.length - take > 0) next[uid] = list.slice(take);
  else delete next[uid];
  made = next;
  emit();
  return take;
}

export function clearMade(uid = null) {
  if (uid == null) {
    if (!Object.keys(made).length) return;
    made = {};
  } else {
    if (!(uid in made)) return;
    made = { ...made };
    delete made[uid];
  }
  emit();
}

export const useMade = (uid) =>
  useSyncExternalStore(subscribe, () => made[uid] ?? 0, () => 0);

/** 선반 하나의 재고를 구독 */
export function useStock(uid) {
  return useSyncExternalStore(
    subscribe,
    () => stock[uid] ?? 0,
    () => 0,
  );
}

/** 전체 재고 (요약 표시용) */
export const useAllStock = () =>
  useSyncExternalStore(subscribe, () => stock, () => stock);

/* --------------------------------------------------------------------------
 * 출하 누계
 * --------------------------------------------------------------------------
 *  트럭이 개구부로 빠져나가면 싣고 있던 자재는 공장을 떠난 것이다. 어디에도
 *  쌓이지 않으므로 재고와 달리 "나간 총량" 만 센다. 이 값이 있어야 도면이
 *  실제로 물건을 내보내고 있는지 눈으로 확인할 수 있다.
 */
/**
 *  ── 왜 종류별로 세는가 ────────────────────────────────────────────────────
 *  총량 하나만 세면 "오늘 300개 나갔다" 는 알아도 그중 무엇이 몇 개인지는 알 수
 *  없다. 설비마다 다른 물건을 만들고 카트가 골라 나르는 지금은, 라인이 제대로
 *  도는지가 **종류별 비율**로 드러난다 — 한쪽만 쌓이면 어딘가 막힌 것이다.
 *
 *  { [종류]: 개수 } 로 두고 총량은 필요할 때 더한다.
 */
let shipped = {};
const EMPTY_SHIPPED = {};

/** @param kinds 나간 물건들의 종류 목록 (카트가 싣고 있던 그대로) */
export function addShipped(kinds) {
  const list = Array.isArray(kinds) ? kinds : [];
  if (!list.length) return;
  const next = { ...shipped };
  for (const k of list) next[k ?? DEFAULT_KIND] = (next[k ?? DEFAULT_KIND] ?? 0) + 1;
  shipped = next;
  emit();
}

export const resetShipped = () => { shipped = EMPTY_SHIPPED; emit(); };

/** 훅 없이 지금 값만 — 보고서처럼 한 번 읽고 마는 자리에서 쓴다 */
export const getShipped = () => shipped;

/** 종류별 출하 누계 { [종류]: 개수 } */
export const useShipped = () =>
  useSyncExternalStore(subscribe, () => shipped, () => EMPTY_SHIPPED);

export const shippedTotal = (map) => Object.values(map ?? {}).reduce((s, n) => s + n, 0);
