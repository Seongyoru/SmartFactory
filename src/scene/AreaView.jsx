/**
 * =============================================================================
 *  작업 영역 렌더 — 바닥 · 벽 · 기둥 · 구역
 * =============================================================================
 *  형상은 전부 단순한 사각 기둥(box)과 다각형 판(shape)이다. 실제 건축 디테일을
 *  흉내 내면 도면이 무거워지고 정작 봐야 할 설비가 묻힌다. 여기서 필요한 것은
 *  "어디까지가 우리 작업장인가" 하나뿐이다.
 *
 *  ── 돌하우스(dollhouse) ────────────────────────────────────────────────────
 *  3D 로 보면 앞쪽 벽이 내부를 통째로 가린다. 부동산 3D 투어처럼 **카메라 쪽을
 *  향한 벽만 감춘다.** 변마다 바깥 방향을 알고 있으므로(area.js), 카메라가 그
 *  변의 바깥쪽에 있으면 = 그 벽이 나와 내부 사이에 있으면 숨긴다.
 *  탑뷰에서는 카메라가 바로 위에 있어 어떤 벽도 "바깥쪽" 이 되지 않으므로
 *  자연히 전부 보인다 — 도면을 볼 때는 벽이 다 있어야 하니 마침 맞다.
 *
 *  좌표 변환 메모: 바닥 다각형은 THREE.Shape(2D, XY)로 만들고 X축 -90° 회전으로
 *  눕힌다. 이때 로컬 y 는 월드 -z 가 되므로, 도형을 만들 때 z 의 부호를 뒤집는다.
 * ---------------------------------------------------------------------------
 */

import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { FLOOR_COLOR, edgeExtension, edgeSpec, mpEdges, mpLabelPoint, wallBox } from '../core/area.js';

/* 바닥 위에 깔리는 것들의 높이 순서.
   그리드(0.024)는 이 둘보다 위에 있어야 멀리서 봐도 눈금이 살아 있다.
   반대로 구역 이름표는 그리드에 가려지면 못 읽으므로 그리드보다 위에 둔다. */
const FLOOR_Y = 0.006;
const ZONE_Y = 0.014;
const ZONE_LABEL_Y = 0.03;

/* --------------------------------------------------------------------------
 * 다각형 → 눕힌 판 지오메트리
 * ------------------------------------------------------------------------ */
function mpShapes(mp) {
  const shapes = [];
  for (const poly of mp ?? []) {
    const [outer, ...holes] = poly;
    if (!outer?.length) continue;
    const s = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const h of holes) {
      s.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
    }
    shapes.push(s);
  }
  return shapes;
}

function useMPGeometry(mp) {
  const geom = useMemo(() => {
    const shapes = mpShapes(mp);
    return shapes.length ? new THREE.ShapeGeometry(shapes) : null;
  }, [mp]);
  useEffect(() => () => geom?.dispose(), [geom]);
  return geom;
}

/* --------------------------------------------------------------------------
 * 바닥
 * ------------------------------------------------------------------------ */
function AreaFloor({ area, selected, onPointerDown }) {
  const geom = useMPGeometry(area.mp);
  if (!geom) return null;
  return (
    <mesh
      geometry={geom}
      position={[0, FLOOR_Y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      onPointerDown={onPointerDown}
    >
      {/* 바닥 색은 고정 — 그 위에 깔리는 구역·그리드의 대비가 도면마다
          달라지면 안 된다 (area.js 의 FLOOR_COLOR) */}
      <meshStandardMaterial
        color={FLOOR_COLOR}
        roughness={0.95}
        metalness={0}
        emissive={selected ? '#22c55e' : '#000000'}
        emissiveIntensity={selected ? 0.12 : 0}
      />
    </mesh>
  );
}

/* --------------------------------------------------------------------------
 * 벽·기둥의 면 재질
 * --------------------------------------------------------------------------
 *  **윗면만 어둡게 고정한다.** 탑뷰에서는 벽과 기둥이 오직 윗면으로만 보이는데,
 *  옆면과 같은 색이면 밝은 바닥 위에서 윤곽이 녹아 없어져 도면을 읽을 수 없다.
 *  색을 사용자가 정하게 해 놓았으니(밝은 색을 고를 수도 있다) 윗면은 사용자
 *  선택에서 떼어 내 고정값으로 둔다 — 도면의 가독성은 취향의 문제가 아니다.
 *
 *  BoxGeometry 의 면 순서는 [+X, −X, +Y, −Y, +Z, −Z] 라서 2번이 윗면이다.
 *  옆면 재질 하나를 다섯 칸에 같이 물려 드로우콜을 늘리지 않는다.
 */
const TOP_COLOR = '#404040';
const SELECT_EMISSIVE = '#22c55e';

function useBoxMaterials(color, highlight) {
  const mats = useMemo(() => {
    const common = {
      emissive: new THREE.Color(highlight ? SELECT_EMISSIVE : '#000000'),
      emissiveIntensity: highlight ? 0.45 : 0,
    };
    const side = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...common });
    const top = new THREE.MeshStandardMaterial({ color: TOP_COLOR, roughness: 0.9, metalness: 0.02, ...common });
    return [side, side, top, side, side, side];
  }, [color, highlight]);

  /* 재질은 손으로 만들었으니 손으로 치운다 — r3f 가 대신 버려 주지 않는다 */
  useEffect(() => () => { mats[0].dispose(); mats[2].dispose(); }, [mats]);
  return mats;
}

/* --------------------------------------------------------------------------
 * 벽 한 장 — 상자 하나
 * --------------------------------------------------------------------------
 *  바깥쪽으로 두께의 반만큼 밀어 세운다 — 영역으로 그린 도형이 곧 **쓸 수 있는
 *  바닥** 이어야 하기 때문이다. 벽이 안으로 파고들면 그려 놓은 면적보다 실제로
 *  설비를 놓을 수 있는 자리가 줄어든다. (경계선 = 벽의 안쪽 면)
 *
 *  코너에서는 꼭짓점 너머로 **이웃 벽의 두께만큼** 더 나가야 귀퉁이 칸이 채워진다.
 *  extA · extB 가 그 값이고, 양쪽이 다를 수 있으므로 늘어난 만큼 중심도 옮긴다.
 */
const WallBox = React.forwardRef(function WallBox(
  { mid, angle, len, nx, nz, thickness, height, color, highlight, extA = 0, extB = 0, onPointerDown },
  ref,
) {
  const full = len + extA + extB;
  const shift = (extB - extA) / 2;                 // 늘어난 쪽으로 중심이 밀린다
  const dirX = Math.sin(angle);                    // a→b 방향 (angle = atan2(dx, dz))
  const dirZ = Math.cos(angle);
  const cx = mid[0] + nx * (thickness / 2) + dirX * shift;
  const cz = mid[1] + nz * (thickness / 2) + dirZ * shift;
  const mats = useBoxMaterials(color, highlight);
  return (
    <mesh
      ref={ref}
      position={[cx, height / 2, cz]}
      rotation={[0, angle, 0]}
      material={mats}
      castShadow
      receiveShadow
      onPointerDown={onPointerDown}
    >
      <boxGeometry args={[thickness, height, full]} />
    </mesh>
  );
});

/** 기둥 — 벽과 같은 규칙(윗면만 어둡게) */
function Pillar({ pillar, highlight, onPointerDown }) {
  const mats = useBoxMaterials(pillar.color, highlight);
  return (
    <mesh
      position={[pillar.pos[0], pillar.height / 2, pillar.pos[1]]}
      material={mats}
      castShadow
      receiveShadow
      onPointerDown={onPointerDown}
    >
      <boxGeometry args={[pillar.size[0], pillar.height, pillar.size[1]]} />
    </mesh>
  );
}

/* --------------------------------------------------------------------------
 * 영역의 외벽 — 돌하우스 컬링을 여기서 건다
 * ------------------------------------------------------------------------ */
function AreaWalls({ area, dollhouse, selectedEdge, onEdgeDown }) {
  const edges = useMemo(() => mpEdges(area.mp), [area.mp]);
  const refs = useRef([]);
  const cam = useRef(new THREE.Vector3());

  useFrame(({ camera }) => {
    camera.getWorldPosition(cam.current);
    edges.forEach((e, i) => {
      const m = refs.current[i];
      if (!m) return;
      if (!dollhouse) {
        m.visible = true;
        return;
      }
      /* 카메라가 이 변의 바깥쪽에 있으면 나와 내부 사이를 막고 서 있다 */
      const dx = cam.current.x - e.mid[0];
      const dz = cam.current.z - e.mid[1];
      m.visible = dx * e.nx + dz * e.nz <= 0.5;
    });
  });

  return (
    <group>
      {edges.map((e, i) => {
        const s = edgeSpec(area, e.key);
        const ext = edgeExtension(area, e);
        return (
          <WallBox
            key={e.key + i}
            ref={(o) => { refs.current[i] = o; }}
            mid={e.mid}
            angle={e.angle}
            len={e.len}
            nx={e.nx}
            nz={e.nz}
            extA={ext.atA}
            extB={ext.atB}
            {...s}
            highlight={selectedEdge === e.key}
            onPointerDown={(ev) => onEdgeDown?.(e, ev)}
          />
        );
      })}
    </group>
  );
}

/* --------------------------------------------------------------------------
 * 구역 — 반투명 오버레이 + 바닥에 찍히는 이름
 * ------------------------------------------------------------------------ */

/** 이름표를 캔버스에 그려 텍스처로 쓴다 (폰트 파일을 받아오지 않아도 된다) */
function useLabelTexture(text, color) {
  return useMemo(() => {
    if (!text) return null;
    const pad = 24;
    const size = 128;
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = `bold ${size}px "Malgun Gothic", "Noto Sans KR", sans-serif`;
    const w = Math.ceil(probe.measureText(text).width) + pad * 2;
    const h = size + pad * 2;

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.font = `bold ${size}px "Malgun Gothic", "Noto Sans KR", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = size * 0.14;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.strokeText(text, w / 2, h / 2);
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2);

    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    tex.userData.aspect = w / h;
    return tex;
  }, [text, color]);
}

function ZoneLabel({ zone }) {
  const tex = useLabelTexture(zone.name, zone.labelColor ?? '#0f172a');
  const at = useMemo(() => mpLabelPoint(zone.mp), [zone.mp]);
  useEffect(() => () => tex?.dispose(), [tex]);
  if (!tex || !at) return null;

  const h = zone.labelSize ?? 1.6;
  const w = h * tex.userData.aspect;
  return (
    <mesh position={[at[0], ZONE_LABEL_Y, at[1]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4} raycast={() => null}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </mesh>
  );
}

/**
 * 구역 외곽선.
 * --------------------------------------------------------------------------
 *  선(line)이 아니라 **바닥에 눕힌 납작한 띠**로 그린다. WebGL 은 선 굵기를
 *  무시해서 lineWidth 로는 굵기를 정할 수 없는데, 구역 경계는 축척에 맞는
 *  굵기(m)로 보여야 도면에서 의미가 있기 때문이다.
 *
 *  코너는 벽과 같은 방법으로 메운다 — 각 토막을 폭만큼 양쪽으로 늘이면
 *  꺾이는 자리에 빈 사각형이 남지 않는다.
 */
function ZoneOutline({ zone }) {
  const w = zone.outlineWidth ?? 0.14;
  const segs = useMemo(() => {
    const out = [];
    for (const poly of zone.mp ?? []) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i];
          const b = ring[i + 1];
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const len = Math.hypot(dx, dz);
          if (len < 1e-6) continue;
          out.push({
            mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
            len: len + w,
            angle: Math.atan2(dx, dz),
          });
        }
      }
    }
    return out;
  }, [zone.mp, w]);

  return (
    <group>
      {segs.map((s, i) => (
        <mesh
          key={i}
          position={[s.mid[0], ZONE_Y + 0.002, s.mid[1]]}
          /* 눕힌 판에서는 Z 회전이 먼저(오일러 XYZ) 걸린다. 길이축이 변과
             나란해지는 값은 +angle 이다 — 90° 배수에서는 부호를 틀려도 우연히
             맞으므로, 펜으로 그린 비스듬한 변에서만 어긋난다. */
          rotation={[-Math.PI / 2, 0, s.angle]}
          renderOrder={4}
          raycast={() => null}
        >
          <planeGeometry args={[w, s.len]} />
          <meshBasicMaterial color={zone.outlineColor ?? zone.color} transparent opacity={0.95} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 구역 오버레이.
 *  **클릭을 받지 않는다.** 구역은 바닥 전체를 덮는 큰 면이라 픽킹을 켜 두면
 *  그 위의 설비를 고르려다 번번이 구역이 잡힌다. 선택과 관리는 화면 오른쪽
 *  아래의 구역 레이어 목록에서 한다.
 */
function ZoneOverlay({ zone, selected }) {
  const geom = useMPGeometry(zone.mp);
  if (!geom || zone.hidden) return null;
  return (
    <group>
      <mesh
        geometry={geom}
        position={[0, ZONE_Y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={3}
        raycast={() => null}
      >
        <meshBasicMaterial
          color={selected ? '#22c55e' : zone.color}
          transparent
          opacity={selected ? Math.min(1, (zone.opacity ?? 0.28) + 0.2) : zone.opacity ?? 0.28}
          depthWrite={false}
        />
      </mesh>
      {zone.outline !== false && <ZoneOutline zone={zone} />}
      <ZoneLabel zone={zone} />
    </group>
  );
}

/* ========================================================================== */

export default function AreaView({
  areas = [],
  walls = [],
  pillars = [],
  zones = [],
  dollhouse = false,
  selected = null,
  onSelect,
  onErase,
  onPick,
  onPillarDown,
  pick = true,
}) {
  /* 여러 개를 골랐을 때를 위해 uids 를 집합으로 (없으면 uid 하나) */
  const selectedSet = useMemo(
    () => new Set(selected?.uids ?? (selected?.uid ? [selected.uid] : [])),
    [selected],
  );
  /* 도구가 무언가를 그리는 중일 때는 건물이 클릭을 가로채면 안 된다 —
     바닥 위에 점을 찍어야 하는데 바닥이 선택돼 버린다.
     고를 때는 onPick 으로 "집었다" 를 알린다. 이걸 빼먹으면 씬의 빈 바닥
     클릭 처리가 뒤이어 돌면서 방금 고른 것을 그 자리에서 놓아 버린다. */
  const down = (kind, uid, extra) => (e) => {
    if (!pick) return;
    e.stopPropagation();
    onPick?.();
    if (onErase) onErase(kind, uid);
    else onSelect?.({ kind, uid, ...extra });
  };

  return (
    <group>
      {areas.map((a) => (
        <group key={a.uid}>
          <AreaFloor
            area={a}
            selected={selected?.kind === 'area' && selected.uid === a.uid && !selected.edge}
            onPointerDown={down('area', a.uid)}
          />
          <AreaWalls
            area={a}
            dollhouse={dollhouse}
            selectedEdge={selected?.kind === 'area' && selected.uid === a.uid ? selected.edge : null}
            onEdgeDown={(edge, e) => {
              if (!pick) return;
              e.stopPropagation();
              onPick?.();
              if (onErase) return onErase('area', a.uid);
              /* 바닥과 벽은 서로 다른 대상이다 — 벽을 누르면 그 면이 바로
                 잡힌다. 영역 전체를 보려면 바닥을 누르거나 패널의 버튼을 쓴다. */
              onSelect?.({ kind: 'area', uid: a.uid, edge: edge.key });
            }}
          />
        </group>
      ))}

      {walls.map((w) => {
        const g = wallBox(w);
        return (
          <WallBox
            key={w.uid}
            mid={g.mid}
            angle={g.angle}
            len={g.len}
            nx={0}
            nz={0}
            thickness={w.thickness}
            height={w.height}
            color={w.color}
            highlight={selected?.kind === 'wall' && selected.uid === w.uid}
            onPointerDown={down('wall', w.uid)}
          />
        );
      })}

      {/* 기둥은 끌어서 옮길 수 있어야 하므로 씬이 직접 받는다 —
          여기서 선택만 하고 끝내면 잡을 기회가 없다 */}
      {pillars.map((p) => (
        <Pillar
          key={p.uid}
          pillar={p}
          highlight={selectedSet?.has(p.uid) && selected?.kind === 'pillar'}
          onPointerDown={(e) => {
            if (!pick) return;
            onPillarDown?.(p, e);
          }}
        />
      ))}

      {zones.map((z) => (
        <ZoneOverlay
          key={z.uid}
          zone={z}
          selected={selected?.kind === 'zone' && selected.uid === z.uid}
        />
      ))}
    </group>
  );
}
