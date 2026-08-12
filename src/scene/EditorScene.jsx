/**
 * =============================================================================
 *  배치 에디터 3D 씬
 * =============================================================================
 *  뷰는 두 가지다.
 *   탑뷰(top) — 정사영 카메라로 바로 위에서 내려다본다. 배치는 여기서만 한다.
 *               도면 좌표계가 화면 좌표계와 1:1 로 대응해서 "몇 칸" 감각이
 *               정확히 맞고, 그리드 스냅 결과가 눈에 그대로 보인다.
 *   3D(iso)   — 원근 카메라 + 궤도 조작. 확인용. 배치는 막는다.
 *
 *  포인터 처리
 *   바닥 좌표는 r3f 이벤트가 아니라 카메라 레이 ↔ Y=0 평면 교차로 직접 구한다.
 *   설비 위에 커서가 올라가 있어도 바닥 좌표가 끊기지 않아야 드래그 이동이
 *   매끄럽기 때문이다. 반면 "무엇을 집었는가" 는 r3f 픽킹을 쓴다.
 * ---------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';

import { SHAPE, TOOL, VIEW, isBuildTool, selItems, selUidsOf, useEditor } from '../core/store.jsx';
import {
  MIN_AREA_SIDE,
  WALL_DEFAULTS,
  floorOf,
  hitsObstacle,
  crossesWall,
  inGate,
  insertVertex,
  moveVertex,
  mpMidpoints,
  mpVertices,
  vertexNeighbors,
  openingsOn,
  slideOpening,
  openingGates,
  pointInMP,
  obstacleHitsRects,
  penMP,
  pillarFootprint,
  rectInFloor,
  rectMP,
  snapToWall,
  snapWallPoint,
  wallLines,
  wallFootprint,
  edgeSpec,
  mpEdges,
} from '../core/area.js';
import AreaView from './AreaView.jsx';
import {
  FLOOR_HALF,
  MAJOR_GRID,
  PORT_SNAP_DIST,
  clean,
  edgeSnap,
  footprintOf,
  outOfBounds,
  rectsOverlap,
  snap,
} from '../core/grid.js';
import { getSpec, subscribeModels } from '../core/modelStore.js';
import { publishCursor } from '../core/cursorStore.js';
import { subscribeFocus } from '../core/focusStore.js';
import { allPorts, autoLayer, layerLift, linkPath, nearestPort } from '../core/link.js';
import { buildConnectorPath, buildFreePath } from '../core/routing.js';
import { rotateXZ } from '../core/grid.js';
import {
  PORT_KIND,
  PORT_ZONE_DEPTH,
  PORT_ZONE_OUT,
  PORT_ZONE_WIDTH,
  incompatibleReason,
  portsCompatible,
  quantizeDir,
} from '../core/ports.js';
import PlacedModel, { FootprintOutline, SelectionCage } from './PlacedModel.jsx';
import ConnectorView from './ConnectorView.jsx';
import PortMarkers from './PortMarkers.jsx';
import CartView from './CartView.jsx';
import BeltItems from './BeltItems.jsx';
import EditHandles from './EditHandles.jsx';
import { cartPath, cartStations } from '../core/cart.js';
import { shelfBBox } from '../core/shelf.js';
import { stillageCapacity } from '../core/stillage.js';
import { addStock, getStock, shippedTotal, useAllStock, useShipped } from '../core/simStore.js';
import { tick } from '../core/clock.js';
import { accumulate } from '../core/metrics.js';
import { FAULT_DEFAULTS, pruneFaults, screen, stepFaults, useFaults } from '../core/faults.js';
import { isShelf, isStillage, isTruck, isUtility, payloadKeyOf, payloadOf } from '../data/library.js';
import ShelfView from './ShelfView.jsx';
import StillageView from './StillageView.jsx';
import ZoneMarks from './ZoneMarks.jsx';
import { sceneTheme } from '../theme.js';

/** 카트 경로를 그릴 때 첫 점을 다시 눌러 고리를 닫는 거리(m) */
const CLOSE_DIST = 1.2;
/** 배관이 기존 배관에 분기(T)로 달라붙는 거리(m) */
const BRANCH_SNAP_DIST = 1.0;
/** 배관·전선이 설비에 붙는 것으로 보는 여유 폭(m) */
const ANCHOR_MARGIN = 0.8;

/**
 * 시뮬 시계를 돌리고, 그 시간으로 지표를 쌓는다.
 * ---------------------------------------------------------------------------
 *  시계는 **프레임마다 딱 한 번** 흘러야 해서 전용 컴포넌트로 둔다(벨트·카트는
 *  각자 `simStep(dt)` 으로 같은 값을 읽어 가되, 경과 시간을 더하지는 않는다).
 *
 *  여기서 막힌 설비 목록을 함께 넘긴다 — 그 시간을 적분한 것이 곧 가동률이고,
 *  가장 오래 막힌 설비가 병목이다. 이미 매 프레임 계산하면서 버리던 값이다.
 */
function SimClock({ running, halted, equips }) {
  const shipped = shippedTotal(useShipped());
  useFrame((_, real) => {
    const dt = tick(real, running);
    if (!(dt > 0)) return;

    /* 고장을 굴린다 — 이번 프레임에 고장으로 서 있는 설비가 돌아온다 */
    const nowDown = stepFaults(dt, equips);

    /**
     * 막힘과 고장은 **겹쳐 세면 안 된다.**
     * -----------------------------------------------------------------------
     *  고장 난 설비는 halted 목록에도 들어 있다(벨트를 세워야 하므로). 그대로
     *  적분하면 같은 시간을 두 번 빼서 가동률과 성능이 함께 깎이고, 둘을 나눠
     *  세는 뜻이 사라진다. 고장 중인 시간은 고장 쪽에만 넣는다.
     */
    const blockedOnly = new Set();
    for (const uid of halted) if (!nowDown.has(uid)) blockedOnly.add(uid);
    accumulate(dt, blockedOnly, shipped);
  });
  return null;
}

/** 모델 캐시가 갱신될 때(로드 완료) 다시 그리기 위한 버전 카운터 */
function useModelsVersion() {
  const [v, setV] = useState(0);
  useEffect(() => subscribeModels(() => setV((n) => n + 1)), []);
  return v;
}

/* ==========================================================================
 * 카메라 · 조작
 * ======================================================================== */

/**
 * 탑뷰 전용 조작.
 *  OrbitControls 를 쓰지 않는 이유: 왼쪽 버튼을 배치에 써야 한다.
 *  - 휠      : 커서 기준 확대/축소 (커서 밑 좌표가 고정된다)
 *  - 우/휠클릭 드래그 : 평행 이동
 */
function TopControls({ zoomRef }) {
  const { gl, camera, size } = useThree();

  useEffect(() => {
    const el = gl.domElement;
    let panning = false;
    let last = null;

    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = -((e.clientY - r.top) / r.height) * 2 + 1;

      const z0 = camera.zoom;
      const wx = camera.position.x + (nx * size.width) / (2 * z0);
      const wz = camera.position.z - (ny * size.height) / (2 * z0);

      const z1 = Math.min(120, Math.max(2, z0 * Math.exp(-e.deltaY * 0.0012)));
      camera.zoom = z1;
      camera.position.x = wx - (nx * size.width) / (2 * z1);
      camera.position.z = wz + (ny * size.height) / (2 * z1);
      camera.updateProjectionMatrix();
      if (zoomRef) zoomRef.current = z1;
    };

    const onDown = (e) => {
      if (e.button === 1 || e.button === 2) {
        panning = true;
        last = [e.clientX, e.clientY];
        el.setPointerCapture?.(e.pointerId);
      }
    };
    const onMove = (e) => {
      if (!panning || !last) return;
      const dx = e.clientX - last[0];
      const dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      camera.position.x -= dx / camera.zoom;
      camera.position.z -= dy / camera.zoom;
    };
    const onUp = () => { panning = false; last = null; };
    const onCtx = (e) => e.preventDefault();

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('contextmenu', onCtx);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('contextmenu', onCtx);
    };
  }, [gl, camera, size.width, size.height, zoomRef]);

  return null;
}

/**
 * 카메라는 뷰가 바뀔 때만 다시 만든다.
 *  씬이 리렌더될 때마다 zoom prop 이 다시 적용되면 사용자가 확대해 둔 배율이
 *  매 조작마다 초기값으로 되돌아간다. memo 로 리렌더 자체를 막는다.
 */
const CameraRig = React.memo(function CameraRig({ view }) {
  const zoomRef = useRef(18);
  if (view === VIEW.TOP) {
    return (
      <>
        <OrthographicCamera
          makeDefault
          position={[0, 80, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          zoom={zoomRef.current}
          near={0.1}
          far={400}
        />
        <TopControls zoomRef={zoomRef} />
      </>
    );
  }
  return (
    <>
      <PerspectiveCamera makeDefault position={[26, 20, 30]} fov={42} near={0.1} far={600} />
      <OrbitControls makeDefault target={[0, 1, 0]} maxPolarAngle={Math.PI / 2.05} enableDamping dampingFactor={0.1} />
    </>
  );
});

/**
 * 조명.
 *  라이트 테마에서는 전체 광량을 올린다. 다크용 값을 그대로 쓰면 모델이
 *  배경보다 어두워져 실루엣만 남는다.
 */
function Lights({ view, theme }) {
  const top = view === VIEW.TOP;
  return (
    <>
      <hemisphereLight args={[theme.hemiSky, theme.hemiGround, top ? theme.hemiTop : theme.hemiIso]} />
      <ambientLight intensity={top ? theme.ambientTop : theme.ambientIso} />
      <directionalLight
        position={[24, 40, 18]}
        intensity={top ? theme.keyTop : theme.keyIso}
        castShadow={!top}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      <directionalLight position={[-20, 18, -24]} intensity={theme.fill} />
    </>
  );
}

/* ==========================================================================
 * 포인터 → 바닥 좌표
 * ======================================================================== */

function PointerDriver({ handlers }) {
  const { gl, camera, raycaster } = useThree();
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const el = gl.domElement;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();
    let downAt = null;

    const ground = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(plane, hit) ? [hit.x, hit.z] : null;
    };

    const onMove = (e) => {
      const p = ground(e);
      if (p) ref.current.onMove?.(p, e);
    };
    const onDown = (e) => {
      if (e.button !== 0) return;
      downAt = [e.clientX, e.clientY];
      /* 이 리스너는 캔버스에, r3f 의 리스너는 상위 컨테이너에 달려 있다.
         버블링 순서상 여기가 먼저 실행되므로, "무언가를 집었는가" 플래그를
         누를 때마다 여기서 초기화해 두면 뒤이어 실행되는 r3f 픽킹 결과를
         정확히 한 번의 클릭에 대해서만 반영할 수 있다. */
      ref.current.onDownStart?.();
      /* 면을 끌어 그리는 도구는 누른 자리가 시작점이다 */
      const p = ground(e);
      if (p) ref.current.onDownGround?.(p, e);
    };
    const onUp = (e) => {
      if (e.button === 0 && downAt) {
        const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
        const p = ground(e);
        if (moved < 5 && p && e.target === el) ref.current.onClick?.(p, e);
      }
      downAt = null;
      ref.current.onUp?.(e);
    };
    /* 더블클릭은 "그리기 끝" 신호로 쓴다 (카트 경로) */
    const onDouble = (e) => {
      const p = ground(e);
      if (p) ref.current.onDouble?.(p, e);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('dblclick', onDouble);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('dblclick', onDouble);
      window.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera, raycaster]);

  return null;
}

/* ==========================================================================
 * 바닥 · 경계
 * ======================================================================== */

function Floor({ gridSize, show, theme }) {
  // 5cm 그리드를 그대로 그리면 화면이 선으로 뒤덮인다 — 표시용 최소 간격을 둔다
  const cell = Math.max(gridSize, 0.25);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_HALF * 2, FLOOR_HALF * 2]} />
        <meshStandardMaterial color={theme.floor} roughness={theme.floorRoughness} metalness={0} />
      </mesh>
      {/* 그리드는 **작업 영역 바닥보다 위**에 깐다.
          바닥과 같은 높이에 두면 멀리서 볼 때 둘이 서로를 파고들며 깜빡이고
          (z-fighting), 결국 도면에서 눈금이 사라진다. 눈금은 바닥 위에 그려진
          선이므로 실제로도 이쪽이 맞다. */}
      {show && (
        <Grid
          position={[0, 0.024, 0]}
          args={[FLOOR_HALF * 2, FLOOR_HALF * 2]}
          cellSize={cell}
          cellThickness={0.6}
          cellColor={theme.gridCell}
          sectionSize={MAJOR_GRID}
          sectionThickness={1.1}
          sectionColor={theme.gridSection}
          fadeDistance={400}
          fadeStrength={1}
          followCamera={false}
        />
      )}
      <FootprintOutline
        rect={{ minX: -FLOOR_HALF, maxX: FLOOR_HALF, minZ: -FLOOR_HALF, maxZ: FLOOR_HALF }}
        color={theme.bounds}
        y={0.03}
      />
    </>
  );
}

/* --------------------------------------------------------------------------
 * 카메라 이동 — 인스펙터에서 "이 설비 보여 줘" 를 받는다
 * --------------------------------------------------------------------------
 *  탑뷰는 정사영이라 위치만 옮기면 되고, 3D 는 궤도 조작이라 **바라보는 점**을
 *  옮기고 카메라를 같은 만큼 따라 옮긴다(각도와 거리를 유지해야 화면이 튀지
 *  않는다). 한 번에 끝내지 않고 몇 프레임에 걸쳐 당겨 오면 어디로 갔는지
 *  눈으로 따라갈 수 있다.
 * ------------------------------------------------------------------------ */
function FocusRig() {
  const { camera, controls } = useThree();
  const goal = useRef(null);

  useEffect(() => subscribeFocus((r) => { goal.current = r.at; }), []);

  useFrame(() => {
    const at = goal.current;
    if (!at) return;
    const k = 0.18;
    if (camera.isOrthographicCamera) {
      camera.position.x += (at[0] - camera.position.x) * k;
      camera.position.z += (at[1] - camera.position.z) * k;
      if (Math.hypot(at[0] - camera.position.x, at[1] - camera.position.z) < 0.05) goal.current = null;
      return;
    }
    const t = controls?.target;
    if (!t) { goal.current = null; return; }
    const dx = (at[0] - t.x) * k;
    const dz = (at[1] - t.z) * k;
    t.x += dx;
    t.z += dz;
    camera.position.x += dx;
    camera.position.z += dz;
    controls.update?.();
    if (Math.hypot(at[0] - t.x, at[1] - t.z) < 0.05) goal.current = null;
  });
  return null;
}

/* --------------------------------------------------------------------------
 * 그리는 중인 도형 미리보기
 * --------------------------------------------------------------------------
 *  확정 전에는 store 를 건드리지 않으므로(되돌리기가 지저분해진다) 여기서
 *  받은 값만으로 그린다. 사각형은 채움+외곽선, 펜과 벽은 선으로.
 * ------------------------------------------------------------------------ */
function PolyLine({ points, color, closed = false, y = 0.05 }) {
  const geom = useMemo(() => {
    const pts = (closed ? [...points, points[0]] : points).map((p) => new THREE.Vector3(p[0], y, p[1]));
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [points, closed, y]);
  useEffect(() => () => geom.dispose(), [geom]);
  if (points.length < 2) return null;
  return (
    <line geometry={geom} renderOrder={9}>
      <lineBasicMaterial color={color} transparent opacity={0.95} depthTest={false} />
    </line>
  );
}

function BuildPreview({ tool, isTop, rect, poly, wallFrom, cursor, color }) {
  if (!isTop) return null;

  if (rect) {
    const r = {
      minX: Math.min(rect.start[0], rect.cur[0]),
      maxX: Math.max(rect.start[0], rect.cur[0]),
      minZ: Math.min(rect.start[1], rect.cur[1]),
      maxZ: Math.max(rect.start[1], rect.cur[1]),
    };
    const w = (r.maxX - r.minX).toFixed(1);
    const d = (r.maxZ - r.minZ).toFixed(1);
    return (
      <group>
        <mesh
          position={[(r.minX + r.maxX) / 2, 0.02, (r.minZ + r.maxZ) / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={8}
          raycast={() => null}
        >
          <planeGeometry args={[Math.max(r.maxX - r.minX, 0.01), Math.max(r.maxZ - r.minZ, 0.01)]} />
          <meshBasicMaterial color={color} transparent opacity={0.2} depthWrite={false} depthTest={false} />
        </mesh>
        <FootprintOutline rect={r} color={color} y={0.05} />
        <Html position={[r.maxX, 0.2, r.maxZ]} center style={{ pointerEvents: 'none' }}>
          <span className="rounded bg-panel/90 px-1.5 py-0.5 text-[10px] tabular-nums text-ink ring-1 ring-line">
            {w} × {d} m
          </span>
        </Html>
      </group>
    );
  }

  if (poly?.points.length) {
    return <PolyLine points={[...poly.points, cursor]} color={color} closed={poly.points.length >= 3} />;
  }

  if (tool === TOOL.WALL && wallFrom) {
    return <PolyLine points={[wallFrom, cursor]} color={color} />;
  }
  return null;
}

/* ==========================================================================
 * 씬 본문
 * ======================================================================== */

function SceneContent() {
  const { state, dispatch, itemOf, activeItem } = useEditor();
  const version = useModelsVersion();
  /* 재고가 바뀔 때마다 "가득 찼는가" 를 다시 본다 */
  const stockVersion = useAllStock();
  /* 고장 난 설비 — 250ms 마다만 알려 오므로 이걸로 다시 그려도 부담이 없다 */
  const downMap = useFaults();

  /* 설비마다의 고장 성질 — 없으면 고장 나지 않는다(기본값) */
  const faultParams = useMemo(
    () => placed.map((p) => ({ uid: p.uid, mtbf: p.mtbf ?? 0, mttr: p.mttr ?? FAULT_DEFAULTS.mttr })),
    [placed],
  );
  /* 지운 설비의 고장 기록까지 들고 있을 이유는 없다 */
  useEffect(() => { pruneFaults(new Set(placed.map((p) => p.uid))); }, [placed]);
  const { view, tool, gridSize, placed, links, carts, selected, connectFrom, ghostRot, pathDraft } = state;
  const theme = sceneTheme(state.appearance);

  const [cursor, setCursor] = useState([0, 0]);
  const lastCursor = useRef([0, 0]);
  const drag = useRef(null);
  const pickedRef = useRef(false);

  const isTop = view === VIEW.TOP;

  /* ---- 파생 데이터 ------------------------------------------------------ */
  const specFor = useCallback(
    (itemId) => {
      const it = itemOf(itemId);
      return it?.modelKey ? getSpec(it.modelKey) : null;
    },
    [itemOf],
  );

  /**
   * 풋프린트 계산용 바운딩 박스.
   *  선반은 길이를 사용자가 정하므로 모델 크기가 아니라 칸 수에서 나온다.
   *  모델을 아직 못 읽었어도 절차적 규격으로 자리를 잡아야 배치가 막히지 않는다.
   */
  const boxFor = useCallback(
    (p) => {
      const it = itemOf(p.itemId);
      if (isShelf(it)) return shelfBBox(p, it.modelKey ? getSpec(it.modelKey) : null);
      return specFor(p.itemId)?.bbox ?? null;
    },
    [itemOf, specFor],
  );

  const rectOf = useCallback(
    (p) => {
      const bbox = boxFor(p);
      return bbox ? footprintOf({ ...p, bboxOverride: bbox }, null) : null;
    },
    [boxFor],
  );

  const rects = useMemo(
    () => placed.map((p) => ({ uid: p.uid, rect: rectOf(p) })).filter((r) => r.rect),
    [placed, rectOf, version],
  );

  /* 놓을 수 있는 바닥 — 영역을 합친 다각형. 영역이 없으면 null(= 어디든 가능) */
  const floor = useMemo(() => floorOf(state.areas), [state.areas]);

  /* 드나들 수 있는 문 — 트럭만, 그리고 이 자리로만 밖에 나갈 수 있다 */
  const gates = useMemo(
    () => openingGates(state.openings, wallLines(state.areas, state.walls)),
    [state.openings, state.areas, state.walls],
  );

  /**
   * 지금 골라진 uid 들 (하나만 골랐어도 배열).
   *  여러 개를 묶어 끌 때와 정렬할 때 같은 값을 본다.
   */
  const selEquip = useMemo(() => new Set(selUidsOf(selected, 'equip')), [selected]);
  const selPillar = useMemo(() => new Set(selUidsOf(selected, 'pillar')), [selected]);

  /**
   * 붙여넣기 미리보기.
   * -------------------------------------------------------------------------
   *  커서를 기준점 삼아 복사해 둔 것들을 늘어놓고, 그대로 놓을 수 있는지 미리
   *  판정한다. 판정 기준은 새로 놓을 때와 **똑같다** — 바닥 안, 다른 설비와 겹치지
   *  않기, 벽·기둥을 뚫지 않기. 붙여넣기라고 규칙이 느슨해지면 도면이 어긋난다.
   */
  const paste = useMemo(() => {
    const cb = state.clipboard;
    if (tool !== TOOL.PASTE || !cb?.items?.length || !isTop) return null;

    const at = cursor;
    const items = cb.items.map((it) => {
      const pos = [clean(at[0] + it.dx), clean(at[1] + it.dz)];
      if (cb.kind === 'pillar') {
        const [w, d] = it.size;
        return {
          src: it,
          pos,
          rect: { minX: pos[0] - w / 2, maxX: pos[0] + w / 2, minZ: pos[1] - d / 2, maxZ: pos[1] + d / 2 },
        };
      }
      const bbox = boxFor({ ...it, pos });
      return { src: it, pos, rect: bbox ? footprintOf({ ...it, pos, bboxOverride: bbox }, null) : null };
    });

    const ok = items.every(({ rect }) => {
      if (!rect) return false;
      if (outOfBounds(rect) || !rectInFloor(rect, floor)) return false;
      if (cb.kind === 'pillar') return !obstacleHitsRects(rectMP([rect.minX, rect.minZ], [rect.maxX, rect.maxZ]), rects.map((r) => r.rect));
      if (rects.some((r) => rectsOverlap(rect, r.rect))) return false;
      return !hitsObstacle(rect, { walls: state.walls, pillars: state.pillars });
    });

    return { kind: cb.kind, items, ok };
  }, [tool, isTop, state.clipboard, cursor, boxFor, rects, floor, state.walls, state.pillars]);


  const ports = useMemo(() => allPorts(placed, itemOf), [placed, itemOf, version]);

  /* ---- 비어 있는 설비 포트의 바닥 표시 ----------------------------------
   *  컨베이어가 물리지 않은 포트만 녹색(유입)·주황(유출)으로 깔아 둔다.
   *  카트 경로를 그릴 때 "여기로 지나가면 자재를 주고받는다" 를 알려 주는 표시라,
   *  이미 벨트가 붙어 있는 포트는 카트가 갈 일이 없으므로 뺀다.
   * ---------------------------------------------------------------------- */
  const openPortZones = useMemo(() => {
    const used = new Set();
    for (const l of links) {
      for (const ep of [l.from, l.to]) if (ep?.uid && ep.portId) used.add(`${ep.uid}:${ep.portId}`);
    }
    return ports
      .filter((p) => (p.kind === PORT_KIND.IN || p.kind === PORT_KIND.OUT) && !used.has(p.key))
      .map((p) => ({
        kind: p.kind === PORT_KIND.IN ? 'in' : 'out',
        // 포트 바깥쪽으로 조금 나와 바닥에 깔린다
        center: [p.world[0] + p.dir[0] * PORT_ZONE_OUT, p.world[2] + p.dir[1] * PORT_ZONE_OUT],
        size: p.dir[0] !== 0 ? [PORT_ZONE_DEPTH, PORT_ZONE_WIDTH] : [PORT_ZONE_WIDTH, PORT_ZONE_DEPTH],
      }));
  }, [ports, links]);

  /* ---- 배치된 연결들의 경로 ---------------------------------------------
   *  경로는 매번 다시 계산하지만, "실제로 달라진 연결" 만 다시 만든다.
   *  설비 하나를 끌면 links·placed 배열이 통째로 바뀌는데, 그때마다 모든
   *  컨베이어의 지오메트리(수만 정점)를 다시 굽으면 드래그가 끊긴다.
   *
   *  (연결 미리보기가 "몇 층에 놓일지" 판정할 때 이 목록을 쓰므로
   *   미리보기보다 먼저 계산해야 한다)
   * ---------------------------------------------------------------------- */
  const pathCache = useRef(new Map());
  const linkPaths = useMemo(() => {
    const endSig = (ep) => {
      if (!ep) return '-';
      if (ep.point) return `p${ep.point}|${ep.y ?? 0}|${ep.dir ?? ''}`;
      if (ep.link) return `b${ep.link}@${ep.t}`;
      const p = placed.find((x) => x.uid === ep.uid);
      if (!p) return `${ep.uid}:gone`;
      const at = `${p.pos[0]},${p.pos[1]},${p.rot},${p.y ?? 0}`;
      return ep.anchor ? `a${ep.uid}:${ep.local}|${ep.y}@${at}` : `${ep.uid}:${ep.portId}@${at}`;
    };

    const ctx = { links };
    const next = new Map();
    const out = [];
    for (const l of links) {
      const sig = [
        l.itemId, l.radius, l.layer ?? 0, l.widthScale ?? 1,
        (l.waypoints ?? []).join(';'),
        endSig(l.from), endSig(l.to), version,
      ].join('|');
      const hit = pathCache.current.get(l.uid);
      const path = hit && hit.sig === sig ? hit.path : linkPath(l, placed, itemOf, ctx);
      if (!path) continue;
      next.set(l.uid, { sig, path });
      out.push({ link: l, path });
    }
    pathCache.current = next;
    return out;
  }, [links, placed, itemOf, version]);

  /* ---- 벨트 위 반송물 ----------------------------------------------------
   *  연결은 언제나 "유출 → 유입" 으로 저장되므로, 시작 끝점에 물린 설비가
   *  곧 내보내는 설비다. 간격과 층수는 그 설비의 설정을 따른다.
   *  (배관·전선과 자유 끝점에서 시작한 연결은 흘려보낼 자재가 없다)
   * ---------------------------------------------------------------------- */
  const beltFlows = useMemo(
    () =>
      linkPaths
        .map(({ link, path }) => {
          const item = itemOf(link.itemId);
          if (!item || item.utility || item.render === 'tube') return null;
          const ep = link.from;
          if (!ep?.uid || ep.anchor || ep.link) return null;
          const owner = placed.find((x) => x.uid === ep.uid);
          if (!owner) return null;
          /* 이 벨트가 어디로 들어가는가 — 종점이 스틸리지면 자재가 거기 쌓인다 */
          const dest = link.to?.uid ? placed.find((x) => x.uid === link.to.uid) : null;
          const sink = dest && isStillage(itemOf(dest.itemId)) ? dest : null;
          return { link, path, owner, sink };
        })
        .filter(Boolean),
    [linkPaths, itemOf, placed],
  );

  /**
   * 가득 찬 스틸리지 때문에 멈춘 것들.
   * -------------------------------------------------------------------------
   *  라인이 서는 이유는 하나뿐이다 — 종점이 다 찼다. 그 사실을 벨트에도(멈춤),
   *  그 벨트를 먹이던 설비에도(정지 표시) 알려야 도면만 보고 원인을 짚을 수 있다.
   *  재고는 도면이 아니라 시뮬레이션 값이라 simStore 에서 읽는다.
   */
  const halted = useMemo(() => {
    const links = new Set();
    const equips = new Set();

    /**
     * ⓪ 고장 난 설비.
     * -----------------------------------------------------------------------
     *  서는 이유가 하나 더 생겼다. 막힘은 배치를 고쳐 풀 수 있지만 고장은 설비
     *  자체의 성질이라, 지표에서는 갈라 센다(SimClock). 다만 **화면에서 벌어지는
     *  일은 같다** — 그 설비가 서고, 내보내던 벨트도 선다. 그래서 여기서는 같은
     *  목록에 넣고, 아래의 상류 전파도 그대로 태운다.
     */
    for (const uid of Object.keys(downMap)) equips.add(uid);
    for (const f of beltFlows) if (downMap[f.owner.uid]) links.add(f.link.uid);

    /* ① 가득 찬 적치대로 들어가는 벨트와, 그 벨트를 먹이던 설비 */
    for (const f of beltFlows) {
      if (!f.sink) continue;
      if (getStock(f.sink.uid) < stillageCapacity(f.sink)) continue;
      links.add(f.link.uid);
      equips.add(f.owner.uid);
    }

    /**
     * ② 상류로 거슬러 올라간다.
     * -----------------------------------------------------------------------
     *  멈춘 설비는 더 이상 받지 못한다. 그러면 **그 설비로 들어가던 벨트**도 설
     *  자리가 없고, 그 벨트를 먹이던 앞 설비도 함께 선다. 실제 라인에서 적치대
     *  하나가 차면 그 앞 공정이 줄줄이 서는 것과 같다.
     *
     *  바로 앞 한 대만 세우면 그 뒤 설비들이 계속 자재를 밀어 넣어, 갈 곳 없는
     *  물건이 벨트 위에 계속 흐르는 그림이 된다.
     *
     *  더 붙일 것이 없을 때까지 되풀이한다. 한 번 돌 때마다 최소 한 개의 벨트가
     *  목록에 들어가므로 벨트 수만큼이면 반드시 끝난다(고리로 이어져 있어도).
     */
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of beltFlows) {
        if (links.has(f.link.uid)) continue;
        const dest = f.link.to?.uid;
        if (!dest || !equips.has(dest)) continue;
        links.add(f.link.uid);
        equips.add(f.owner.uid);
        grew = true;
      }
    }
    return { links, equips };
  }, [beltFlows, stockVersion, downMap]);

  /* ---- 카트 경로 + 정차역 ------------------------------------------------ */
  const cartPaths = useMemo(
    () =>
      carts
        .map((c) => {
          const path = cartPath(c);
          /* 트럭은 싣기만 한다 — 방향이 처음부터 정해진 차량이다.
             선반에서 싣을지 내릴지는 카트가 역마다 정해 둔 값을 따른다. */
          const opt = { loadOnly: isTruck(itemOf(c.itemId)), roles: c.roles };
          return path ? { cart: c, path, stations: cartStations(path, placed, itemOf, opt) } : null;
        })
        .filter(Boolean),
    [carts, placed, itemOf, version],
  );

  /* ---- 고스트(배치 미리보기) -------------------------------------------
   *  주의: 이 계산은 "마우스 좌표 → 확정 배치 위치" 그 자체다. 미리보기와
   *  실제 배치가 반드시 같은 결과를 내야 하므로 순수 함수로 빼서 둘 다 이걸
   *  쓴다. 렌더용으로 memo 한 값을 클릭 시점에 재사용하면, 이동 이벤트로 인한
   *  리렌더가 아직 반영되지 않은 순간(빠른 클릭·터치)에 한 프레임 전 위치에
   *  놓이는 어긋남이 생긴다.
   * ---------------------------------------------------------------------- */
  const computeGhost = useCallback(
    (raw, rot) => {
      if (!activeItem) return null;
      const g = gridSize;
      let pos = [clean(snap(raw[0], g)), clean(snap(raw[1], g))];
      const draft = {
        uid: '__ghost',
        itemId: activeItem.id,
        pos,
        rot,
        y: 0,
        ...(isShelf(activeItem) ? { bays: state.shelfBays } : {}),
      };
      const bbox = boxFor(draft);
      let valid = true;

      if (bbox) {
        let rect = footprintOf({ ...draft, bboxOverride: bbox }, null);
        if (state.snapEdge) {
          const [dx, dz] = edgeSnap(rect, rects.map((r) => r.rect));
          if (dx || dz) {
            pos = [clean(pos[0] + dx), clean(pos[1] + dz)];
            draft.pos = pos;
            rect = footprintOf({ ...draft, bboxOverride: bbox }, null);
          }
        }
        valid =
          !outOfBounds(rect) &&
          !rects.some((r) => rectsOverlap(rect, r.rect)) &&
          /* 작업 영역을 그렸다면 그 바닥 위에만 놓을 수 있다 */
          rectInFloor(rect, floor) &&
          /* 내벽·기둥이 서 있는 자리에는 못 놓는다 */
          !hitsObstacle(rect, { walls: state.walls, pillars: state.pillars });
      }
      return { placed: draft, valid };
    },
    [activeItem, gridSize, rects, state.snapEdge, state.shelfBays, boxFor, floor, state.walls, state.pillars],
  );

  const ghost = useMemo(
    () => (tool === TOOL.PLACE && isTop ? computeGhost(cursor, ghostRot) : null),
    [tool, isTop, computeGhost, cursor, ghostRot, version],
  );

  /* ---- 배관·전선의 끝점 결정 --------------------------------------------
   *  자재 포트를 쓰지 않는다. 컨베이어와 같은 자리에서 시작하면 배관이
   *  벨트 높이에 걸려 버리기 때문이다. 대신 세 가지 중 하나로 붙는다.
   *
   *    ① 같은 종류의 기존 배관 위  → 분기점(T·+). 그 배관을 따라 움직인다.
   *    ② 설비 위/근처            → 설비에 붙는 접점. 설비를 옮기면 따라간다.
   *    ③ 그 외                   → 바닥의 자유 끝
   *
   *  높이는 품목이 정한 값(전선 4m 상부 · 배관 0.35m 바닥)을 쓴다.
   * ---------------------------------------------------------------------- */
  const utilityEndpoint = useCallback(
    (cur) => {
      const h = activeItem?.height ?? 1;

      // ① 같은 품목의 기존 배관에 분기
      let best = null;
      for (const { link, path } of linkPaths) {
        if (link.itemId !== activeItem.id || link.uid === connectFrom?.hostUid) continue;
        const L = path.length;
        const n = Math.max(2, Math.ceil(L / 0.3));
        for (let i = 0; i <= n; i++) {
          const s = (i / n) * L;
          const q = path.at(s).pos;
          const d = Math.hypot(q[0] - cur[0], q[2] - cur[1]);
          if (d < BRANCH_SNAP_DIST && (!best || d < best.d)) best = { d, s, L, q, uid: link.uid };
        }
      }
      if (best) {
        return {
          key: `branch:${best.uid}@${best.s.toFixed(2)}`,
          world: best.q,
          dir: [1, 0],
          hostUid: best.uid,
          ref: { link: best.uid, t: best.L > 1e-6 ? best.s / best.L : 0, dir: [1, 0] },
        };
      }

      // ② 설비에 붙이기 (풋프린트에서 조금 여유를 둔 범위)
      for (const r of rects) {
        const m = ANCHOR_MARGIN;
        if (cur[0] < r.rect.minX - m || cur[0] > r.rect.maxX + m) continue;
        if (cur[1] < r.rect.minZ - m || cur[1] > r.rect.maxZ + m) continue;
        const owner = placed.find((x) => x.uid === r.uid);
        if (!owner) continue;
        const local = rotateXZ([cur[0] - owner.pos[0], cur[1] - owner.pos[1]], (4 - owner.rot) % 4);
        return {
          key: `anchor:${owner.uid}`,
          world: [cur[0], (owner.y ?? 0) + h, cur[1]],
          dir: [1, 0],
          ref: { uid: owner.uid, anchor: true, local: [clean(local[0]), clean(local[1])], y: h, dir: [1, 0] },
        };
      }

      // ③ 자유 끝
      return {
        key: `free:${cur[0]},${cur[1]}`,
        world: [cur[0], h, cur[1]],
        dir: [1, 0],
        ref: { point: cur, y: h, dir: [1, 0] },
      };
    },
    [activeItem, linkPaths, rects, placed, connectFrom],
  );

  /* ---- 연결 미리보기 ----------------------------------------------------
   *  출발 포트를 정한 뒤에는 이을 수 없는 포트(유입↔유입 · 유출↔유출)를
   *  스냅 후보에서 아예 뺀다. 붙었다가 클릭하면 거절당하는 것보다,
   *  애초에 달라붙지 않는 편이 손에 훨씬 명확하다.
   * ---------------------------------------------------------------------- */
  const acceptPort = useCallback(
    (p) => !connectFrom || portsCompatible(connectFrom, p),
    [connectFrom],
  );

  const hoverPort = useMemo(
    () => (tool === TOOL.CONNECT ? nearestPort(ports, cursor, PORT_SNAP_DIST, connectFrom?.key, acceptPort) : null),
    [tool, ports, cursor, connectFrom, acceptPort],
  );

  const preview = useMemo(() => {
    if (tool !== TOOL.CONNECT || !connectFrom || !activeItem) return null;

    /* 배관·전선은 층을 쌓지 않으므로 경로만 그려 보여 준다 */
    if (isUtility(activeItem)) {
      const end = utilityEndpoint(cursor);
      const away = quantizeDir([cursor[0] - connectFrom.world[0], cursor[1] - connectFrom.world[2]]);
      return {
        path: buildConnectorPath(
          { ...connectFrom, dir: away },
          { ...end, dir: [-away[0], -away[1]] },
          { radius: state.cornerRadius },
        ),
        layer: 0,
        snapped: !end.key.startsWith('free'),
      };
    }

    const to = hoverPort ?? {
      world: [cursor[0], connectFrom.world[1], cursor[1]],
      dir: quantizeDir([connectFrom.world[0] - cursor[0], connectFrom.world[2] - cursor[1]]),
    };
    // 어느 층에 놓일지 미리 보여 준다 — 놓고 나서 "왜 떠 있지?" 가 되지 않도록
    const flat = buildConnectorPath(connectFrom, to, { radius: state.cornerRadius });
    const spec = activeItem.modelKey ? getSpec(activeItem.modelKey) : null;
    const clearance = Math.max(0.6, (spec?.connector?.nativeWidth ?? 1) * 0.6);
    const layer = autoLayer(flat, linkPaths, clearance);
    return {
      path: layer
        ? buildConnectorPath(connectFrom, to, { radius: state.cornerRadius, lift: layerLift(layer) })
        : flat,
      layer,
      snapped: !!hoverPort,
    };
  }, [tool, connectFrom, hoverPort, cursor, activeItem, state.cornerRadius, linkPaths, utilityEndpoint]);

  /* ---- 카트 경로 미리보기 ----------------------------------------------- */
  const draftPath = useMemo(() => {
    if (tool !== TOOL.PATH || !pathDraft?.points.length) return null;
    return buildFreePath([...pathDraft.points, cursor], { closed: false, radius: 1.2, y: 0 });
  }, [tool, pathDraft, cursor]);

  const draftLineGeom = useMemo(() => {
    if (!draftPath) return null;
    const pts = draftPath.points3(0.05).map((p) => new THREE.Vector3(...p));
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [draftPath]);
  useEffect(() => () => draftLineGeom?.dispose(), [draftLineGeom]);

  /* ---- 꼭짓점 편집 ------------------------------------------------------
   *  영역·구역의 모양을 그린 뒤에 고치는 길. 계산은 전부 area.js 에 있고,
   *  여기서는 "그 자리로 가도 되는가" 만 판정한다.
   * ---------------------------------------------------------------------- */
  const shapeOf = useCallback(
    (kind, uid) => (kind === 'zone' ? state.zones : state.areas).find((x) => x.uid === uid) ?? null,
    [state.zones, state.areas],
  );

  /**
   * 바닥을 줄여 그 위의 설비·기둥을 밖으로 내보내는 편집인가.
   * -------------------------------------------------------------------------
   *  설비를 끌 때 "작업 영역 밖으로는 못 나간다" 를 걸어 두었다. 그렇다면 반대
   *  방향도 막혀야 한다 — 설비는 가만히 있는데 바닥이 물러나면 결과는 같다.
   *
   *  전부 다시 재면 프레임마다 다각형 연산이 설비 수만큼 돈다. 다행히 꼭짓점
   *  하나를 옮길 때 안팎이 바뀌는 자리는 **(앞점 · 뒷점 · 옮기기 전후의 점)**
   *  네 점이 만드는 상자 안뿐이다. 그 밖은 이 편집으로 바뀌지 않으므로 건너뛴다.
   *
   *  단, 꼭짓점을 멀리 있는 변 **너머로** 끌어 도형이 스스로 접히면 그 상자
   *  밖에서도 안팎이 뒤집힐 수 있다. 접힌 도형은 손을 뗄 때 정리되는 임시
   *  상태라 여기서는 쫓지 않는다 — 그 한 경우에 설비가 바닥 밖에 남을 수 있다.
   */
  const vertexMoveOk = useCallback(
    (area, nextMP, addr, pt) => {
      const nb = vertexNeighbors(area.mp, addr);
      if (!nb) return false;
      const nextFloor = floorOf(state.areas.map((a) => (a.uid === area.uid ? { ...a, mp: nextMP } : a)));
      if (!nextFloor) return false;

      const xs = [nb.at[0], nb.prev[0], nb.next[0], pt[0]];
      const zs = [nb.at[1], nb.prev[1], nb.next[1], pt[1]];
      const touched = {
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minZ: Math.min(...zs), maxZ: Math.max(...zs),
      };

      for (const r of rects) {
        if (rectsOverlap(r.rect, touched) && !rectInFloor(r.rect, nextFloor)) return false;
      }
      for (const pl of state.pillars) {
        const [w, d] = pl.size;
        const rect = {
          minX: pl.pos[0] - w / 2, maxX: pl.pos[0] + w / 2,
          minZ: pl.pos[1] - d / 2, maxZ: pl.pos[1] + d / 2,
        };
        if (rectsOverlap(rect, touched) && !rectInFloor(rect, nextFloor)) return false;
      }
      return true;
    },
    [state.areas, state.pillars, rects],
  );

  /* ---- 포인터 ----------------------------------------------------------- */
  const onMove = useCallback(
    (p) => {
      const g = gridSize;
      const snapped = [clean(snap(p[0], g)), clean(snap(p[1], g))];
      if (lastCursor.current[0] !== snapped[0] || lastCursor.current[1] !== snapped[1]) {
        lastCursor.current = snapped;
        publishCursor(snapped);
        setCursor(snapped);
      }

      // 영역·구역을 사각형으로 끄는 중
      if (rectStart.current) {
        setRectDraft({ start: rectStart.current, cur: snapped });
        return;
      }

      /* 마키 — 무언가를 집은 채였다면 그건 "옮기기" 지 "고르기" 가 아니다 */
      if (marqueeStart.current) {
        if (pickedRef.current) marqueeStart.current = null;
        else {
          setMarquee({ start: marqueeStart.current.at, cur: snapped });
          return;
        }
      }

      // 드래그 이동
      const d = drag.current;
      if (!d || !isTop) return;

      if (d.kind === 'waypoint') {
        const link = links.find((l) => l.uid === d.uid);
        if (!link) return;
        const wp = [...(link.waypoints ?? [])];
        wp[d.index] = snapped;
        dispatch({ type: 'UPDATE_LINK', uid: d.uid, patch: { waypoints: wp } });
        return;
      }

      /* 내벽 끝점 옮기기.
         놓을 때와 똑같은 규칙(다른 벽 끝·영역 경계로 스냅)을 그대로 쓴다 —
         그려 놓고 옮겼더니 벽이 떨어지는 일이 없어야 한다. 자기 자신은 스냅
         후보에서 뺀다(자기 끝점에 달라붙어 길이가 0 이 된다). */
      if (d.kind === 'wallpoint') {
        const w = state.walls.find((x) => x.uid === d.uid);
        if (!w) return;
        const at = snapWallPoint(snapped, {
          walls: state.walls.filter((x) => x.uid !== d.uid),
          areas: state.areas,
        });
        const other = d.index === 0 ? w.b : w.a;
        if (Math.hypot(at[0] - other[0], at[1] - other[1]) < MIN_AREA_SIDE) return;

        const next = d.index === 0 ? { a: at } : { b: at };
        // 설비를 뚫고 지나가는 자리로는 못 끈다
        if (obstacleHitsRects(wallFootprint({ ...w, ...next }), rects.map((r) => r.rect))) return;
        dispatch({ type: 'UPDATE_WALL', uid: d.uid, patch: next });
        return;
      }

      /* 영역·구역의 꼭짓점 옮기기.
         모양이 성립하는지는 area.js 가(옆 점과 겹치지 않는가), 놓을 수 있는지는
         여기서 본다. 어느 한쪽이라도 아니라고 하면 그 프레임을 버린다 —
         커서만 앞서 나가고 도형은 마지막으로 성립한 자리에 남는다. */
      if (d.kind === 'vertex') {
        const shape = shapeOf(d.shape, d.uid);
        if (!shape) return;
        const mp = moveVertex(shape.mp, d.addr, snapped);
        if (!mp) return;
        if (d.shape === 'zone') {
          /* 구역은 바닥 위에만 있을 수 있다. 밖으로 끌면 손을 뗄 때 잘려 나가므로
             애초에 못 나가게 막는다 — 잘린 결과를 보고 놀라는 것보다 낫다. */
          if (floor && !pointInMP(floor, snapped)) return;
        } else if (!vertexMoveOk(shape, mp, d.addr, snapped)) return;
        dispatch({ type: 'SHAPE_VERTEX', op: 'move', kind: d.shape, uid: d.uid, addr: d.addr, pt: snapped });
        return;
      }

      /* 개구부 — 붙어 있는 벽 위로만 미끄러진다 (양 끝은 폭의 절반만큼 물림) */
      if (d.kind === 'opening') {
        const o = state.openings.find((x) => x.uid === d.uid);
        if (!o) return;
        const at = slideOpening(d.line, o, snapped);
        if (at) dispatch({ type: 'UPDATE_OPENING', uid: d.uid, patch: { at } });
        return;
      }

      if (d.kind === 'cartpoint') {
        const cart = carts.find((c) => c.uid === d.uid);
        if (!cart) return;
        const pts = [...cart.points];
        pts[d.index] = snapped;

        /* 그려 놓은 경로를 고칠 때도 그릴 때와 같은 규칙을 건다.
           여기를 빼먹어서, 그리기는 막히는데 나중에 경유점을 끌면 벽을 뚫고
           나가는 상태가 됐다. 옮긴 점에 붙은 **두 구간**만 다시 보면 된다. */
        if (floor) {
          const truck = isTruck(itemOf(cart.itemId));
          const ok = (a, b) => !crossesWall(a, b, floor, truck ? gates : []);
          if (!truck && !pointInMP(floor, snapped)) return;
          const last = pts.length - 1;
          const prev = d.index > 0 ? pts[d.index - 1] : cart.closed ? pts[last] : null;
          const next = d.index < last ? pts[d.index + 1] : cart.closed ? pts[0] : null;
          if (prev && !ok(prev, snapped)) return;
          if (next && !ok(snapped, next)) return;
        }

        dispatch({ type: 'UPDATE_CART', uid: d.uid, patch: { points: pts } });
        return;
      }

      /* ---- 기둥 옮기기 --------------------------------------------------
       *  기둥은 모델이 없으니 크기가 곧 설정값이다. 설비가 선 자리로는 못
       *  들어가고, 바닥 밖으로도 못 나간다 — 세울 때의 규칙과 같아야 한다. */
      if (d.kind === 'pillar') {
        const anchor = [clean(snap(p[0] + d.off[0], g)), clean(snap(p[1] + d.off[1], g))];
        const from = d.group.find((x) => x.uid === d.uid).base;
        const dx = anchor[0] - from[0];
        const dz = anchor[1] - from[1];
        const moves = d.group.map((x) => ({ uid: x.uid, pos: [clean(x.base[0] + dx), clean(x.base[1] + dz)] }));

        /* 묶음은 전부 놓일 수 있을 때만 움직인다. 하나만 걸려도 무르는 편이,
           일부만 따라오다 대열이 흐트러지는 것보다 낫다. */
        for (const m of moves) {
          const pl = state.pillars.find((x) => x.uid === m.uid);
          if (!pl) continue;
          const mp = pillarFootprint({ ...pl, pos: m.pos });
          if (obstacleHitsRects(mp, rects.map((r) => r.rect))) return;
          const [w, h] = pl.size;
          const rect = { minX: m.pos[0] - w / 2, maxX: m.pos[0] + w / 2, minZ: m.pos[1] - h / 2, maxZ: m.pos[1] + h / 2 };
          if (!rectInFloor(rect, floor)) return;
        }
        dispatch({ type: 'MOVE_MANY', kind: 'pillar', moves });
        return;
      }

      /* ---- 설비 옮기기 -------------------------------------------------- */
      let pos = [clean(snap(p[0] + d.off[0], g)), clean(snap(p[1] + d.off[1], g))];
      const group = d.group ?? [{ uid: d.uid, base: [pos[0], pos[1]] }];
      const single = group.length === 1;

      /* 면 맞춤은 한 대를 옮길 때만 쓴다. 묶음에 걸면 각자 다른 이웃에
         끌려가 대열이 어긋난다 — 정렬해 둔 것을 옮겼더니 흐트러지는 셈이다. */
      const spec = specFor(d.itemId);
      if (single && spec && state.snapEdge) {
        const rect = footprintOf({ pos, rot: d.rot }, spec);
        const others = rects.filter((r) => r.uid !== d.uid).map((r) => r.rect);
        const [dx, dz] = edgeSnap(rect, others);
        if (dx || dz) pos = [clean(pos[0] + dx), clean(pos[1] + dz)];
      }

      const from = group.find((x) => x.uid === d.uid)?.base ?? pos;
      const dX = pos[0] - from[0];
      const dZ = pos[1] - from[1];
      const moves = group.map((x) =>
        x.uid === d.uid ? { uid: x.uid, pos } : { uid: x.uid, pos: [clean(x.base[0] + dX), clean(x.base[1] + dZ)] },
      );

      /* 작업 영역 밖으로는 끌어 낼 수 없다.
         "나갔다가 돌아오면 된다" 로 두면 벽 밖에 설비가 놓인 채로 손을 떼는
         사고가 나므로, 아예 그 프레임의 이동을 버린다 — 커서만 밖으로 나가고
         설비는 경계에 붙어 남는다. */
      for (const m of moves) {
        const self = placed.find((x) => x.uid === m.uid);
        const bbox = self ? boxFor(self) : null;    // 선반은 칸 수가 크기를 정한다
        if (!bbox) continue;
        const rect = footprintOf({ pos: m.pos, rot: self.rot, bboxOverride: bbox }, null);
        if (!rectInFloor(rect, floor)) return;
        if (hitsObstacle(rect, { walls: state.walls, pillars: state.pillars })) return;
      }

      if (single) dispatch({ type: 'MOVE', uid: d.uid, pos });
      else dispatch({ type: 'MOVE_MANY', kind: 'equip', moves });
    },
    [gridSize, isTop, dispatch, rects, specFor, state.snapEdge, links, carts, placed, boxFor, floor,
     state.walls, state.pillars, state.areas, state.openings, gates, itemOf, shapeOf, vertexMoveOk],
  );

  /* ---- 작업 영역: 사각형 끌어 그리기 -------------------------------------
   *  누른 자리가 한 모서리, 뗀 자리가 반대 모서리다. 미리보기는 로컬 상태로만
   *  들고 있다가 손을 뗄 때 한 번만 store 로 넘긴다 — 끌고 다니는 동안 히스토리를
   *  더럽히지 않고, 너무 작게 끈 경우(실수로 클릭)를 마지막에 걸러 낼 수 있다.
   * ---------------------------------------------------------------------- */
  const rectStart = useRef(null);
  const [rectDraft, setRectDraft] = useState(null);

  /* 빈 바닥을 끌어 여러 개 고르기(마키).
     누르는 시점에는 r3f 픽킹 결과가 아직 안 나와서 "빈 바닥인지" 를 알 수 없다.
     그래서 일단 시작해 두고, 첫 이동에서 무언가를 집었다면 그때 취소한다. */
  const marqueeStart = useRef(null);
  const [marquee, setMarquee] = useState(null);

  const onDownGround = useCallback(
    (p) => {
      if (!isTop) return;
      const s = [clean(snap(p[0], gridSize)), clean(snap(p[1], gridSize))];

      if (tool === TOOL.SELECT) {
        /* 편집 중에는 빈 바닥을 끌어도 마키로 고르지 않는다 — 꼭짓점을 겨냥하다
           살짝 빗나간 드래그가 곧바로 "다른 것을 골랐다" 가 되어 편집이 끝난다 */
        if (!state.editShape) marqueeStart.current = { at: s, ctrl: false };
        return;
      }
      if (tool !== TOOL.AREA && tool !== TOOL.ZONE) return;
      if (state.drawShape !== SHAPE.RECT) return;
      rectStart.current = s;
      setRectDraft({ start: s, cur: s });
    },
    [isTop, tool, state.drawShape, gridSize, state.editShape],
  );

  const onUp = useCallback((e) => {
    const dropped = drag.current;
    drag.current = null;

    /* 꼭짓점을 놓았다 — 여기서 한 번만 도형을 정리한다(접힌 고리 풀기 ·
       구역 다시 자르기). 끄는 중에 하면 잡고 있던 점의 순서가 바뀐다. */
    if (dropped?.kind === 'vertex') {
      dispatch({ type: 'SHAPE_COMMIT', kind: dropped.shape, uid: dropped.uid });
    }

    /* ---- 마키로 고르기 --------------------------------------------------
     *  사각형 안의 것을 **종류를 가리지 않고** 잡는다. 다만 바닥(영역)과 구역은
     *  뺀다 — 둘은 화면을 통째로 덮는 배경이라, 무엇을 끌든 항상 걸려서
     *  "전부 선택" 이 되어 버린다. 그 둘은 직접 클릭해서 고른다.
     *  Ctrl 을 누른 채 끌면 지금 고른 것에 더한다. */
    const m = marqueeStart.current;
    marqueeStart.current = null;
    const box = marquee;
    setMarquee(null);
    if (m && box) {
      const r = {
        minX: Math.min(box.start[0], box.cur[0]),
        maxX: Math.max(box.start[0], box.cur[0]),
        minZ: Math.min(box.start[1], box.cur[1]),
        maxZ: Math.max(box.start[1], box.cur[1]),
      };
      const inRect = ([x, z]) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
      const hits = [];

      for (const x of rects) if (rectsOverlap(r, x.rect)) hits.push({ kind: 'equip', uid: x.uid });

      for (const pl of state.pillars) {
        const [w, h] = pl.size;
        const box2 = {
          minX: pl.pos[0] - w / 2, maxX: pl.pos[0] + w / 2,
          minZ: pl.pos[1] - h / 2, maxZ: pl.pos[1] + h / 2,
        };
        if (rectsOverlap(r, box2)) hits.push({ kind: 'pillar', uid: pl.uid });
      }

      /* 벽은 기울어질 수 있으므로 실제 네모(다각형)로 잰다 */
      for (const w of state.walls) {
        if (obstacleHitsRects(wallFootprint(w), [r])) hits.push({ kind: 'wall', uid: w.uid });
      }
      for (const ar of state.areas) {
        for (const e2 of mpEdges(ar.mp)) {
          const spec = edgeSpec(ar, e2.key);
          if (obstacleHitsRects(wallFootprint({ a: e2.a, b: e2.b, thickness: spec.thickness }), [r])) {
            hits.push({ kind: 'area', uid: ar.uid, edge: e2.key });
          }
        }
      }

      for (const o of state.openings) if (inRect(o.at)) hits.push({ kind: 'opening', uid: o.uid });
      for (const c of carts) if (c.points.some(inRect)) hits.push({ kind: 'cart', uid: c.uid });
      for (const { link, path } of linkPaths) {
        if (path.points3(0).some((p) => inRect([p[0], p[2]]))) hits.push({ kind: 'link', uid: link.uid });
      }

      const add = e?.ctrlKey || e?.metaKey;
      if (!hits.length) {
        if (!add) dispatch({ type: 'SELECT', selected: null });
      } else {
        const prev = add ? selItems(selected) : [];
        const seen = new Set();
        const merged = [...prev, ...hits].filter((i) => {
          const k = `${i.kind}|${i.uid}|${i.edge ?? ''}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        dispatch({ type: 'SELECT_MANY', items: merged });
      }
      return;
    }

    const s = rectStart.current;
    const d = rectDraft;
    rectStart.current = null;
    setRectDraft(null);
    if (!s || !d) return;
    if (Math.abs(d.cur[0] - s[0]) < MIN_AREA_SIDE || Math.abs(d.cur[1] - s[1]) < MIN_AREA_SIDE) return;

    const mp = rectMP(s, d.cur);
    dispatch({ type: tool === TOOL.ZONE ? 'ADD_ZONE' : 'ADD_AREA', mp });
  }, [rectDraft, tool, dispatch, marquee, rects, selected,
      state.pillars, state.walls, state.areas, state.openings, carts, linkPaths]);

  /** 펜으로 찍던 점들을 도형으로 확정한다. 도구는 그대로 두어 연속으로 그린다. */
  const finishPoly = useCallback(
    (points) => {
      const mp = penMP(points);
      dispatch({ type: 'POLY_CANCEL' });
      if (!mp) return;
      dispatch({ type: state.polyDraft?.kind === 'zone' ? 'ADD_ZONE' : 'ADD_AREA', mp });
    },
    [dispatch, state.polyDraft],
  );

  const onClick = useCallback(
    (p) => {
      if (pickedRef.current) return; // 설비/연결을 집은 클릭이면 여기선 아무것도 안 한다

      /* ---- 작업 영역 도구 ---------------------------------------------- */
      if (isBuildTool(tool) && isTop) {
        const cur = [clean(snap(p[0], gridSize)), clean(snap(p[1], gridSize))];

        /* 벽·기둥도 설비와 자리를 다툰다. 이미 설비가 선 자리에 세우면 서로를
           뚫고 지나가는 그림이 되므로 여기서 막고 이유를 알려 준다. */
        const blocked = (mp) => {
          if (!obstacleHitsRects(mp, rects.map((r) => r.rect))) return false;
          dispatch({ type: 'SET', patch: { hint: '설비가 있는 자리에는 세울 수 없습니다' } });
          return true;
        };

        if (tool === TOOL.OPENING) {
          const hit = snapToWall(cur, { areas: state.areas, walls: state.walls });
          if (!hit) {
            dispatch({ type: 'SET', patch: { hint: '벽 위를 클릭하세요 — 개구부는 벽에만 뚫을 수 있습니다' } });
            return;
          }
          dispatch({ type: 'ADD_OPENING', at: hit.at });
          return;
        }

        if (tool === TOOL.PILLAR) {
          const b = state.build;
          if (blocked(pillarFootprint({ pos: cur, size: [b.pillarW, b.pillarD] }))) return;
          dispatch({ type: 'ADD_PILLAR', pos: cur });
          return;
        }

        if (tool === TOOL.WALL) {
          /* 끝점은 근처의 다른 벽 끝·영역 꼭짓점으로 당겨 붙인다. 몇 cm 틈이
             남으면 벽이 이어져 보이지 않아 도면으로서 틀린 그림이 된다. */
          const at = snapWallPoint(cur, { walls: state.walls, areas: state.areas });
          if (!state.wallDraft) dispatch({ type: 'WALL_START', point: at });
          else if (Math.hypot(at[0] - state.wallDraft[0], at[1] - state.wallDraft[1]) >= MIN_AREA_SIDE) {
            const w = { a: state.wallDraft, b: at, thickness: state.build.wallThickness };
            if (blocked(wallFootprint(w))) return;
            dispatch({ type: 'ADD_WALL', a: state.wallDraft, b: at });
          }
          return;
        }

        // 영역·구역을 펜으로 그리는 중 (사각형 모드는 드래그가 처리한다)
        if (state.drawShape !== SHAPE.PEN) return;
        const pts = state.polyDraft?.points ?? [];
        if (!state.polyDraft) {
          dispatch({ type: 'POLY_START', kind: tool === TOOL.ZONE ? 'zone' : 'area' });
          dispatch({ type: 'POLY_ADD_POINT', point: cur });
          return;
        }
        // 첫 점을 다시 누르면 도형을 닫는다 — 카트 경로와 같은 손놀림
        if (pts.length >= 3 && Math.hypot(pts[0][0] - cur[0], pts[0][1] - cur[1]) < CLOSE_DIST) {
          finishPoly(pts);
          return;
        }
        dispatch({ type: 'POLY_ADD_POINT', point: cur });
        return;
      }

      /* ---- 붙여넣기 -----------------------------------------------------
       *  손에 든 것들을 커서 자리에 내려놓는다. 하나라도 놓일 수 없으면
       *  전부 놓지 않는다 — 일부만 붙으면 복사한 배치가 깨지고, 무엇이
       *  빠졌는지 알아채기도 어렵다. */
      if (tool === TOOL.PASTE && isTop) {
        if (!paste?.ok) {
          dispatch({ type: 'SET', patch: { hint: '여기에는 놓을 수 없습니다' } });
          return;
        }
        dispatch({ type: 'PASTE_AT', pos: [clean(snap(p[0], gridSize)), clean(snap(p[1], gridSize))] });
        return;
      }

      if (tool === TOOL.PLACE && isTop) {
        /* 놓을 바닥이 아예 없으면 왜 안 되는지 알려 준다 — 고스트가 계속
           빨갛기만 하면 모델이 잘못된 줄 안다 */
        if (!floor) {
          dispatch({ type: 'SET', patch: { hint: '먼저 작업영역 탭에서 영역(바닥)을 그려 주세요' } });
          return;
        }
        // 클릭 시점의 좌표로 다시 계산한다 (미리보기와 완전히 동일한 결과)
        const g = computeGhost(p, ghostRot);
        if (!g?.valid) return;
        dispatch({
          type: 'PLACE',
          itemId: activeItem.id,
          pos: g.placed.pos,
          rot: ghostRot,
          extra: isShelf(activeItem) ? { bays: state.shelfBays } : null,
        });
        return;
      }

      /* ---- 카트 순찰 경로 그리기 --------------------------------------- */
      if (tool === TOOL.PATH && activeItem && isTop) {
        const cur = [clean(snap(p[0], gridSize)), clean(snap(p[1], gridSize))];

        const pts = pathDraft?.points ?? [];

        /* 경로가 벽을 뚫지 못하게 한다.
           ------------------------------------------------------------------
           보는 것은 "찍은 점이 밖인가" 가 아니라 **직전 점에서 여기까지 오는
           동안 경계를 어디서 넘었는가** 다. 점만 보면, 문을 지나 바깥 멀리로
           이어지는 트럭 경로를 그릴 수가 없다 — 문에서 멀어지는 순간 거부되기
           때문이다. 정작 막아야 할 것은 벽 한복판을 가로지르는 선이다.

           카트는 아예 밖으로 나가지 않으므로 넘는 것 자체가 잘못이고,
           트럭은 문으로 넘으면 된다. */
        if (floor) {
          const prev = pts[pts.length - 1];
          const truck = isTruck(activeItem);
          if (!truck && !pointInMP(floor, cur)) {
            dispatch({ type: 'SET', patch: { hint: '경로는 작업 영역 안에만 그릴 수 있습니다' } });
            return;
          }
          if (prev && crossesWall(prev, cur, floor, truck ? gates : [])) {
            dispatch({
              type: 'SET',
              patch: {
                hint: truck
                  ? '트럭은 개구부를 지나서만 밖으로 나갈 수 있습니다'
                  : '경로가 벽을 지나갑니다',
              },
            });
            return;
          }
        }
        // 첫 점을 다시 누르면 고리를 닫고 마무리한다
        if (pts.length >= 3 && Math.hypot(pts[0][0] - cur[0], pts[0][1] - cur[1]) < CLOSE_DIST) {
          dispatch({ type: 'PATH_FINISH', closed: true });
          return;
        }
        dispatch({ type: 'PATH_ADD_POINT', point: cur });
        return;
      }

      /* ---- 배관·전선: 자재 포트와 무관하게 자기 높이에 놓는다 ---------- */
      if (tool === TOOL.CONNECT && activeItem) {
        /* 연결장치는 설비 사이를 잇는 것이라 건물 안에만 있어야 한다 */
        const at = [clean(snap(p[0], gridSize)), clean(snap(p[1], gridSize))];
        if (floor && !pointInMP(floor, at)) {
          dispatch({ type: 'SET', patch: { hint: '연결장치는 작업 영역 안에만 놓을 수 있습니다' } });
          return;
        }
      }

      if (tool === TOOL.CONNECT && activeItem && isUtility(activeItem)) {
        const cur = [clean(snap(p[0], gridSize)), clean(snap(p[1], gridSize))];
        const end = utilityEndpoint(cur);
        if (!connectFrom) {
          dispatch({ type: 'START_CONNECT', port: end });
        } else {
          // 방향은 상대 끝이 정해진 지금에야 확정할 수 있다
          const fromRef = { ...connectFrom.ref };
          const away = quantizeDir([cur[0] - connectFrom.world[0], cur[1] - connectFrom.world[2]]);
          if (fromRef.point || fromRef.anchor || fromRef.link) fromRef.dir = away;
          const toRef = { ...end.ref, dir: [-away[0], -away[1]] };
          // 배관·전선은 겹쳐도 층을 쌓지 않는다 — T·+ 로 만나는 게 정상이다
          dispatch({ type: 'ADD_LINK', itemId: activeItem.id, from: fromRef, to: toRef, layer: 0 });
        }
        return;
      }

      if (tool === TOOL.CONNECT && activeItem) {
        const cur = [clean(snap(p[0], gridSize)), clean(snap(p[1], gridSize))];
        const near = nearestPort(ports, cur, PORT_SNAP_DIST, connectFrom?.key, acceptPort);
        if (!connectFrom) {
          const port = near ?? {
            key: '__free_start',
            world: [cur[0], 0.6, cur[1]],
            dir: [1, 0],
            ref: { point: cur, y: 0.6, dir: [1, 0] },
          };
          dispatch({
            type: 'START_CONNECT',
            port: {
              ...port,
              ref: port.ref ?? { uid: port.uid, portId: port.id },
            },
          });
        } else {
          /* 이을 수 없는 포트 위를 클릭한 경우.
             스냅 후보에서 빠져 있으므로 그대로 두면 "빈 바닥" 으로 해석되어
             엉뚱한 자유 끝점이 생긴다. 포트 근처를 눌렀다는 사실은 알아야
             하므로 호환성을 무시하고 한 번 더 찾아보고, 걸리면 거절한다. */
          const blocking = nearestPort(ports, cur, PORT_SNAP_DIST, connectFrom.key);
          if (blocking && !portsCompatible(connectFrom, blocking)) {
            dispatch({ type: 'SET', patch: { hint: incompatibleReason(connectFrom, blocking) } });
            return;
          }

          const toPort = near;
          let toRef = toPort
            ? { uid: toPort.uid, portId: toPort.id }
            : {
                point: cur,
                y: connectFrom.world[1],
                dir: quantizeDir([connectFrom.world[0] - cur[0], connectFrom.world[2] - cur[1]]),
              };
          // 시작이 자유 끝점이었다면 이제서야 방향을 확정할 수 있다
          let fromRef = { ...connectFrom.ref };
          if (fromRef.point) {
            const target = toPort ? [toPort.world[0], toPort.world[2]] : cur;
            fromRef.dir = quantizeDir([target[0] - fromRef.point[0], target[1] - fromRef.point[1]]);
          }

          /* 유입부에서 시작해 유출부로 그렸다면 앞뒤를 뒤집어 저장한다.
             연결은 언제나 "유출 → 유입" 으로 남아야 벨트 진행 방향과
             인스펙터의 시작/끝 표기가 실제 자재 흐름과 일치한다.
             (사람은 편한 쪽부터 그리므로, 그리는 순서까지 강요하지는 않는다) */
          if (connectFrom.kind === PORT_KIND.IN && toPort?.kind === PORT_KIND.OUT) {
            const swap = fromRef;
            fromRef = toRef;
            toRef = swap;
          }

          /* 이미 깔린 레일과 평면상 겹치면 그 위층으로 쌓는다.
             0층부터 올라가며 비어 있는 첫 층을 찾는다. */
          const draft = { itemId: activeItem.id, from: fromRef, to: toRef, radius: state.cornerRadius, layer: 0 };
          const draftPath = linkPath(draft, placed, itemOf);
          const spec = activeItem.modelKey ? getSpec(activeItem.modelKey) : null;
          const clearance = Math.max(0.6, (spec?.connector?.nativeWidth ?? 1) * 0.6);
          const layer = draftPath ? autoLayer(draftPath, linkPaths, clearance) : 0;

          dispatch({ type: 'ADD_LINK', itemId: activeItem.id, from: fromRef, to: toRef, layer });
        }
        return;
      }

      if (tool === TOOL.SELECT) dispatch({ type: 'SELECT', selected: null });
    },
    [tool, isTop, computeGhost, activeItem, ghostRot, dispatch, connectFrom, ports, acceptPort,
     gridSize, placed, itemOf, linkPaths, state.cornerRadius, pathDraft, utilityEndpoint,
     state.drawShape, state.polyDraft, state.wallDraft, state.walls, state.areas, finishPoly, floor,
     state.build, state.pillars, gates, paste],
  );

  /* ---- 개구부 클릭/드래그 ------------------------------------------------
   *  개구부는 벽에서 빠진 자리라 벽을 통해 잡힌다(AreaView 가 눌린 지점을 보고
   *  넘겨 준다). 옮길 때도 벽에서 떼어 낼 수는 없으므로 **그 벽 위에서만**
   *  미끄러진다 — 어느 벽의 문인가는 도면의 뜻 자체라서 드래그로 바뀌면 안 된다.
   * ---------------------------------------------------------------------- */
  const onOpeningDown = useCallback(
    (opening, line, e) => {
      if (tool !== TOOL.SELECT) return;
      if (e.nativeEvent?.button !== 0) return;
      e.stopPropagation();
      pickedRef.current = true;

      if (e.nativeEvent?.ctrlKey || e.nativeEvent?.metaKey) {
        dispatch({ type: 'SELECT_TOGGLE', kind: 'opening', uid: opening.uid });
        return;
      }
      dispatch({ type: 'SELECT', selected: { kind: 'opening', uid: opening.uid } });

      /* 바닥 띠에서 눌렀으면 어느 벽인지 같이 오지 않는다 — 좌표로 다시 찾는다 */
      const host = line
        ?? wallLines(state.areas, state.walls).find((l) => openingsOn(l, [opening]).length)
        ?? null;
      if (isTop && host) drag.current = { kind: 'opening', uid: opening.uid, line: host };
    },
    [tool, isTop, dispatch, state.areas, state.walls],
  );

  /* ---- 기둥 클릭/드래그 -------------------------------------------------- */
  const onPillarDown = useCallback(
    (pl, e) => {
      /* 오른쪽·휠 버튼은 화면을 돌리고 미는 데 쓴다 — 그 클릭으로 선택이
         바뀌면 시점을 옮기다가 엉뚱한 것이 잡힌다 */
      if (e.nativeEvent?.button !== 0) return;
      if (tool !== TOOL.SELECT && tool !== TOOL.ERASE) return;
      e.stopPropagation();
      pickedRef.current = true;

      if (tool === TOOL.ERASE) {
        dispatch({ type: 'DELETE', kind: 'pillar', uid: pl.uid });
        return;
      }

      const ctrl = e.nativeEvent?.ctrlKey || e.nativeEvent?.metaKey;
      if (ctrl) {
        dispatch({ type: 'SELECT_TOGGLE', kind: 'pillar', uid: pl.uid });
        return;                                    // 고르는 중에는 끌지 않는다
      }
      /* 이미 묶어 놓은 것 중 하나를 잡았으면 묶음을 유지한 채로 끈다.
         여기서 선택을 하나로 줄이면 "여러 개 골라 놓고 옮기기" 가 불가능하다. */
      const inGroup = selPillar.has(pl.uid);
      if (!inGroup) dispatch({ type: 'SELECT', selected: { kind: 'pillar', uid: pl.uid, uids: [pl.uid] } });

      if (isTop) {
        const group = (inGroup ? state.pillars.filter((x) => selPillar.has(x.uid)) : [pl])
          .map((x) => ({ uid: x.uid, base: [x.pos[0], x.pos[1]] }));
        drag.current = { kind: 'pillar', uid: pl.uid, off: [pl.pos[0] - e.point.x, pl.pos[1] - e.point.z], group };
      }
    },
    [tool, isTop, dispatch, selected, selPillar, state.pillars],
  );

  /* ---- 설비 클릭/드래그 ------------------------------------------------- */
  const onModelDown = useCallback(
    (p, e) => {
      if (e.nativeEvent?.button !== 0) return;
      /* 카트 경로를 그리는 중에는 설비·선반을 집지 않는다.
         집어 버리면 그 위에는 경유점을 찍을 수 없어서, 정작 자재를 주고받는
         자리(설비 앞·선반 앞) 위로 경로를 그릴 수가 없다. */
      if (tool === TOOL.PLACE || tool === TOOL.CONNECT || tool === TOOL.PATH) return;
      e.stopPropagation();
      pickedRef.current = true;

      if (tool === TOOL.ERASE) {
        dispatch({ type: 'DELETE', kind: 'equip', uid: p.uid });
        return;
      }

      const ctrl = e.nativeEvent?.ctrlKey || e.nativeEvent?.metaKey;
      if (ctrl) {
        dispatch({ type: 'SELECT_TOGGLE', kind: 'equip', uid: p.uid });
        return;
      }
      const inGroup = selected?.kind === 'equip' && selEquip.has(p.uid);
      if (!inGroup) dispatch({ type: 'SELECT', selected: { kind: 'equip', uid: p.uid, uids: [p.uid] } });

      if (isTop) {
        const group = (inGroup ? placed.filter((x) => selEquip.has(x.uid)) : [p])
          .map((x) => ({ uid: x.uid, base: [x.pos[0], x.pos[1]] }));
        drag.current = {
          uid: p.uid,
          itemId: p.itemId,
          rot: p.rot,
          off: [p.pos[0] - e.point.x, p.pos[1] - e.point.z],
          group,
        };
      }
    },
    [tool, isTop, dispatch, selected, selEquip, placed],
  );

  /* 연결도 설비와 같은 pointerdown 을 쓴다. onClick(네이티브 click)은 내
     pointerup 처리보다 늦게 도착해서 "집었다" 표시가 한 박자 밀린다. */
  const onLinkDown = useCallback(
    (l, e) => {
      if (e.nativeEvent?.button !== 0) return;
      if (tool === TOOL.PLACE || tool === TOOL.CONNECT || tool === TOOL.PATH) return;
      e.stopPropagation();
      pickedRef.current = true;
      if (tool === TOOL.ERASE) dispatch({ type: 'DELETE', kind: 'link', uid: l.uid });
      else if (e.nativeEvent?.ctrlKey || e.nativeEvent?.metaKey) dispatch({ type: 'SELECT_TOGGLE', kind: 'link', uid: l.uid });
      else dispatch({ type: 'SELECT', selected: { kind: 'link', uid: l.uid } });
    },
    [tool, dispatch],
  );

  const onCartDown = useCallback(
    (c, e) => {
      if (e.nativeEvent?.button !== 0) return;
      if (tool === TOOL.PLACE || tool === TOOL.CONNECT || tool === TOOL.PATH) return;
      e.stopPropagation();
      pickedRef.current = true;
      if (tool === TOOL.ERASE) dispatch({ type: 'DELETE', kind: 'cart', uid: c.uid });
      else if (e.nativeEvent?.ctrlKey || e.nativeEvent?.metaKey) dispatch({ type: 'SELECT_TOGGLE', kind: 'cart', uid: c.uid });
      else dispatch({ type: 'SELECT', selected: { kind: 'cart', uid: c.uid } });
    },
    [tool, dispatch],
  );

  /* ---- 경로 편집 손잡이 --------------------------------------------------
   *  선택한 연결/카트의 경유점을 끌어 옮긴다. 구간 중점(흐린 점)을 끌면
   *  그 자리에 경유점을 새로 만들고 곧바로 그걸 끄는 상태로 넘어간다 —
   *  "추가하고 다시 잡아 끌기" 두 동작을 하나로 합친다.
   * ---------------------------------------------------------------------- */
  const editTarget = useMemo(() => {
    if (!isTop || tool !== TOOL.SELECT || !selected) return null;

    /* 내벽 — 양 끝점만 잡는다. 중간 경유점을 허용하면 "꺾인 벽 하나" 가 되어
       두께·높이가 구간마다 다를 수 있는지, 코너를 어떻게 메울지가 전부
       모호해진다. 꺾고 싶으면 벽을 한 장 더 그으면 된다(끝점끼리 달라붙는다). */
    if (selected.kind === 'wall') {
      const w = state.walls.find((x) => x.uid === selected.uid);
      if (!w) return null;
      const y = (w.height ?? 3) + 0.4;
      return {
        kind: 'wall',
        uid: w.uid,
        color: theme.select,
        points: [{ world: [w.a[0], y, w.a[1]] }, { world: [w.b[0], y, w.b[1]] }],
        inserts: [],
      };
    }

    /* 영역·구역 — 다각형의 꼭짓점 전부.
       **고치겠다고 말했을 때만** 낸다(인스펙터의 「꼭짓점 편집」). 고르기만 해도
       나오게 두었더니 바닥을 누를 때마다 손잡이가 우수수 뜨고, 그 손잡이가 벽
       클릭과 자리를 다퉈 벽을 고르려던 손이 자꾸 꼭짓점을 잡았다. */
    if (selected.kind === 'area' || selected.kind === 'zone') {
      const edit = state.editShape;
      if (edit?.kind !== selected.kind || edit.uid !== selected.uid) return null;
      const shape = selected.kind === 'zone'
        ? state.zones.find((z) => z.uid === selected.uid)
        : state.areas.find((a) => a.uid === selected.uid);
      if (!shape) return null;
      /* 영역은 벽 위로 띄운다 — 벽 높이보다 낮으면 손잡이가 벽에 파묻힌다.
         구역은 바닥에 깔린 것이라 살짝만 띄운다. */
      const y = selected.kind === 'area' ? (shape.height ?? WALL_DEFAULTS.height) + 0.4 : 0.6;
      return {
        kind: 'shape',
        shape: selected.kind,
        uid: shape.uid,
        color: selected.kind === 'area' ? '#22c55e' : (shape.outlineColor ?? shape.color),
        points: mpVertices(shape.mp).map((v) => ({ world: [v.at[0], y, v.at[1]], addr: v })),
        inserts: mpMidpoints(shape.mp).map((m, i) => ({ index: i, world: [m.at[0], y, m.at[1]], addr: m })),
      };
    }

    if (selected.kind === 'link') {
      const entry = linkPaths.find((x) => x.link.uid === selected.uid);
      if (!entry) return null;
      const ends = [entry.path.at(0).pos, entry.path.at(entry.path.length).pos];
      const wps = entry.link.waypoints ?? [];
      const chain = [[ends[0][0], ends[0][2]], ...wps, [ends[1][0], ends[1][2]]];
      const y = Math.max(ends[0][1], ends[1][1]) + 0.35;
      return {
        kind: 'link',
        uid: selected.uid,
        color: theme.select,
        points: wps.map((w) => ({ world: [w[0], y, w[1]] })),
        inserts: chain.slice(0, -1).map((a, i) => ({
          index: i,
          world: [(a[0] + chain[i + 1][0]) / 2, y, (a[1] + chain[i + 1][1]) / 2],
        })),
      };
    }
    if (selected.kind === 'cart') {
      const cart = carts.find((c) => c.uid === selected.uid);
      if (!cart) return null;
      const y = (cart.y ?? 0) + 0.5;
      const chain = cart.closed ? [...cart.points, cart.points[0]] : cart.points;
      return {
        kind: 'cart',
        uid: cart.uid,
        color: '#a78bfa',
        points: cart.points.map((p) => ({ world: [p[0], y, p[1]] })),
        inserts: chain.slice(0, -1).map((a, i) => ({
          index: i,
          world: [(a[0] + chain[i + 1][0]) / 2, y, (a[1] + chain[i + 1][1]) / 2],
        })),
      };
    }
    return null;
  }, [isTop, tool, selected, linkPaths, carts, theme.select, state.walls, state.areas, state.zones, state.editShape]);

  const grabPoint = useCallback(
    (index, e) => {
      pickedRef.current = true;
      if (!editTarget) return;
      /* 벽은 끝점이 둘뿐이라 지울 수 없다 — 지우면 벽이 아니게 된다 */
      if (editTarget.kind === 'wall') {
        drag.current = { kind: 'wallpoint', uid: editTarget.uid, index };
        return;
      }

      /* 영역·구역의 꼭짓점. Alt+클릭이면 지운다 — 세 점은 남긴다(리듀서가 막는다) */
      if (editTarget.kind === 'shape') {
        const addr = editTarget.points[index]?.addr;
        if (!addr) return;
        if (e?.nativeEvent?.altKey) {
          dispatch({ type: 'SHAPE_VERTEX', op: 'remove', kind: editTarget.shape, uid: editTarget.uid, addr });
          return;
        }
        drag.current = { kind: 'vertex', shape: editTarget.shape, uid: editTarget.uid, addr };
        return;
      }
      // Alt 를 누른 채 클릭하면 그 경유점을 지운다
      if (e?.nativeEvent?.altKey) {
        if (editTarget.kind === 'link') {
          const link = links.find((l) => l.uid === editTarget.uid);
          const wp = (link?.waypoints ?? []).filter((_, i) => i !== index);
          dispatch({ type: 'UPDATE_LINK', uid: editTarget.uid, patch: { waypoints: wp } });
        } else {
          const cart = carts.find((c) => c.uid === editTarget.uid);
          if ((cart?.points.length ?? 0) <= 2) return;   // 최소 두 점은 남긴다
          dispatch({
            type: 'UPDATE_CART',
            uid: editTarget.uid,
            patch: { points: cart.points.filter((_, i) => i !== index) },
          });
        }
        return;
      }
      drag.current = { kind: editTarget.kind === 'link' ? 'waypoint' : 'cartpoint', uid: editTarget.uid, index };
    },
    [editTarget, links, carts, dispatch],
  );

  const grabInsert = useCallback(
    (index, e) => {
      pickedRef.current = true;
      if (!editTarget) return;
      const at = editTarget.inserts.find((x) => x.index === index);
      if (!at) return;
      const pt = [clean(snap(at.world[0], gridSize)), clean(snap(at.world[2], gridSize))];

      /* 영역·구역 — 변 위에 꼭짓점을 하나 끼우고 곧바로 그것을 끄는 상태로 넘어간다.
         중점이 그리드에 붙으면서 옆 꼭짓점과 같은 자리가 될 수 있으므로, 실제로
         끼워지는지 먼저 확인한다. 확인 없이 잡으면 그 주소에 있던 **원래 점**을
         끌게 되어, 누른 자리가 아니라 옆 코너가 따라온다. */
      if (editTarget.kind === 'shape') {
        const shape = shapeOf(editTarget.shape, editTarget.uid);
        if (!shape || !insertVertex(shape.mp, at.addr, pt)) return;
        dispatch({ type: 'SHAPE_VERTEX', op: 'insert', kind: editTarget.shape, uid: editTarget.uid, addr: at.addr, pt });
        drag.current = { kind: 'vertex', shape: editTarget.shape, uid: editTarget.uid, addr: at.addr };
        return;
      }

      if (editTarget.kind === 'link') {
        const link = links.find((l) => l.uid === editTarget.uid);
        const wp = [...(link?.waypoints ?? [])];
        wp.splice(index, 0, pt);
        dispatch({ type: 'UPDATE_LINK', uid: editTarget.uid, patch: { waypoints: wp } });
        drag.current = { kind: 'waypoint', uid: editTarget.uid, index };
      } else {
        const cart = carts.find((c) => c.uid === editTarget.uid);
        const pts = [...(cart?.points ?? [])];
        pts.splice(index + 1, 0, pt);
        dispatch({ type: 'UPDATE_CART', uid: editTarget.uid, patch: { points: pts } });
        drag.current = { kind: 'cartpoint', uid: editTarget.uid, index: index + 1 };
      }
    },
    [editTarget, links, carts, dispatch, gridSize, shapeOf],
  );

  return (
    <>
      <SimClock running={state.running} halted={halted.equips} equips={faultParams} />
      <color attach="background" args={[theme.bg]} />
      <fog attach="fog" args={[theme.fog2 ?? theme.bg, theme.fog[0], theme.fog[1]]} />
      <CameraRig view={view} key={view} />
      <FocusRig />
      <Lights view={view} theme={theme} />
      <PointerDriver
        handlers={{
          onMove,
          onClick,
          onUp,
          onDouble: () => {
            if (tool === TOOL.PATH) dispatch({ type: 'PATH_FINISH', closed: false });
            /* 펜으로 그리던 면은 더블클릭으로 닫는다 (첫 점을 다시 눌러도 된다) */
            else if (state.polyDraft?.points.length >= 3) finishPoly(state.polyDraft.points);
          },
          onDownGround,
          onDownStart: () => { pickedRef.current = false; },
        }}
      />
      <Floor gridSize={gridSize} show={state.showGrid} theme={theme} />

      {/* 건물 — 바닥 · 벽 · 기둥 · 구역.
          설비보다 먼저 그려 두면 설비가 그 위에 얹힌 것처럼 읽힌다.
          3D 뷰에서만 앞 벽을 감춘다(돌하우스) — 탑뷰는 도면이라 다 보여야 한다. */}
      <AreaView
        areas={state.areas}
        walls={state.walls}
        pillars={state.pillars}
        zones={state.showZones ? state.zones : []}
        openings={state.openings}
        dollhouse={!isTop && state.dollhouse}
        selected={selected}
        /* 꼭짓점을 고치는 중에는 건물이 클릭을 받지 않는다 — 손잡이 옆의 벽이나
           바닥을 스치면 선택이 옮겨 가면서 편집이 그 자리에서 끝나 버린다.
           끝내는 것은 「끝내기」 버튼과 Esc, 두 가지로만. */
        pick={(tool === TOOL.SELECT || tool === TOOL.ERASE) && !state.editShape}
        onPick={() => { pickedRef.current = true; }}
        onPillarDown={onPillarDown}
        onOpeningDown={onOpeningDown}
        onSelect={(sel) => dispatch({ type: 'SELECT', selected: sel })}
        onToggle={(sel) => dispatch({ type: 'SELECT_TOGGLE', ...sel })}
        onErase={tool === TOOL.ERASE ? (kind, uid) => dispatch({ type: 'DELETE', kind, uid }) : null}
      />

      {/* 붙여넣기 미리보기 — 놓을 수 있으면 청록, 아니면 빨강 */}
      {paste && (
        <group>
          {paste.items.map(({ src, pos, rect }, i) =>
            paste.kind === 'pillar' ? (
              <group key={i}>
                <mesh position={[pos[0], src.height / 2, pos[1]]}>
                  <boxGeometry args={[src.size[0], src.height, src.size[1]]} />
                  <meshBasicMaterial
                    color={paste.ok ? theme.ghostOk : theme.ghostBad}
                    transparent
                    opacity={0.5}
                    depthWrite={false}
                  />
                </mesh>
                {rect && <FootprintOutline rect={rect} color={paste.ok ? theme.ghostOk : theme.ghostBad} />}
              </group>
            ) : (
              <PlacedModel
                key={i}
                placed={{ ...src, pos }}
                item={itemOf(src.itemId)}
                ghost
                valid={paste.ok}
                colors={theme}
              />
            ),
          )}
        </group>
      )}

      {/* 마키(끌어서 여러 개 고르기) */}
      {marquee && isTop && (
        <>
          <mesh
            position={[
              (marquee.start[0] + marquee.cur[0]) / 2,
              0.05,
              (marquee.start[1] + marquee.cur[1]) / 2,
            ]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={9}
            raycast={() => null}
          >
            <planeGeometry
              args={[
                Math.max(Math.abs(marquee.cur[0] - marquee.start[0]), 0.01),
                Math.max(Math.abs(marquee.cur[1] - marquee.start[1]), 0.01),
              ]}
            />
            <meshBasicMaterial color={theme.select} transparent opacity={0.16} depthTest={false} depthWrite={false} />
          </mesh>
          <FootprintOutline
            rect={{
              minX: Math.min(marquee.start[0], marquee.cur[0]),
              maxX: Math.max(marquee.start[0], marquee.cur[0]),
              minZ: Math.min(marquee.start[1], marquee.cur[1]),
              maxZ: Math.max(marquee.start[1], marquee.cur[1]),
            }}
            color={theme.select}
            y={0.06}
          />
        </>
      )}

      {/* 그리는 중인 도형 미리보기 */}
      <BuildPreview
        tool={tool}
        isTop={isTop}
        rect={rectDraft}
        poly={state.polyDraft}
        wallFrom={state.wallDraft}
        cursor={cursor}
        color={theme.select}
      />

      {/* 배치된 설비 · 선반 */}
      {placed.map((p) => {
        const it = itemOf(p.itemId);
        const isSel = selected?.kind === 'equip' && selected.uid === p.uid;
        if (isStillage(it)) {
          return (
            <StillageView
              key={p.uid}
              placed={p}
              item={it}
              selected={isSel}
              onPointerDown={(e) => onModelDown(p, e)}
            />
          );
        }
        return isShelf(it) ? (
          <ShelfView
            key={p.uid}
            placed={p}
            item={it}
            selected={isSel}
            onPointerDown={(e) => onModelDown(p, e)}
          />
        ) : (
          <PlacedModel
            key={p.uid}
            placed={p}
            item={it}
            selected={isSel}
            halted={halted.equips.has(p.uid)}
            colors={theme}
            onPointerDown={(e) => onModelDown(p, e)}
          />
        );
      })}

      {/* 선택 표시 — 설비·선반 모두 높이를 가진 케이지로 (한 곳에서) */}
      {placed
        .filter((p) => selEquip.has(p.uid))
        .map((p) => {
          const rect = rectOf(p);
          const bb = boxFor(p);
          return rect ? (
            <SelectionCage
              key={`sel${p.uid}`}
              rect={rect}
              height={bb ? bb.max[1] - Math.min(bb.min[1], 0) : 0}
              y0={p.y ?? 0}
              color={theme.select}
            />
          ) : null;
        })}

      {/* 비어 있는 설비 포트의 입출고 표시 (선반은 ShelfView 가 직접 그린다) */}
      <ZoneMarks zones={openPortZones} />

      {/* 벨트 위를 흐르는 반송물 — 종점(스틸리지)이 가득 차면 선다 */}
      {beltFlows.map(({ link, path, owner, sink }) => (
        <BeltItems
          key={`f${link.uid}`}
          path={path}
          speed={link.speed ?? state.beltSpeed}
          gap={owner.spawnGap ?? 3}
          layers={owner.outputCount ?? 3}
          payload={payloadOf(itemOf(owner.itemId))}
          running={state.running && !halted.links.has(link.uid)}
          /* 종점에 닿은 한 덩어리가 곧 재고 한 묶음이 된다 */
          onArrive={sink ? (n) => {
            /* 만든 것 중 일부는 불량이다 — 쌓지 않고 버린다(faults.screen).
               적치대에 넣으면 자리를 차지해 멀쩡한 라인을 세우게 된다. */
            const good = screen(n, owner.scrapRate ?? 0);
            if (good > 0) addStock(sink.uid, good, stillageCapacity(sink), payloadKeyOf(itemOf(owner.itemId)));
          } : null}
        />
      ))}

      {/* 카트 */}
      {cartPaths.map(({ cart, path, stations }) => (
        <CartView
          key={cart.uid}
          cart={cart}
          item={itemOf(cart.itemId)}
          path={path}
          stations={stations}
          selected={selected?.kind === 'cart' && selected.uid === cart.uid}
          running={state.running}
          /* 트럭은 건물 밖으로 나가는 순간 짐이 출하로 넘어간다 */
          shipOutside={isTruck(itemOf(cart.itemId))}
          floor={floor}
          gates={gates}
          onPointerDown={(e) => onCartDown(cart, e)}
        />
      ))}

      {/* 그리는 중인 카트 경로 */}
      {draftPath && (
        <>
          <line geometry={draftLineGeom} renderOrder={8}>
            <lineBasicMaterial color="#a78bfa" transparent opacity={0.95} depthTest={false} />
          </line>
          {pathDraft.points.map((pt, i) => (
            <mesh key={i} position={[pt[0], 0.06, pt[1]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={9}>
              <circleGeometry args={[i === 0 ? 0.42 : 0.26, 16]} />
              <meshBasicMaterial color={i === 0 ? '#f472b6' : '#a78bfa'} transparent opacity={0.95} depthTest={false} />
            </mesh>
          ))}
        </>
      )}

      {/* 경로 편집 손잡이 */}
      {editTarget && (
        <EditHandles
          points={editTarget.points}
          inserts={editTarget.inserts}
          color={editTarget.color}
          onGrabPoint={grabPoint}
          onGrabInsert={grabInsert}
        />
      )}

      {/* 배치된 연결장치 */}
      {linkPaths.map(({ link, path }) => (
        <ConnectorView
          key={link.uid}
          link={link}
          item={itemOf(link.itemId)}
          path={path}
          selected={selected?.kind === 'link' && selected.uid === link.uid}
          running={state.running}
          defaultSpeed={state.beltSpeed}
          onPointerDown={(e) => onLinkDown(link, e)}
        />
      ))}

      {/* 배치 고스트 */}
      {ghost && (isShelf(activeItem)
        ? (
          <>
            <ShelfView placed={ghost.placed} item={activeItem} ghost valid={ghost.valid} />
            <FootprintOutline
              rect={footprintOf({ ...ghost.placed, bboxOverride: boxFor(ghost.placed) }, null)}
              color={ghost.valid ? theme.ghostOk : theme.ghostBad}
            />
          </>
        )
        : <PlacedModel placed={ghost.placed} item={activeItem} ghost valid={ghost.valid} colors={theme} />
      )}

      {/* 연결 모드: 포트 표시 + 미리보기.
          배관·전선은 자재 포트를 쓰지 않으므로 포트를 띄우지 않는다 */}
      {tool === TOOL.CONNECT && state.showPorts && !isUtility(activeItem) && (
        <PortMarkers
          ports={ports}
          activeKey={hoverPort?.key ?? connectFrom?.key ?? null}
          accept={connectFrom ? acceptPort : null}
        />
      )}
      {preview && (
        <>
          <ConnectorView link={{ radius: state.cornerRadius }} item={activeItem} path={preview.path} preview valid={preview.snapped} />
          <Html position={preview.path.at(preview.path.length / 2).pos} center style={{ pointerEvents: 'none' }}>
            <div className="rounded bg-float px-2 py-0.5 text-[11px] font-medium text-cyan-600 ring-1 ring-cyan-500/40 whitespace-nowrap">
              {preview.path.length.toFixed(2)} m
              {preview.layer > 0 && <span className="ml-1 text-amber-600">· {preview.layer}층</span>}
            </div>
          </Html>
        </>
      )}

      {/* 선택된 연결의 길이 표시 */}
      {selected?.kind === 'link' &&
        linkPaths
          .filter((x) => x.link.uid === selected.uid)
          .map(({ link, path }) => (
            <Html key={link.uid} position={path.at(path.length / 2).pos} center style={{ pointerEvents: 'none' }}>
              <div className="rounded bg-float px-2 py-0.5 text-[11px] font-medium text-sky-600 ring-1 ring-sky-500/40 whitespace-nowrap">
                {link.name} · {path.length.toFixed(2)} m
                {(link.layer ?? 0) > 0 && <span className="ml-1 text-amber-600">· {link.layer}층</span>}
              </div>
            </Html>
          ))}
    </>
  );
}

export default function EditorScene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      /* 개발 중 콘솔에서 씬/카메라를 들여다보기 위한 창구 (프로덕션 빌드에는 없음) */
      onCreated={(s) => { if (import.meta.env.DEV) window.__r3f = s; }}
    >
      <SceneContent />
    </Canvas>
  );
}
