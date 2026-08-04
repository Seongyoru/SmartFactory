/**
 * 커서(바닥 좌표) 공유 저장소.
 *  씬 밖의 상태바에서 좌표를 보여 주려고 만든 아주 작은 외부 스토어다.
 *  에디터 상태(useReducer)에 넣으면 마우스가 움직일 때마다 화면 전체가
 *  리렌더되므로 일부러 분리했다.
 */

import { useSyncExternalStore } from 'react';

let cursor = [0, 0];
const subs = new Set();

export function publishCursor(p) {
  cursor = p;
  subs.forEach((f) => f());
}

const subscribe = (f) => {
  subs.add(f);
  return () => subs.delete(f);
};

export const useCursor = () => useSyncExternalStore(subscribe, () => cursor, () => cursor);
