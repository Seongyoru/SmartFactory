/**
 * =============================================================================
 *  배치된 설비 렌더 · 고스트(배치 미리보기)
 * =============================================================================
 *  모델은 캐시된 원본을 clone 해서 쓴다. 고스트는 머티리얼까지 복제해서
 *  반투명 + 색 틴트를 입힌다(원본이 오염되면 배치된 설비까지 투명해진다).
 * ---------------------------------------------------------------------------
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { cloneScene, useModelSpec } from '../core/modelStore.js';
import { footprintOf, rotToRad } from '../core/grid.js';

/* 테마가 없을 때(고스트 미리보기 밖 등) 쓰는 기본값 */
const DEFAULT_COLORS = { select: '#38bdf8', ghostOk: '#22d3ee', ghostBad: '#f43f5e', fillOpacity: 0.22 };

/* 바닥에 그리는 풋프린트 외곽선 — 탑뷰에서 "몇 칸을 먹는지" 보여 준다 */
export function FootprintOutline({ rect, color = DEFAULT_COLORS.select, y = 0.02, dashed = false }) {
  const geom = useMemo(() => {
    const pts = [
      new THREE.Vector3(rect.minX, y, rect.minZ),
      new THREE.Vector3(rect.maxX, y, rect.minZ),
      new THREE.Vector3(rect.maxX, y, rect.maxZ),
      new THREE.Vector3(rect.minX, y, rect.maxZ),
      new THREE.Vector3(rect.minX, y, rect.minZ),
    ];
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [rect.minX, rect.maxX, rect.minZ, rect.maxZ, y]);

  return (
    <line geometry={geom} renderOrder={5}>
      {dashed ? (
        <lineDashedMaterial color={color} dashSize={0.3} gapSize={0.2} depthTest={false} />
      ) : (
        <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
      )}
    </line>
  );
}

/** 바닥 채움 — 유효/충돌을 색으로 즉시 알려 준다 */
function FootprintFill({ rect, color, opacity = 0.18 }) {
  const w = rect.maxX - rect.minX;
  const d = rect.maxZ - rect.minZ;
  return (
    <mesh
      position={[(rect.minX + rect.maxX) / 2, 0.012, (rect.minZ + rect.maxZ) / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={4}
    >
      <planeGeometry args={[Math.max(w, 0.01), Math.max(d, 0.01)]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

/** 모델이 아직 로드되지 않았을 때의 자리표시 */
function Placeholder({ color = '#475569' }) {
  return (
    <mesh position={[0, 1, 0]}>
      <boxGeometry args={[2, 2, 2]} />
      <meshBasicMaterial color={color} wireframe />
    </mesh>
  );
}

export default function PlacedModel({
  placed,
  item,
  selected = false,
  ghost = false,
  valid = true,
  dimmed = false,
  colors = DEFAULT_COLORS,
  onPointerDown,
  onClick,
  onPointerOver,
  onPointerOut,
}) {
  const spec = useModelSpec(item);
  const okColor = colors.ghostOk ?? DEFAULT_COLORS.ghostOk;
  const badColor = colors.ghostBad ?? DEFAULT_COLORS.ghostBad;
  const selColor = colors.select ?? DEFAULT_COLORS.select;
  const fillOpacity = colors.fillOpacity ?? DEFAULT_COLORS.fillOpacity;

  const object = useMemo(() => {
    if (!spec) return null;
    const obj = cloneScene(spec, { cloneMaterials: ghost || dimmed });
    if (ghost || dimmed) {
      const tint = new THREE.Color(ghost ? (valid ? okColor : badColor) : '#ffffff');
      obj.traverse((n) => {
        if (!n.isMesh || !n.material) return;
        n.material.transparent = true;
        n.material.opacity = ghost ? 0.55 : 0.25;
        n.material.depthWrite = false;
        if (ghost) {
          n.material.color = tint;
          if ('emissive' in n.material) n.material.emissive = tint.clone().multiplyScalar(0.35);
        }
        n.castShadow = false;
        n.receiveShadow = false;
      });
    }
    return obj;
  }, [spec, ghost, dimmed, valid, okColor, badColor]);

  const rect = useMemo(
    () => (spec ? footprintOf(placed, spec) : null),
    [spec, placed.pos[0], placed.pos[1], placed.rot],
  );

  const handlers = ghost
    ? {}
    : {
        onPointerDown,
        onClick,
        onPointerOver,
        onPointerOut,
      };

  return (
    <group>
      <group
        position={[placed.pos[0], placed.y ?? 0, placed.pos[1]]}
        rotation={[0, rotToRad(placed.rot), 0]}
        {...handlers}
      >
        {object ? <primitive object={object} /> : <Placeholder color={ghost ? GHOST_OK : '#475569'} />}
      </group>

      {rect && ghost && (
        <>
          <FootprintFill rect={rect} color={valid ? okColor : badColor} opacity={fillOpacity} />
          <FootprintOutline rect={rect} color={valid ? okColor : badColor} />
        </>
      )}
      {rect && selected && !ghost && (
        <>
          <FootprintFill rect={rect} color={selColor} opacity={fillOpacity * 0.55} />
          <FootprintOutline rect={rect} color={selColor} />
        </>
      )}
    </group>
  );
}
