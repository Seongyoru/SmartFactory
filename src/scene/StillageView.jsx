/**
 * =============================================================================
 *  스틸리지(적치대) — 본체 + 쌓인 자재
 * =============================================================================
 *  본체는 모델 그대로 놓고, 쌓인 만큼 자재(OBJ)를 상판 위에 격자로 올린다.
 *  선반과 달리 규격을 늘리지 않으므로 형상 계산이 거의 없다 — 몇 개가 쌓였는지가
 *  전부다. 그 개수는 벨트가 넣고 카트가 빼 간다(simStore).
 * ---------------------------------------------------------------------------
 */

import React, { useEffect, useMemo } from 'react';
import { cloneScene, useModelMissing, useModelSpec } from '../core/modelStore.js';

import { clampStock, useLots, useStock } from '../core/simStore.js';
import { usePayloadSpecs } from '../core/payload.js';
import { rotToRad } from '../core/grid.js';
import { stillageCapacity, stillageSlot } from '../core/stillage.js';

const BODY_COLOR = '#0e7490';

export default function StillageView({ placed, item, selected = false, ghost = false, valid = true, onPointerDown }) {
  const spec = useModelSpec(item);
  const missing = useModelMissing(item);
  /* 자리마다 무엇이 놓였는지는 재고가 기억한다 — 두 라인이 같은 적치대로
     들어오면 섞인 채로 쌓인다 */
  const lots = useLots(placed.uid);
  const specOf = usePayloadSpecs();
  const stock = useStock(placed.uid);
  const capacity = stillageCapacity(placed);

  const size = spec?.bbox?.size ?? [1.5, 0.76, 1.5];
  const itemH = specOf(lots[0])?.bbox?.size?.[1] ?? 0.3;

  /* 수용량을 줄이면 이미 쌓여 있던 것이 넘친다 — 선반과 같은 이유로 잘라 낸다 */
  useEffect(() => {
    if (!ghost) clampStock(placed.uid, capacity);
  }, [ghost, placed.uid, capacity]);

  const body = useMemo(() => {
    if (!spec) return null;
    const o = cloneScene(spec, { cloneMaterials: ghost });
    if (ghost) {
      o.traverse((n) => {
        if (!n.isMesh || !n.material) return;
        n.material.transparent = true;
        n.material.opacity = 0.55;
        n.material.depthWrite = false;
      });
    }
    return o;
  }, [spec, ghost]);

  const stack = useMemo(() => {
    if (ghost || stock <= 0) return [];
    const out = [];
    for (let i = 0; i < Math.min(stock, capacity); i++) {
      const s = specOf(lots[i]);
      if (!s) continue;
      out.push({ obj: cloneScene(s), pos: stillageSlot(i, size, itemH) });
    }
    return out;
  }, [ghost, lots, specOf, stock, capacity, size, itemH]);

  return (
    <group
      position={[placed.pos[0], placed.y ?? 0, placed.pos[1]]}
      rotation={[0, rotToRad(placed.rot), 0]}
      onPointerDown={ghost ? undefined : onPointerDown}
    >
      {body && !missing ? (
        <primitive object={body} />
      ) : (
        /* 모델을 못 구해도 자리와 적재 상태는 보여야 한다 */
        <mesh position={[0, 0.38, 0]}>
          <boxGeometry args={[1.5, 0.76, 1.5]} />
          <meshStandardMaterial
            color={ghost ? (valid ? '#22d3ee' : '#f43f5e') : BODY_COLOR}
            transparent={ghost}
            opacity={ghost ? 0.55 : 1}
          />
        </mesh>
      )}

      {stack.map(({ obj, pos }, i) => (
        <primitive key={i} object={obj} position={pos} />
      ))}

      {/* 가득 찼음을 바닥에 표시 — 라인이 선 이유가 도면에서 바로 읽혀야 한다 */}
      {!ghost && stock >= capacity && (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
          <ringGeometry args={[Math.max(size[0], size[2]) * 0.62, Math.max(size[0], size[2]) * 0.78, 28]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={0.9} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}
