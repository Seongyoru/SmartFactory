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
export function addStock(uid, amount, capacity = Infinity, kind = 'OBJ') {
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
  commit(uid, [...cur, ...take]);
  return take.length;
}

/**
 * 출고 — 있는 만큼만 내주고, **무엇을 내줬는지** 종류 목록으로 돌려준다.
 *  위(마지막)에서부터 꺼낸다. 아래에서 빼면 쌓여 있던 것이 아래로 주저앉는
 *  그림이 되는데, 실제로 물건을 집어 가는 순서와도 맞지 않는다.
 */
export function takeLots(uid, amount, kind = null) {
  const cur = getLots(uid);
  const want = Math.max(0, Math.round(amount));
  if (!want || !cur.length) return [];

  if (!kind) {
    const n = Math.min(cur.length, want);
    const taken = cur.slice(cur.length - n);
    commit(uid, cur.slice(0, cur.length - n));
    return taken;
  }

  /**
   * 골라서 집어 가기.
   * -------------------------------------------------------------------------
   *  섞여 쌓인 더미에서 한 종류만 가져간다. **위에서부터** 훑어 원하는 것만
   *  빼고 나머지는 순서 그대로 둔다 — 위에서부터인 이유는 종류를 안 가릴 때와
   *  같다(집는 순서가 그렇다). 사이에서 빠진 자리는 위의 것이 내려앉는다.
   *
   *  더미 전체를 뒤져야 하지만 한 선반의 자리 수는 수십 개라 값이 싸다.
   */
  const taken = [];
  const left = [];
  for (let i = cur.length - 1; i >= 0; i--) {
    if (taken.length < want && cur[i] === kind) taken.push(cur[i]);
    else left.push(cur[i]);
  }
  if (!taken.length) return [];
  commit(uid, left.reverse());          // 위에서부터 훑었으니 되돌린다
  return taken;
}

/** 개수만 필요한 곳을 위해 남겨 둔다 */
export const takeStock = (uid, amount) => takeLots(uid, amount).length;

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
  const fill = kind ?? getKind(uid) ?? 'OBJ';
  commit(uid, [...cur, ...Array.from({ length: v - cur.length }, () => fill)]);
}

export function clearStock(uid) {
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
let shipped = 0;

export function addShipped(n) {
  if (!(n > 0)) return;
  shipped += n;
  emit();
}

export const resetShipped = () => { shipped = 0; emit(); };

export const useShipped = () => useSyncExternalStore(subscribe, () => shipped, () => 0);
