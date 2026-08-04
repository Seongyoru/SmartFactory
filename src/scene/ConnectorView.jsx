/**
 * =============================================================================
 *  연결장치 렌더 (컨베이어 · 레일 · 전선 · 배관)
 * =============================================================================
 *  경로는 부모가 계산해서 넘긴다(미리보기와 실제 배치가 같은 코드를 타도록).
 *  여기서는 "그 경로를 어떤 형상으로 채우고, 어떻게 움직일지" 만 담당한다.
 *
 *  ── 벨트 UV 애니메이션 ────────────────────────────────────────────────────
 *   벨트 메시의 UV 는 벨트 루프를 한 바퀴 감아 편 형태다. 그래서 U 좌표가
 *   윗면에서는 진행 방향으로 증가하고 아랫면에서는 감소한다.
 *   → U 를 한 방향으로 흘리기만 하면 윗면과 아랫면이 자동으로 서로 반대로
 *     움직인다. 실제 벨트가 도는 모습 그대로이고, 채널을 두 개 쓸 필요가 없다.
 *
 *   흘리는 양은 모델에서 잰 uvGradient(흐름축 1m 당 U 변화량)로 환산하므로
 *   "0.6 m/s" 같은 물리 속도를 그대로 지정할 수 있다. 모델이 바뀌어도
 *   속도의 의미가 유지된다.
 *
 *   머티리얼과 텍스처는 연결마다 복제한다. 원본을 그대로 쓰면 같은 라이브러리
 *   항목을 쓰는 모든 벨트가 한 덩어리로 같이 움직인다. (텍스처 복제는
 *   three 가 이미지 소스를 공유하므로 GPU 메모리를 추가로 먹지 않는다)
 * ---------------------------------------------------------------------------
 */

import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useModelSpec } from '../core/modelStore.js';
import { buildHitGeometry, buildTiledGeometry, buildTubeGeometry } from './connectorGeometry.js';

const SELECT_COLOR = '#38bdf8';

/** 경로 중심선 — 미리보기/선택 시 어디로 지나가는지 한눈에 */
function Centerline({ path, color, lift = 0.06, opacity = 0.9 }) {
  const geom = useMemo(() => {
    const pts = path.points3(lift).map((p) => new THREE.Vector3(...p));
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [path, lift]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <line geometry={geom} renderOrder={6}>
      <lineBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
    </line>
  );
}

export default function ConnectorView({
  link,
  item,
  path,
  selected = false,
  preview = false,
  valid = true,
  running = false,
  defaultSpeed = 0.6,
  onPointerDown,
  onPointerOver,
  onPointerOut,
}) {
  const spec = useModelSpec(item);
  const radius = link?.radius ?? 1;
  const widthScale = link?.widthScale ?? 1;
  const mode = item?.render === 'tube' || !item?.modelKey ? 'tube' : 'tile';

  /* ---- 형상 ------------------------------------------------------------- */
  const built = useMemo(() => {
    if (!path || path.length < 1e-3) return null;
    if (mode === 'tube') {
      return {
        kind: 'tube',
        geometry: buildTubeGeometry(path, { radius: item?.radius ?? 0.05, sag: item?.sag ?? 0 }),
      };
    }
    if (!spec) return null;
    return { kind: 'tile', ...buildTiledGeometry(spec, path, { radius, widthScale }) };
  }, [path, spec, mode, radius, widthScale, item?.radius, item?.sag]);

  useEffect(() => () => {
    if (!built) return;
    if (built.kind === 'tube') built.geometry.dispose();
    else built.parts?.forEach((p) => p.geometry.dispose());
  }, [built]);

  /* ---- 벨트 머티리얼 (연결마다 복제) ------------------------------------ */
  const belt = spec?.connector?.belt ?? null;
  const materials = useMemo(() => {
    if (built?.kind !== 'tile') return null;
    return built.parts.map((p) => {
      if (!p.isBelt || !p.material || preview) return p.material;
      const m = p.material.clone();
      if (m.map) {
        m.map = m.map.clone();
        m.map.wrapS = THREE.RepeatWrapping;
        m.map.wrapT = THREE.RepeatWrapping;
        m.map.needsUpdate = true;
      }
      m.userData.__cloned = true;
      return m;
    });
  }, [built, preview]);

  useEffect(() => () => {
    materials?.forEach((m) => {
      if (!m?.userData?.__cloned) return;
      m.map?.dispose();
      m.dispose();
    });
  }, [materials]);

  const beltMaps = useMemo(
    () => (materials ?? []).filter((m) => m?.userData?.__cloned && m.map).map((m) => m.map),
    [materials],
  );

  const speed = link?.speed ?? defaultSpeed;
  const driveRef = useRef(0);
  driveRef.current = running && belt && !preview ? speed : 0;

  useFrame((_, dt) => {
    const v = driveRef.current;
    if (!v || !beltMaps.length || !belt) return;
    // 진행 방향으로 흐르게 하려면 UV 기울기의 반대 부호로 오프셋을 움직인다
    const d = -belt.uvGradient * v * Math.min(dt, 0.1);
    for (const map of beltMaps) map.offset.x = (map.offset.x + d) % 1;
  });

  const hitGeom = useMemo(() => (path && !preview ? buildHitGeometry(path) : null), [path, preview]);
  useEffect(() => () => hitGeom?.dispose(), [hitGeom]);

  if (!path) return null;
  const color = preview ? (valid ? '#22d3ee' : '#f43f5e') : selected ? SELECT_COLOR : item?.color ?? '#94a3b8';

  return (
    <group>
      {/* 절차적 튜브 (전선 · 배관) */}
      {built?.kind === 'tube' && (
        <mesh geometry={built.geometry} castShadow receiveShadow>
          <meshStandardMaterial
            color={preview || selected ? color : item?.color ?? '#94a3b8'}
            metalness={0.35}
            roughness={0.55}
            transparent={preview}
            opacity={preview ? 0.7 : 1}
            emissive={selected ? SELECT_COLOR : '#000000'}
            emissiveIntensity={selected ? 0.25 : 0}
          />
        </mesh>
      )}

      {/* 모델 반복 (컨베이어 · 레일) */}
      {built?.kind === 'tile' &&
        built.parts.map((p, i) =>
          preview ? (
            <mesh key={i} geometry={p.geometry}>
              <meshStandardMaterial color={color} transparent opacity={0.55} depthWrite={false} />
            </mesh>
          ) : (
            <mesh key={i} geometry={p.geometry} material={materials[i]} castShadow receiveShadow />
          ),
        )}

      {/* 모델이 아직 없을 때라도 경로는 보여 준다 */}
      {!built && <Centerline path={path} color={color} lift={0.3} />}

      {(preview || selected) && <Centerline path={path} color={color} lift={0.05} opacity={preview ? 0.95 : 0.6} />}

      {/* 클릭 판정 — 얇은 경로를 정확히 집기 어려우니 굵은 투명 튜브를 덮는다.
          visible={false} 로 두면 r3f 가 레이캐스트 대상에서 제외하므로,
          "보이지 않게" 는 머티리얼 쪽에서 처리해야 한다. */}
      {hitGeom && (
        <mesh geometry={hitGeom} onPointerDown={onPointerDown} onPointerOver={onPointerOver} onPointerOut={onPointerOut}>
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      )}
    </group>
  );
}
