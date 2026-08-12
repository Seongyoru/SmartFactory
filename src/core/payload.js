/**
 * =============================================================================
 *  반송물 모델 모음
 * =============================================================================
 *  선반·적치대·카트는 자리마다 **다른 종류**를 쌓을 수 있다(simStore 의 lots).
 *  그런데 useModelSpec 은 훅이라 항목마다 부를 수 없다 — 개수가 매 프레임 바뀌는
 *  값이라 훅 개수가 흔들린다. 그래서 종류가 몇 개든 **한 번에** 받아 두고,
 *  그리는 쪽은 이름으로 꺼내 쓴다.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from 'react';
import { PAYLOAD_ITEMS } from '../data/library.js';
import { getSpec, loadModel, subscribeModels } from './modelStore.js';

/**
 * @returns (kind) => spec — 모르는 이름이나 아직 못 읽은 모델이면 기본 반송물,
 *          그것도 없으면 null (호출부가 아무것도 그리지 않는다)
 */
export function usePayloadSpecs() {
  const [, force] = useState(0);
  useEffect(() => subscribeModels(() => force((n) => n + 1)), []);

  useEffect(() => {
    for (const it of Object.values(PAYLOAD_ITEMS)) {
      if (!getSpec(it.modelKey)) {
        loadModel(it.modelKey, { url: it.url, merge: it.merge, tint: it.tint }).catch(() => {});
      }
    }
  }, []);

  return useMemo(() => {
    const map = {};
    for (const [key, it] of Object.entries(PAYLOAD_ITEMS)) map[key] = getSpec(it.modelKey);
    const fallback = map.OBJ ?? Object.values(map).find(Boolean) ?? null;
    return (kind) => map[kind] ?? fallback;
    // 모델 캐시가 갱신될 때마다 다시 만든다 (force 로 리렌더가 걸린다)
  });
}
