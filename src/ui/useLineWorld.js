/**
 * 반복 실행에 넣을 도면을 **한 곳에서** 모으는 훅.
 * ---------------------------------------------------------------------------
 *  `useCost.js` 와 같은 자리다 — 계산은 core 가 하고(`core/lineup.js` 의 `worldOf`),
 *  여기서는 **어느 저장소의 어느 값을 넣을지**만 정한다. 그 결정이 화면 층의
 *  일이라 core 가 아니라 여기 있다(모델 규격은 `modelStore` 에 있고, 그건
 *  브라우저만 아는 값이다).
 *
 *  ── 왜 계산이 core 로 내려갔나 ────────────────────────────────────────────
 *  훅이라 **지금 상태**로만 만들 수 있었다. 「손보기 전과 후를 나란히 돌려
 *  보자」가 되면서 **지금이 아닌 배치**로도 만들 수 있어야 했고, 그래서 순수한
 *  부분을 `worldOf` 로 옮겼다. 이 훅은 이제 그것을 부르기만 한다.
 *
 *  모으는 자리가 둘이 되면 **화면이 돌리는 라인과 반복 실행이 돌리는 라인이
 *  달라진다.** 그러면 「여러 번 돌려 봤더니 다르더라」가 배치 때문인지 모으는
 *  방식 때문인지 알 수 없어진다 — 그 순간 이 기능은 못 쓰는 것이 된다.
 */

import React, { useMemo } from 'react';
import { useEditor } from '../core/store.jsx';
import { getSpec, subscribeModels } from '../core/modelStore.js';
import { worldOf } from '../core/lineup.js';

/* 모델이 늦게 로드돼도 벨트 경로가 갱신되도록 (Inspector 와 같은 꼴) */
function useModelsVersion() {
  const [v, setV] = React.useState(0);
  React.useEffect(() => subscribeModels(() => setV((n) => n + 1)), []);
  return v;
}

/** 모델 규격을 읽는 길 — 화면 층만 아는 값이라 여기서 만들어 넘긴다 */
export const specReader = () => (it) => (it?.modelKey ? getSpec(it.modelKey) : null);

/**
 * 지금 도면으로 **화면 없이 굴릴 수 있는 world**.
 *
 *  @returns { world, flow, machines, capacity, ready } — `worldOf` 그대로
 *    world    `replicate` 에 그대로 넘기는 함수 (틱마다 halt 를 다시 답한다)
 *    flow     벨트와 카트를 굴리는 그릇 — 이것이 있어야 물건이 밖으로 나간다
 *    capacity **돌리기 전에** 계산으로 나오는 천장 (개/분)
 *    ready    돌릴 것이 있는가 — 설비가 없으면 반복 실행에 뜻이 없다
 */
export function useLineWorld() {
  const { state, itemOf } = useEditor();
  const version = useModelsVersion();

  return useMemo(
    () => worldOf({
      placed: state.placed,
      links: state.links,
      carts: state.carts,
      areas: state.areas,
      walls: state.walls,
      openings: state.openings,
      shifts: state.shifts,
      /* **오더가 라인을 이끈다.** 디스패칭 규칙(납기 먼저·밀린 것 먼저)이 이걸
         읽는다. 안 넘기면 규칙이 조용히 「차례대로」가 되어, 화면에서 보던
         라인과 여기서 돌린 라인이 서로 다른 것이 된다. */
      orders: state.orders,
      beltSpeed: state.beltSpeed,
      itemOf,
      specOf: specReader(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.placed, state.links, state.carts, state.areas, state.walls, state.openings,
      state.beltSpeed, state.shifts, state.orders, itemOf, version],
  );
}
