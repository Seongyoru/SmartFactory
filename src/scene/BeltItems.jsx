/**
 * =============================================================================
 *  벨트 위를 흐르는 반송물
 * =============================================================================
 *  설비가 유출부로 내보낸 자재가 컨베이어를 타고 다음 설비로 들어간다.
 *
 *  자리 계산과 재료 셈은 `core/belt.js` 가 한다 — 라인의 처리량을 정하는 값이라
 *  그림에서 떼어 놓아야 값으로 확인할 수 있다. 여기서는 그 결과를 **그리기만**
 *  한다: 슬롯은 미리 만들어 두고 위치만 옮기며, 빈칸이거나 벨트 밖으로 나간 것은
 *  숨긴다 — 생성·소멸 비용이 아예 없다.
 *
 *  ── 서는 것과 마르는 것은 다르다 ──────────────────────────────────────────
 *   running  벨트 자체가 도는가.  **보낼 곳이 없을 때만** false 다(종점이 가득 참).
 *            이때는 위에 있던 물건도 그 자리에 멈춘다.
 *   feeding  앞 설비가 지금 내보낼 수 있는가. 고장·무인·굶음이면 false —
 *            **벨트는 계속 돌고** 앞머리만 비어 간다. 이미 올라탄 물건은 끝까지
 *            가서 다음 설비나 적치대로 들어간다.
 *
 *  움직임은 useFrame 안에서 행렬만 만진다. 프레임마다 리렌더를 걸면 같은 씬의
 *  컨베이어 지오메트리까지 덩달아 다시 계산된다.
 * ---------------------------------------------------------------------------
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { cloneScene, useModelSpec } from '../core/modelStore.js';
import { simStep } from '../core/clock.js';
import { beltCount, beltHas, beltHeld, beltOffset, makeBelt } from '../core/belt.js';
import { runBelt } from '../core/sim.js';
import { PAYLOAD_ITEM } from '../data/library.js';

/**
 * @param payload 이 벨트에 흐르는 반송물. 설비마다 만들어 내는 물건이 다르므로
 *                무엇이 흐를지는 **내보내는 설비**가 정한다(library 의 payload).
 */
export default function BeltItems({
  path,
  speed = 0.6,
  gap = 3,
  layers = 1,
  running = true,
  feeding = true,
  onArrive = null,
  /**
   * 한 덩어리가 벨트에 **올라탈** 때. 몇 덩어리가 올라탈지 넘기고, 실제로
   * 만들어진 덩어리 수를 돌려받는다(조립 설비가 재료를 내는 자리).
   * 돌려받지 못한 몫은 **빈칸**으로 지나간다 — 벨트를 세우지 않는다.
   */
  onSpawn = null,
  payload = PAYLOAD_ITEM,
}) {
  const spec = useModelSpec(payload);
  /* 콜백은 매 렌더 새로 오므로 ref 로 잡아 둔다 — useFrame 을 다시 걸지 않기 위해 */
  const arriveRef = useRef(onArrive);
  arriveRef.current = onArrive;
  const spawnRef = useRef(onSpawn);
  spawnRef.current = onSpawn;
  const feedRef = useRef(feeding);
  feedRef.current = feeding;
  const slotsRef = useRef([]);

  const step = Math.max(0.4, gap);
  const count = useMemo(() => beltCount(path?.length ?? 0, step), [path, step]);

  /* 슬롯: 한 덩어리(= 여러 층)를 담는 그룹. 층수가 바뀔 때만 다시 만든다.
     clone() 은 지오메트리·머티리얼을 공유하므로 수십 개를 놓아도 가볍다. */
  const slots = useMemo(() => {
    if (!spec || count === 0) return [];
    const h = spec.bbox.size[1] || 0.3;
    const n = Math.max(1, layers);
    return Array.from({ length: count }, () => {
      const group = cloneScene(spec);
      group.position.set(0, 0, 0);
      for (let i = 1; i < n; i++) {
        const layer = cloneScene(spec);
        layer.position.y = i * h;
        group.add(layer);
      }
      group.visible = false;
      return group;
    });
  }, [spec, count, layers]);

  /* 칸 수·간격·층수가 바뀌면 줄을 처음부터 다시 세운다 (반쯤 걸친 물건이 남지 않도록) */
  const belt = useMemo(() => makeBelt(count), [count, step, layers]);
  useEffect(() => { slotsRef.current = slots; }, [slots]);

  useFrame((_, dt) => {
    const list = slotsRef.current;
    if (!path || !list.length) return;
    const L = path.length;

    /* 굴리는 일은 core/sim.js 가 한다 — 화면 없이도 같은 함수가 돈다 */
    if (running) {
      const got = runBelt(belt, {
        speed, step, length: L, layers,
        feeding: feedRef.current,
        spawn: spawnRef.current,
        /* 옛 도면(품종 하나)에서는 줄의 이름표를 쓴다 */
        kind: payload?.id ?? null,
      }, simStep(dt));
      /**
       * **종류별로** 넘긴다 — 같은 벨트 위에 두 품종이 앞뒤로 흐른다.
       *  벨트 상태도 같이 준다 — 축적형 벨트는 못 내린 것을 **끝에 쌓아** 두고
       *  다음 프레임에 먼저 내린다(belt.js 의 held). 쌓아 둔 것이 있으면
       *  이번에 도착한 것이 없어도 불러야 한다.
       */
      if (got.n > 0 || beltHeld(belt)) arriveRef.current?.(got.byKind ?? {}, belt);
    }

    const head = beltOffset(belt, step);
    for (let k = 0; k < list.length; k++) {
      const g = list[k];
      const s = head + k * step;
      if (s > L || !beltHas(belt, k)) { g.visible = false; continue; }
      const f = path.at(s);
      g.visible = true;
      g.position.set(f.pos[0], f.pos[1], f.pos[2]);
      g.rotation.y = Math.atan2(f.tan[0], f.tan[1]);   // 모델 +Z 를 진행 방향으로
    }
  });

  if (!slots.length) return null;
  return (
    <group>
      {slots.map((g, i) => (
        <primitive key={i} object={g} />
      ))}
    </group>
  );
}
