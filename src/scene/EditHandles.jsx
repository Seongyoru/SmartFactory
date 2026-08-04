/**
 * =============================================================================
 *  경로 편집 손잡이
 * =============================================================================
 *  선택한 연결장치/카트의 경로를 손으로 고치기 위한 점들이다.
 *
 *    ● 진한 점   기존 경유점 — 끌어서 옮기고, Alt+클릭으로 지운다
 *    ○ 흐린 점   구간 중점 — 여기를 끌면 그 자리에 경유점이 새로 생긴다
 *
 *  드래그 자체는 여기서 처리하지 않는다. 바닥 좌표를 구하는 배관이 씬 쪽에
 *  이미 있으므로(설비 이동과 같은 경로), 여기서는 "무엇을 눌렀는지" 만
 *  알려 주고 실제 이동은 씬이 맡는다.
 * ---------------------------------------------------------------------------
 */

import React from 'react';

function Handle({ position, color, radius = 0.3, opacity = 1, onPointerDown }) {
  return (
    <group position={position}>
      <mesh renderOrder={12} onPointerDown={onPointerDown}>
        <sphereGeometry args={[radius, 14, 10]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
      </mesh>
      {/* 집기 쉬우라고 보이지 않는 여유 반경을 덧댄다 */}
      <mesh onPointerDown={onPointerDown}>
        <sphereGeometry args={[radius * 2.2, 8, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  );
}

export default function EditHandles({
  points = [],
  inserts = [],
  color = '#38bdf8',
  onGrabPoint,
  onGrabInsert,
}) {
  return (
    <group>
      {inserts.map((ins, i) => (
        <Handle
          key={`i${i}`}
          position={ins.world}
          color={color}
          radius={0.2}
          opacity={0.45}
          onPointerDown={(e) => { e.stopPropagation(); onGrabInsert?.(ins.index, e); }}
        />
      ))}
      {points.map((p, i) => (
        <Handle
          key={`p${i}`}
          position={p.world}
          color={color}
          radius={0.3}
          onPointerDown={(e) => { e.stopPropagation(); onGrabPoint?.(i, e); }}
        />
      ))}
    </group>
  );
}
