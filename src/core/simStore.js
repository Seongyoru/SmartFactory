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
const subs = new Set();

const emit = () => subs.forEach((f) => f());
const subscribe = (f) => {
  subs.add(f);
  return () => subs.delete(f);
};

export const getStock = (uid) => stock[uid] ?? 0;
export const getAllStock = () => stock;

/** 적재 — 수용량을 넘지 않는 만큼만 받고, 실제로 받은 수를 돌려준다 */
export function addStock(uid, amount, capacity = Infinity) {
  const cur = stock[uid] ?? 0;
  const next = Math.max(0, Math.min(capacity, cur + amount));
  if (next === cur) return 0;
  stock = { ...stock, [uid]: next };
  emit();
  return next - cur;
}

/** 출고 — 있는 만큼만 내주고, 실제로 내준 수를 돌려준다 */
export function takeStock(uid, amount) {
  const cur = stock[uid] ?? 0;
  const moved = Math.max(0, Math.min(cur, amount));
  if (!moved) return 0;
  stock = { ...stock, [uid]: cur - moved };
  emit();
  return moved;
}

/**
 * 수용량을 넘은 재고를 잘라 낸다.
 *  길이나 단 수를 줄이면 수용량이 줄어드는데, 이미 쌓여 있던 값이 그대로면
 *  "54 / 27" 처럼 말이 안 되는 표시가 남는다.
 */
export function clampStock(uid, capacity) {
  const cur = stock[uid] ?? 0;
  if (cur <= capacity) return;
  stock = { ...stock, [uid]: Math.max(0, Math.floor(capacity)) };
  emit();
}

export function setStock(uid, value) {
  const v = Math.max(0, Math.round(value));
  if ((stock[uid] ?? 0) === v) return;
  stock = { ...stock, [uid]: v };
  emit();
}

export function clearStock(uid) {
  if (uid == null) {
    if (!Object.keys(stock).length) return;
    stock = {};
  } else {
    if (!(uid in stock)) return;
    stock = { ...stock };
    delete stock[uid];
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
