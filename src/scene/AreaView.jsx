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
import { selItems, selUidsOf } from '../core/store.jsx';
import {
  FLOOR_COLOR,
  edgeExtension,
  edgeSpec,
  mpEdges,
  mpLabelPoint,
  openingAtPoint,
  openingsOn,
  wallJoints,
  wallLines,
  wallPieces,
} from '../core/area.js';

/* 바닥 위에 깔리는 것들의 높이 순서.
   ---------------------------------------------------------------------------
    바닥(0.006) → 그리드(0.024, EditorScene) → 구역 → 개구부 → 구역 이름표

    구역은 그리드 **위**다. 아래에 두면 눈금이 구역 위에 격자로 찍혀 색이
    탁해지고, 반투명한 면 위에 촘촘한 선이 겹쳐 어느 구역인지 읽기 어렵다.
    구역은 바닥에 칠한 페인트가 아니라 도면 위에 얹은 표시라서, 눈금을 덮는
    쪽이 보기에도 맞다. 눈금은 구역 밖에서 계속 보인다. */
const FLOOR_Y = 0.006;
const ZONE_Y = 0.030;
const ZONE_LABEL_Y = 0.044;
/** 개구부 문지방 — 구역 위에 얹는다 (선반의 입출고 띠와 같은 높이 감각) */
const OPENING_Y = 0.038;

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
/**
 * 바닥 외곽선.
 *  바닥 색이 배경과 톤이 비슷해서, 멀리서 보면 어디까지가 작업장인지 경계가
 *  녹아 버린다. 벽이 감춰진 3D 뷰에서는 특히 그렇다. 테두리를 한 줄 둘러
 *  윤곽만은 항상 남긴다. 굵기는 화면 픽셀이 아니라 미터라 축척이 유지된다.
 */
const OUTLINE_COLOR = '#22c55e';
const OUTLINE_WIDTH = 0.35;

function AreaOutline({ mp }) {
  const segs = useMemo(() => {
    const out = [];
    for (const poly of mp ?? []) {
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
            len: len + OUTLINE_WIDTH,
            angle: Math.atan2(dx, dz),
          });
        }
      }
    }
    return out;
  }, [mp]);

  return (
    <group>
      {segs.map((s, i) => (
        <mesh
          key={i}
          position={[s.mid[0], FLOOR_Y + 0.004, s.mid[1]]}
          rotation={[-Math.PI / 2, 0, s.angle]}
          renderOrder={2}
          raycast={() => null}
        >
          <planeGeometry args={[OUTLINE_WIDTH, s.len]} />
          <meshBasicMaterial color={OUTLINE_COLOR} transparent opacity={0.9} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

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
/**
 * 감춰진 벽은 클릭도 받지 않는다.
 * --------------------------------------------------------------------------
 *  돌하우스로 앞 벽을 숨기면 그 벽은 `visible = false` 가 되지만, 레이캐스트는
 *  그것과 무관하게 계속 맞는다. 그래서 안 보이는 벽이 그 뒤의 설비·바닥 대신
 *  선택되는 일이 생긴다. 보이지 않는 것은 집을 수도 없어야 한다.
 */
function raycastIfVisible(raycaster, intersects) {
  if (this.parent && this.parent.visible === false) return;
  THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);
}

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
const WallRun = React.forwardRef(function WallRun(
  { a, b, nx = 0, nz = 0, thickness, height, color, highlight, extA = 0, extB = 0, openings, onPointerDown },
  ref,
) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1e-6;
  const ux = dx / len;
  const uz = dz / len;
  const angle = Math.atan2(dx, dz);
  const mats = useBoxMaterials(color, highlight);

  /* 개구부가 있으면 벽이 여러 토막(기둥·인방·밑턱)으로 갈라진다 */
  const pieces = useMemo(
    () => wallPieces(-extA, len + extB, height, openings),
    [extA, extB, len, height, openings],
  );

  return (
    <group ref={ref}>
      {pieces.map((p, i) => {
        const uc = (p.u0 + p.u1) / 2;
        return (
          <mesh
            key={i}
            position={[
              a[0] + ux * uc + nx * (thickness / 2),
              (p.y0 + p.y1) / 2,
              a[1] + uz * uc + nz * (thickness / 2),
            ]}
            rotation={[0, angle, 0]}
            material={mats}
            raycast={raycastIfVisible}
            castShadow
            receiveShadow
            onPointerDown={onPointerDown}
          >
            <boxGeometry args={[thickness, p.y1 - p.y0, p.u1 - p.u0]} />
          </mesh>
        );
      })}
    </group>
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
function AreaWalls({ area, areaUid, dollhouse, selectedFaces, openings, onEdgeDown }) {
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
        const ext = edgeExtension(area.mp, area, e);
        return (
          <WallRun
            key={e.key + i}
            ref={(o) => { refs.current[i] = o; }}
            a={e.a}
            b={e.b}
            nx={e.nx}
            nz={e.nz}
            extA={ext.atA}
            extB={ext.atB}
            openings={openingsOn({ a: e.a, b: e.b, spec: s }, openings)}
            {...s}
            highlight={selectedFaces?.has(areaUid + "|" + e.key)}
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

/* --------------------------------------------------------------------------
 * 개구부 표시
 * --------------------------------------------------------------------------
 *  탑뷰에서는 개구부가 **보이지 않는다.** 문틀 위 인방이 벽 두께를 그대로 덮고
 *  있어서 위에서 내려다보면 벽이 이어진 것과 구분되지 않기 때문이다. 그래서
 *  바닥에 문지방 띠를 깔아 "여기가 트여 있다" 를 도면에 남긴다.
 *
 *  클릭도 이 띠로 받는다. 구멍 자체는 빈 공간이라 집을 것이 없다.
 */
const OPENING_COLOR = '#38bdf8';

function OpeningMarks({ openings, lines, selected, pick, onPick, onSelect, onErase }) {
  const marks = useMemo(() => {
    const out = [];
    for (const o of openings) {
      /* 어느 벽에 얹혔는지는 좌표로 찾는다 — 벽이 사라졌으면 그리지 않는다 */
      let best = null;
      for (const line of lines) {
        for (const hit of openingsOn(line, [o])) {
          const dx = line.b[0] - line.a[0];
          const dz = line.b[1] - line.a[1];
          const len = Math.hypot(dx, dz) || 1;
          const cand = {
            at: [line.a[0] + (dx / len) * hit.u, line.a[1] + (dz / len) * hit.u],
            angle: Math.atan2(dx, dz),
            depth: line.spec?.thickness ?? 0.3,
            nx: line.nx ?? 0,
            nz: line.nz ?? 0,
          };
          if (!best) best = cand;
        }
      }
      if (best) out.push({ o, ...best });
    }
    return out;
  }, [openings, lines]);

  return (
    <group>
      {marks.map(({ o, at, angle, depth }) => {
        const on = selected?.kind === 'opening' && selected.uid === o.uid;
        return (
          <mesh
            key={o.uid}
            position={[at[0], OPENING_Y, at[1]]}
            rotation={[-Math.PI / 2, 0, angle]}
            /* 그리드보다 위에 얹는다 — 선반의 입출고 띠와 같은 방식이다.
               깊이 판정을 끄지 않으면 눈금이 띠 위에 격자로 찍혀서, 바닥에
               붙은 안내가 아니라 지저분한 무늬로 보인다. */
            renderOrder={7}
            raycast={pick ? undefined : () => null}
            onPointerDown={(e) => {
              if (!pick) return;
              e.stopPropagation();
              onPick?.();
              if (onErase) onErase('opening', o.uid);
              else onOpeningDown?.(o, null, e);
            }}
          >
            {/* 판의 로컬 X = 벽 두께 방향, Y = 개구부 폭 방향 */}
            <planeGeometry args={[depth * 1.6, o.width]} />
            <meshBasicMaterial
              color={on ? '#22c55e' : OPENING_COLOR}
              transparent
              opacity={on ? 0.9 : 0.7}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/* ========================================================================== */

export default function AreaView({
  areas = [],
  walls = [],
  pillars = [],
  zones = [],
  openings = [],
  dollhouse = false,
  selected = null,
  onSelect,
  onErase,
  onPick,
  onPillarDown,
  onOpeningDown,
  onToggle,
  pick = true,
}) {
  /* 골라진 것들을 종류별로 갈라 둔다. 벽면은 uid 하나로 못 가리므로
     '영역uid|변key' 를 이름으로 쓴다. */
  const selPillar = useMemo(() => new Set(selUidsOf(selected, 'pillar')), [selected]);
  const selWall = useMemo(() => new Set(selUidsOf(selected, 'wall')), [selected]);
  const selFace = useMemo(
    () =>
      new Set(
        selItems(selected)
          .filter((i) => i.kind === 'area' && i.edge)
          .map((i) => `${i.uid}|${i.edge}`),
      ),
    [selected],
  );

  /* 도구가 무언가를 그리는 중일 때는 건물이 클릭을 가로채면 안 된다 —
     바닥 위에 점을 찍어야 하는데 바닥이 선택돼 버린다.
     고를 때는 onPick 으로 "집었다" 를 알린다. 이걸 빼먹으면 씬의 빈 바닥
     클릭 처리가 뒤이어 돌면서 방금 고른 것을 그 자리에서 놓아 버린다. */
  const down = (kind, uid, extra) => (e) => {
    /* 오른쪽·휠 버튼은 화면을 돌리고 미는 데 쓴다 */
    if (!pick || e.nativeEvent?.button !== 0) return;
    e.stopPropagation();
    onPick?.();
    if (e.nativeEvent?.ctrlKey || e.nativeEvent?.metaKey) {
      onToggle?.({ kind, uid, ...extra });
      return;
    }
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
          <AreaOutline mp={a.mp} />
          <AreaWalls
            area={a}
            dollhouse={dollhouse}
            openings={openings}
            selectedFaces={selFace}
            areaUid={a.uid}
            onEdgeDown={(edge, e) => {
              if (!pick || e.nativeEvent?.button !== 0) return;
              e.stopPropagation();
              onPick?.();
              if (onErase) return onErase('area', a.uid);

              /* 누른 자리가 문의 폭 안이면 벽이 아니라 문을 고른다.
                 문 위 인방이 클릭을 먼저 받기 때문에, 문지방 띠에 걸어 둔
                 클릭만으로는 탑뷰에서 영영 잡히지 않는다. */
              const line = { a: edge.a, b: edge.b, spec: edgeSpec(a, edge.key) };
              const hitOpen = openingAtPoint(line, openings, [e.point.x, e.point.z]);
              if (hitOpen) return onOpeningDown?.(hitOpen, line, e);

              const one = { kind: 'area', uid: a.uid, edge: edge.key };
              /* 바닥과 벽은 서로 다른 대상이다 — 벽을 누르면 그 면이 바로
                 잡힌다. 영역 전체를 보려면 바닥을 누르거나 패널의 버튼을 쓴다. */
              if (e.nativeEvent?.ctrlKey || e.nativeEvent?.metaKey) onToggle?.(one);
              else onSelect?.(one);
            }}
          />
        </group>
      ))}

      {walls.map((w) => {
        /* 코너·외벽 접합에서 귀퉁이가 비지 않도록 끝을 늘린다 (area.js) */
        const j = wallJoints(w, { walls, areas });
        return (
        <WallRun
          key={w.uid}
          a={w.a}
          b={w.b}
          extA={j.atA}
          extB={j.atB}
          thickness={w.thickness}
          height={w.height}
          color={w.color}
          openings={openingsOn({ a: w.a, b: w.b, spec: w }, openings)}
          highlight={selWall.has(w.uid)}
          onPointerDown={(e) => {
            /* 외벽과 같은 규칙 — 문의 폭 안을 눌렀으면 문이 잡힌다 */
            if (!pick || e.nativeEvent?.button !== 0) return;
            const line = { a: w.a, b: w.b, spec: w };
            const hitOpen = openingAtPoint(line, openings, [e.point.x, e.point.z]);
            if (hitOpen) {
              e.stopPropagation();
              onPick?.();
              if (onErase) return onErase('opening', hitOpen.uid);
              return onOpeningDown?.(hitOpen, line, e);
            }
            down('wall', w.uid)(e);
          }}
        />
        );
      })}

      {/* 기둥은 끌어서 옮길 수 있어야 하므로 씬이 직접 받는다 —
          여기서 선택만 하고 끝내면 잡을 기회가 없다 */}
      {pillars.map((p) => (
        <Pillar
          key={p.uid}
          pillar={p}
          highlight={selPillar.has(p.uid)}
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

      <OpeningMarks
        openings={openings}
        lines={wallLines(areas, walls)}
        selected={selected}
        pick={pick}
        onPick={onPick}
        onSelect={onSelect}
        onErase={onErase}
      />
    </group>
  );
}
