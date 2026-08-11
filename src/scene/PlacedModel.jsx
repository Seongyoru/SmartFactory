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

/** 멈춘 설비 표시색 — 라인 정지는 언제나 같은 붉은색으로 읽히게 한다 */
const HALT_COLOR = '#ef4444';

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

/**
 * 선택 표시 — 높이를 가진 상자 케이지.
 * ---------------------------------------------------------------------------
 *  바닥 외곽선만 그리면 3D 뷰에서 설비에 가려 거의 보이지 않는다. 특히 선반처럼
 *  높은 물건은 "발밑에 선 하나" 라서 무엇이 선택됐는지 읽히지 않는다.
 *  실제 부피를 감싸는 12개 모서리를 그려 어느 각도에서도 형태가 잡히게 한다.
 *
 *  선 굵기(lineWidth)는 WebGL 에서 무시되므로 얇은 상자 막대로 그린다.
 *  depthTest 를 끄면 항상 위에 떠서 위치 감각이 사라지므로, 대신 살짝 부풀린
 *  케이지를 그려 모델 표면과 z-파이팅이 나지 않게 한다.
 */
const CAGE_BAR = 0.05;      // 모서리 막대 두께(m)
const CAGE_PAD = 0.04;      // 모델 표면에서 띄우는 여유(m)

export function SelectionCage({ rect, height = 0, y0 = 0, color = DEFAULT_COLORS.select }) {
  const x0 = rect.minX - CAGE_PAD;
  const x1 = rect.maxX + CAGE_PAD;
  const z0 = rect.minZ - CAGE_PAD;
  const z1 = rect.maxZ + CAGE_PAD;
  const h = Math.max(height, 0.4) + CAGE_PAD;      // 납작한 물건도 잡히도록 최소 높이
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w = x1 - x0;
  const d = z1 - z0;

  /* [position, size] 12개 — 아래·위 테두리 각 4개 + 기둥 4개 */
  const bars = [];
  for (const yy of [y0, y0 + h]) {
    bars.push([[cx, yy, z0], [w, CAGE_BAR, CAGE_BAR]]);
    bars.push([[cx, yy, z1], [w, CAGE_BAR, CAGE_BAR]]);
    bars.push([[x0, yy, cz], [CAGE_BAR, CAGE_BAR, d]]);
    bars.push([[x1, yy, cz], [CAGE_BAR, CAGE_BAR, d]]);
  }
  for (const xx of [x0, x1]) {
    for (const zz of [z0, z1]) bars.push([[xx, y0 + h / 2, zz], [CAGE_BAR, h, CAGE_BAR]]);
  }

  return (
    <group renderOrder={6}>
      {bars.map(([pos, size], i) => (
        <mesh key={i} position={pos} renderOrder={6}>
          <boxGeometry args={size} />
          <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.95} depthWrite={false} />
        </mesh>
      ))}
      <FootprintFill rect={rect} color={color} opacity={0.16} />
    </group>
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
  /** 종점이 가득 차서 라인이 멈췄는가 */
  halted = false,
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
    const obj = cloneScene(spec, { cloneMaterials: ghost || dimmed || halted });

    /* 라인이 서면 설비도 선다.
       ---------------------------------------------------------------------
       멈춘 이유(종점이 가득 참)는 스틸리지 쪽에 표시되지만, 도면에서 먼저
       눈에 띄는 것은 "저 설비가 안 돈다" 쪽이다. 붉게 물들여 어느 설비까지
       영향을 받았는지 한눈에 따라갈 수 있게 한다. */
    if (halted && !ghost) {
      const red = new THREE.Color(HALT_COLOR);
      obj.traverse((n) => {
        if (!n.isMesh || !n.material) return;
        if ('emissive' in n.material) {
          n.material.emissive = red;
          n.material.emissiveIntensity = 0.55;
        } else {
          n.material.color = red;
        }
      });
    }

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
  }, [spec, ghost, dimmed, halted, valid, okColor, badColor]);

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
        {/* 모델을 아직 못 읽었으면 자리표시. 예전에는 여기서 정의된 적 없는
            이름(GHOST_OK)을 쓰고 있어서, **로드 전에 고스트를 그리는 순간**
            ReferenceError 로 씬 전체가 죽었다. 큰 모델을 고르면 바로 재현된다. */}
        {object ? <primitive object={object} /> : <Placeholder color={ghost ? okColor : '#475569'} />}
      </group>

      {rect && ghost && (
        <>
          <FootprintFill rect={rect} color={valid ? okColor : badColor} opacity={fillOpacity} />
          <FootprintOutline rect={rect} color={valid ? okColor : badColor} />
        </>
      )}
      {/* 선택 표시는 EditorScene 이 SelectionCage 로 한 곳에서 그린다 —
          설비와 선반이 같은 모양으로 보여야 하고, 높이는 씬이 아는 값이다. */}
    </group>
  );
}
