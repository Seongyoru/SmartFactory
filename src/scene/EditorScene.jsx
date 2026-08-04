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
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';

import { TOOL, VIEW, useEditor } from '../core/store.jsx';
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
import { allPorts, autoLayer, layerLift, linkPath, nearestPort } from '../core/link.js';
import { buildConnectorPath, buildFreePath } from '../core/routing.js';
import { rotateXZ } from '../core/grid.js';
import { PORT_KIND, incompatibleReason, portsCompatible, quantizeDir } from '../core/ports.js';
import PlacedModel, { FootprintOutline } from './PlacedModel.jsx';
import ConnectorView from './ConnectorView.jsx';
import PortMarkers from './PortMarkers.jsx';
import CartView from './CartView.jsx';
import BeltItems from './BeltItems.jsx';
import EditHandles from './EditHandles.jsx';
import { cartPath, cartStations } from '../core/cart.js';
import { isUtility } from '../data/library.js';
import { sceneTheme } from '../theme.js';

/** 카트 경로를 그릴 때 첫 점을 다시 눌러 고리를 닫는 거리(m) */
const CLOSE_DIST = 1.2;
/** 배관이 기존 배관에 분기(T)로 달라붙는 거리(m) */
const BRANCH_SNAP_DIST = 1.0;
/** 배관·전선이 설비에 붙는 것으로 보는 여유 폭(m) */
const ANCHOR_MARGIN = 0.8;

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
      {show && (
        <Grid
          position={[0, 0.002, 0]}
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

/* ==========================================================================
 * 씬 본문
 * ======================================================================== */

function SceneContent() {
  const { state, dispatch, itemOf, activeItem } = useEditor();
  const version = useModelsVersion();
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

  const rects = useMemo(
    () =>
      placed
        .map((p) => ({ uid: p.uid, rect: specFor(p.itemId) ? footprintOf(p, specFor(p.itemId)) : null }))
        .filter((r) => r.rect),
    [placed, specFor, version],
  );

  const ports = useMemo(() => allPorts(placed, itemOf), [placed, itemOf, version]);

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
          return owner ? { link, path, owner } : null;
        })
        .filter(Boolean),
    [linkPaths, itemOf, placed],
  );

  /* ---- 카트 경로 + 정차역 ------------------------------------------------ */
  const cartPaths = useMemo(
    () =>
      carts
        .map((c) => {
          const path = cartPath(c);
          return path ? { cart: c, path, stations: cartStations(path, placed, itemOf) } : null;
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
      const spec = activeItem.modelKey ? getSpec(activeItem.modelKey) : null;
      let valid = true;

      if (spec) {
        let rect = footprintOf({ pos, rot }, spec);
        if (state.snapEdge) {
          const [dx, dz] = edgeSnap(rect, rects.map((r) => r.rect));
          if (dx || dz) {
            pos = [clean(pos[0] + dx), clean(pos[1] + dz)];
            rect = footprintOf({ pos, rot }, spec);
          }
        }
        valid = !outOfBounds(rect) && !rects.some((r) => rectsOverlap(rect, r.rect));
      }
      return { placed: { uid: '__ghost', itemId: activeItem.id, pos, rot, y: 0 }, valid };
    },
    [activeItem, gridSize, rects, state.snapEdge],
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

      if (d.kind === 'cartpoint') {
        const cart = carts.find((c) => c.uid === d.uid);
        if (!cart) return;
        const pts = [...cart.points];
        pts[d.index] = snapped;
        dispatch({ type: 'UPDATE_CART', uid: d.uid, patch: { points: pts } });
        return;
      }

      let pos = [clean(snap(p[0] + d.off[0], g)), clean(snap(p[1] + d.off[1], g))];
      const spec = specFor(d.itemId);
      if (spec && state.snapEdge) {
        const rect = footprintOf({ pos, rot: d.rot }, spec);
        const others = rects.filter((r) => r.uid !== d.uid).map((r) => r.rect);
        const [dx, dz] = edgeSnap(rect, others);
        if (dx || dz) pos = [clean(pos[0] + dx), clean(pos[1] + dz)];
      }
      dispatch({ type: 'MOVE', uid: d.uid, pos });
    },
    [gridSize, isTop, dispatch, rects, specFor, state.snapEdge, links, carts],
  );

  const onUp = useCallback(() => {
    drag.current = null;
  }, []);

  const onClick = useCallback(
    (p) => {
      if (pickedRef.current) return; // 설비/연결을 집은 클릭이면 여기선 아무것도 안 한다

      if (tool === TOOL.PLACE && isTop) {
        // 클릭 시점의 좌표로 다시 계산한다 (미리보기와 완전히 동일한 결과)
        const g = computeGhost(p, ghostRot);
        if (!g?.valid) return;
        dispatch({ type: 'PLACE', itemId: activeItem.id, pos: g.placed.pos, rot: ghostRot });
        return;
      }

      /* ---- 카트 순찰 경로 그리기 --------------------------------------- */
      if (tool === TOOL.PATH && activeItem && isTop) {
        const cur = [clean(snap(p[0], gridSize)), clean(snap(p[1], gridSize))];
        const pts = pathDraft?.points ?? [];
        // 첫 점을 다시 누르면 고리를 닫고 마무리한다
        if (pts.length >= 3 && Math.hypot(pts[0][0] - cur[0], pts[0][1] - cur[1]) < CLOSE_DIST) {
          dispatch({ type: 'PATH_FINISH', closed: true });
          return;
        }
        dispatch({ type: 'PATH_ADD_POINT', point: cur });
        return;
      }

      /* ---- 배관·전선: 자재 포트와 무관하게 자기 높이에 놓는다 ---------- */
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
     gridSize, placed, itemOf, linkPaths, state.cornerRadius, pathDraft, utilityEndpoint],
  );

  /* ---- 설비 클릭/드래그 ------------------------------------------------- */
  const onModelDown = useCallback(
    (p, e) => {
      if (tool === TOOL.PLACE || tool === TOOL.CONNECT) return;
      e.stopPropagation();
      pickedRef.current = true;

      if (tool === TOOL.ERASE) {
        dispatch({ type: 'DELETE', kind: 'equip', uid: p.uid });
        return;
      }
      dispatch({ type: 'SELECT', selected: { kind: 'equip', uid: p.uid } });
      if (isTop) {
        drag.current = {
          uid: p.uid,
          itemId: p.itemId,
          rot: p.rot,
          off: [p.pos[0] - e.point.x, p.pos[1] - e.point.z],
        };
      }
    },
    [tool, isTop, dispatch],
  );

  /* 연결도 설비와 같은 pointerdown 을 쓴다. onClick(네이티브 click)은 내
     pointerup 처리보다 늦게 도착해서 "집었다" 표시가 한 박자 밀린다. */
  const onLinkDown = useCallback(
    (l, e) => {
      if (tool === TOOL.PLACE || tool === TOOL.CONNECT || tool === TOOL.PATH) return;
      e.stopPropagation();
      pickedRef.current = true;
      if (tool === TOOL.ERASE) dispatch({ type: 'DELETE', kind: 'link', uid: l.uid });
      else dispatch({ type: 'SELECT', selected: { kind: 'link', uid: l.uid } });
    },
    [tool, dispatch],
  );

  const onCartDown = useCallback(
    (c, e) => {
      if (tool === TOOL.PLACE || tool === TOOL.CONNECT || tool === TOOL.PATH) return;
      e.stopPropagation();
      pickedRef.current = true;
      if (tool === TOOL.ERASE) dispatch({ type: 'DELETE', kind: 'cart', uid: c.uid });
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
  }, [isTop, tool, selected, linkPaths, carts, theme.select]);

  const grabPoint = useCallback(
    (index, e) => {
      pickedRef.current = true;
      if (!editTarget) return;
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
      const pt = [clean(snap(at.world[0], gridSize)), clean(snap(at.world[2], gridSize))];
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
    [editTarget, links, carts, dispatch, gridSize],
  );

  return (
    <>
      <color attach="background" args={[theme.bg]} />
      <fog attach="fog" args={[theme.fog2 ?? theme.bg, theme.fog[0], theme.fog[1]]} />
      <CameraRig view={view} key={view} />
      <Lights view={view} theme={theme} />
      <PointerDriver
        handlers={{
          onMove,
          onClick,
          onUp,
          onDouble: () => { if (tool === TOOL.PATH) dispatch({ type: 'PATH_FINISH', closed: false }); },
          onDownStart: () => { pickedRef.current = false; },
        }}
      />
      <Floor gridSize={gridSize} show={state.showGrid} theme={theme} />

      {/* 배치된 설비 */}
      {placed.map((p) => (
        <PlacedModel
          key={p.uid}
          placed={p}
          item={itemOf(p.itemId)}
          selected={selected?.kind === 'equip' && selected.uid === p.uid}
          colors={theme}
          onPointerDown={(e) => onModelDown(p, e)}
        />
      ))}

      {/* 벨트 위를 흐르는 반송물 */}
      {beltFlows.map(({ link, path, owner }) => (
        <BeltItems
          key={`f${link.uid}`}
          path={path}
          speed={link.speed ?? state.beltSpeed}
          gap={owner.spawnGap ?? 3}
          layers={owner.outputCount ?? 3}
          running={state.running}
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
      {ghost && <PlacedModel placed={ghost.placed} item={activeItem} ghost valid={ghost.valid} colors={theme} />}

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
