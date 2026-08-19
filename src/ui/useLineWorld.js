/**
 * 반복 실행에 넣을 도면을 **한 곳에서** 모으는 훅.
 * ---------------------------------------------------------------------------
 *  `useCost.js` 와 같은 자리다 — 계산은 core 가 하고, 여기서는 **어느 저장소의
 *  어느 값을 넣을지**만 정한다. 그 결정이 화면 층의 일이라 core 가 아니라 여기
 *  있다(모델 규격은 `modelStore` 에 있고, 그건 브라우저만 아는 값이다).
 *
 *  모으는 자리가 둘이 되면 **화면이 돌리는 라인과 반복 실행이 돌리는 라인이
 *  달라진다.** 그러면 「여러 번 돌려 봤더니 다르더라」가 배치 때문인지 모으는
 *  방식 때문인지 알 수 없어진다 — 그 순간 이 기능은 못 쓰는 것이 된다.
 */

import React, { useMemo } from 'react';
import { useEditor } from '../core/store.jsx';
import { getSpec, subscribeModels } from '../core/modelStore.js';
import { linkPath } from '../core/link.js';
import { beltFlowsOf, machinesOf } from '../core/lineup.js';
import { lineWorld } from '../core/replicate.js';
import { FAULT_DEFAULTS, getDown } from '../core/faults.js';
import { assignCrew, crewRows, isWorkable, normalizeShifts, shiftAt } from '../core/crew.js';
import { shippedTotal, getShipped } from '../core/simStore.js';

/* 모델이 늦게 로드돼도 벨트 경로가 갱신되도록 (Inspector 와 같은 꼴) */
function useModelsVersion() {
  const [v, setV] = React.useState(0);
  React.useEffect(() => subscribeModels(() => setV((n) => n + 1)), []);
  return v;
}

/**
 * 지금 도면으로 **화면 없이 굴릴 수 있는 world** 를 만든다.
 *
 *  @returns { world, machines, ready }
 *    world    `replicate` 에 그대로 넘기는 함수 (틱마다 halt 를 다시 답한다)
 *    ready    돌릴 것이 있는가 — 설비가 없으면 반복 실행에 뜻이 없다
 */
export function useLineWorld() {
  const { state, itemOf } = useEditor();
  const version = useModelsVersion();

  return useMemo(() => {
    const placed = state.placed;
    const specOf = (it) => (it?.modelKey ? getSpec(it.modelKey) : null);

    /* 벨트가 실제로 깔린 경로 — 모델 규격을 봐야 나오므로 여기서 푼다 */
    const linkPaths = state.links
      .map((link) => ({ link, path: linkPath(link, placed, itemOf) }))
      .filter((x) => x.path);

    const machines = machinesOf({ placed, itemOf });
    const beltFlows = beltFlowsOf({ linkPaths, placed, itemOf, beltSpeed: state.beltSpeed });

    /**
     * 인력 — **첫 조**로 고정한다.
     *  교대가 도는 것까지 반복 실행에 넣으면 판마다 어느 조에서 시작했는지가
     *  결과를 흔든다. 견주려는 것은 배치지 「몇 시에 시작했나」가 아니다.
     */
    const shifts = normalizeShifts(state.shifts);
    const head = shiftAt(shifts, 0).shift?.headcount ?? 0;
    const crew = assignCrew(crewRows(placed, (p) => isWorkable(itemOf(p.itemId))), head);

    /* 고장 판정에 넣을 설비들 — 화면의 SimClock 이 넘기는 것과 같은 꼴 */
    const equips = machines.map((m) => ({
      uid: m.uid,
      mtbf: m.at?.mtbf ?? FAULT_DEFAULTS.mtbf,
      mttr: m.at?.mttr ?? FAULT_DEFAULTS.mttr,
    }));

    return {
      ready: machines.length > 0,
      machines,
      world: lineWorld({
        beltFlows, machines, placed, itemOf, crew, equips,
        downMap: getDown,
        shipped: () => shippedTotal(getShipped()),
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.placed, state.links, state.beltSpeed, state.shifts, itemOf, version]);
}
