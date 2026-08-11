/**
 * =============================================================================
 *  벨트 위를 흐르는 반송물
 * =============================================================================
 *  설비가 유출부로 내보낸 자재가 컨베이어를 타고 다음 설비로 들어간다.
 *
 *  ── 개체를 하나씩 관리하지 않는다 ─────────────────────────────────────────
 *   "언제 만들어서 언제 지운다" 를 목록으로 들고 있으면 상태가 늘어나고,
 *   속도나 간격을 바꿀 때마다 목록을 손봐야 한다. 대신 오프셋 하나만 굴린다.
 *
 *      물건들의 위치 = offset + k×간격   (k = 0, 1, 2 …)
 *      offset 은 0 → 간격 사이를 반복해서 돈다
 *
 *   이러면 간격이 항상 정확하고, 속도를 바꿔도 줄이 흐트러지지 않으며,
 *   경로 길이가 변해도 자연스럽게 개수만 달라진다. 슬롯은 미리 만들어 두고
 *   경로 밖으로 나간 것만 숨긴다 — 생성·소멸 비용이 아예 없다.
 *
 *  움직임은 useFrame 안에서 행렬만 만진다. 프레임마다 리렌더를 걸면 같은 씬의
 *  컨베이어 지오메트리까지 덩달아 다시 계산된다.
 * ---------------------------------------------------------------------------
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { cloneScene, useModelSpec } from '../core/modelStore.js';
import { PAYLOAD_ITEM } from '../data/library.js';

/** 한 벨트에 올릴 수 있는 최대 개수 — 짧은 간격으로 긴 벨트를 채울 때의 안전선 */
const MAX_ITEMS = 60;

/**
 * @param payload 이 벨트에 흐르는 반송물. 설비마다 만들어 내는 물건이 다르므로
 *                무엇이 흐를지는 **내보내는 설비**가 정한다(library 의 payload).
 */
export default function BeltItems({ path, speed = 0.6, gap = 3, layers = 1, running = true, onArrive = null, payload = PAYLOAD_ITEM }) {
  const spec = useModelSpec(payload);
  const offsetRef = useRef(0);
  /* 콜백은 매 렌더 새로 오므로 ref 로 잡아 둔다 — useFrame 을 다시 걸지 않기 위해 */
  const arriveRef = useRef(onArrive);
  arriveRef.current = onArrive;
  const slotsRef = useRef([]);

  const step = Math.max(0.4, gap);
  const count = useMemo(() => {
    if (!path || path.length < 0.01) return 0;
    return Math.max(0, Math.min(MAX_ITEMS, Math.floor(path.length / step) + 1));
  }, [path, step]);

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

  // 간격·층수가 바뀌면 줄을 처음부터 다시 세운다 (반쯤 걸친 물건이 남지 않도록)
  useEffect(() => { offsetRef.current = 0; }, [step, layers]);
  useEffect(() => { slotsRef.current = slots; }, [slots]);

  useFrame((_, dt) => {
    const list = slotsRef.current;
    if (!path || !list.length) return;
    const L = path.length;

    if (running && speed > 0) {
      const prev = offsetRef.current;
      const next = prev + speed * Math.min(dt, 0.1);

      /**
       * 물건이 벨트 끝을 넘어가는 순간을 잡는다.
       * -----------------------------------------------------------------------
       *  물건들은 s = offset + k·간격 에 놓이고, s > L 이 되면 사라진다.
       *  k 번째가 사라지는 것은 offset 이 L − k·간격 을 지날 때인데, offset 은
       *  [0, 간격) 을 돌므로 그 값은 딱 하나 — **L 을 간격으로 나눈 나머지** 다.
       *
       *  예전에는 offset 이 **한 바퀴 돌 때**(0 으로 되돌아갈 때) 도착으로 쳤다.
       *  개수는 맞지만 시점이 다르다. 두 값은 벨트 길이가 간격의 배수일 때만
       *  같아서, 보통은 최대 한 주기만큼 어긋난 채로 쌓였다 — 화면에서 물건이
       *  끝에 닿기 전에 적치대가 늘거나, 닿고 한참 뒤에 느는 것으로 보인다.
       *
       *  나눗셈 몫의 차로 세면 한 프레임에 여러 개가 지나가도(빠른 벨트·긴 dt)
       *  빠뜨리지 않는다.
       */
      const r = L % step;
      const passed = Math.floor((next - r) / step) - Math.floor((prev - r) / step);
      if (passed > 0) arriveRef.current?.(passed * Math.max(1, layers));

      offsetRef.current = next % step;
    }

    for (let k = 0; k < list.length; k++) {
      const g = list[k];
      const s = offsetRef.current + k * step;
      if (s > L) { g.visible = false; continue; }
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
