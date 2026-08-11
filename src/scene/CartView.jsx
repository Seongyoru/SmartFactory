/**
 * =============================================================================
 *  카트 — 경로 순찰 + 적재물(OBJ)
 * =============================================================================
 *  경로는 정해져 있고 카트는 그 위를 왕복한다(닫힌 경로면 계속 돈다).
 *  한 경로에 여러 대를 올릴 수 있고, 출발 지점을 경로 길이만큼 고르게 나눠
 *  서로 붙어 다니지 않게 한다.
 *
 *  움직임은 React 상태가 아니라 useFrame 안에서 오브젝트 행렬을 직접 만진다 —
 *  프레임마다 리렌더를 걸면 컨베이어 지오메트리까지 덩달아 다시 계산된다.
 *  상태(몇 개를 싣고 있는가)만 리렌더가 필요한데, 역을 지날 때만 바뀌므로
 *  useState 로 둬도 부담이 없다.
 * ---------------------------------------------------------------------------
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { cloneScene, useModelSpec } from '../core/modelStore.js';
import { stationStyle, stepCart } from '../core/cart.js';
import { addLots, addShipped, takeLots } from '../core/simStore.js';
import { usePayloadSpecs } from '../core/payload.js';
import { inGate, pointInMP } from '../core/area.js';

const CART_COLOR = '#a78bfa';

/** 순찰 경로 선 */
function PatrolLine({ path, color, opacity, lift = 0.04 }) {
  const geom = useMemo(() => {
    const pts = path.points3(lift).map((p) => new THREE.Vector3(...p));
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [path, lift]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <line geometry={geom} renderOrder={5}>
      <lineBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
    </line>
  );
}

/** 적재·하역 지점 표시 (선택했을 때만) */
function StationMarks({ path, stations }) {
  return (
    <group>
      {stations.map((st, i) => {
        const p = path.at(st.s).pos;
        return (
          <mesh key={i} position={[p[0], p[1] + 0.05, p[2]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={7}>
            <ringGeometry args={[0.35, 0.5, 20]} />
            <meshBasicMaterial
              color={stationStyle(st.kind).color}
              transparent
              opacity={0.9}
              depthTest={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/* ==========================================================================
 * 카트 한 대
 * ======================================================================== */

function CartUnit({ cart, spec, path, stations, running, selected, startS, shipOutside, floor, gates, oneWay, onPointerDown }) {
  const groupRef = useRef(null);
  const sRef = useRef(startS);
  const dirRef = useRef(1);
  const pauseRef = useRef(0);
  const lastKeyRef = useRef(null);
  /** 지금 싣고 있는 짐을 어디서 받았는가 — 같은 곳에 도로 내려놓지 않기 위해 */
  const sourceRef = useRef(null);
  const [carried, setCarried] = useState(0);
  /** 무엇을 싣고 있는가 — 실은 곳에서 따라오고, 내릴 때 그대로 넘긴다 */
  /** 싣고 있는 물건들의 종류 (아래에서부터). 섞어 실으면 섞인 채로 간다 */
  const [carriedKinds, setCarriedKinds] = useState([]);
  const specOf = usePayloadSpecs();

  // 대수가 바뀌면 출발 지점을 다시 나눠 갖는다
  useEffect(() => { sRef.current = startS; }, [startS]);

  /* 본체와 적재물을 분리한다 — 적재물은 실은 개수만큼 복제해 쌓는다.
     clone() 은 지오메트리·머티리얼을 공유하므로 여러 대·여러 단이어도 가볍다. */
  const parts = useMemo(() => {
    if (!spec) return null;
    const body = cloneScene(spec);
    let payload = null;
    body.traverse((n) => {
      if (!payload && spec.payload && n.name === spec.payload.name) payload = n;
    });
    if (payload) payload.parent?.remove(payload);
    return { body, payload };
  }, [spec]);

  /**
   * 싣고 있는 물건.
   * -------------------------------------------------------------------------
   *  카트 GLB 안에도 적재물 노드가 하나 들어 있지만, 그것만 쓰면 **무엇을 실었든
   *  늘 같은 물건**이 올라간다. 노란 물건을 실어도 회색이 얹히는 식이다.
   *  그래서 노드는 **놓일 자리**(짐칸 위치와 한 단 높이)로만 쓰고, 형상은 실제로
   *  실은 반송물 모델에서 가져온다. 아직 못 읽었으면 원래 노드로 돌아간다.
   */
  const stack = useMemo(() => {
    if (!parts?.payload || carried <= 0) return [];
    const h = spec?.payload?.height ?? 0.3;
    const anchor = parts.payload.position;
    const out = [];
    for (let i = 0; i < carried; i++) {
      const s = specOf(carriedKinds[i]);
      const o = s ? cloneScene(s) : parts.payload.clone(true);
      if (s) o.position.set(anchor.x, anchor.y + i * h, anchor.z);
      else o.position.y += i * h;
      out.push(o);
    }
    return out;
  }, [parts, carried, carriedKinds, spec, specOf]);

  const axis = spec?.connector?.axis ?? 'z';

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g || !path) return;

    if (running) {
      const next = stepCart(
        { s: sRef.current, dir: dirRef.current, pause: pauseRef.current, lastKey: lastKeyRef.current },
        {
          length: path.length,
          closed: cart.closed,
          oneWay,
          speed: cart.speed ?? 1.4,
          dwell: cart.dwell ?? 1.2,
        },
        stations,
        dt,
      );
      if (next.recycled) {
        /* 새 차가 나온 것이므로 이전 차의 짐과 기억은 남지 않는다 */
        if (carried > 0) setCarried(0);
        setCarriedKinds([]);
        sourceRef.current = null;
        lastKeyRef.current = null;
      }
      sRef.current = next.s;
      dirRef.current = next.dir;
      pauseRef.current = next.pause;

      /* 수량 계산은 여기서 한다 — 선반이 몇 개나 받아 줄지는 재고에 달렸고,
         "실제로 주고받았을 때만" 그 역을 들른 것으로 기록해야 하기 때문이다. */
      if (next.arrived) {
        const a = next.arrived;
        let acted = false;

        if (a.kind === 'shelf-in') {
          /* 내리기.
             실어 온 곳으로 도로 가져다 놓지 않는다 — 1번 선반에서 실은 짐을
             1번 선반에 내리면 아무 일도 안 한 셈이고, 왕복 경로에서는 그게
             무한히 반복된다. 어디서 실었는지 기억해 두고 그 선반은 건너뛴다. */
          if (carried > 0 && sourceRef.current !== a.uid) {
            const moved = addLots(a.uid, carriedKinds, a.capacity);
            if (moved > 0) {
              const left = carried - moved;
              setCarried(left);
              setCarriedKinds(carriedKinds.slice(moved));   // 못 내린 것은 그대로 싣고 간다
              if (left === 0) sourceRef.current = null;
              acted = true;
            }
          }
        } else if (a.kind === 'shelf-out') {
          // 싣기 — 비어 있을 때만
          if (carried === 0) {
            /* 몇 개를 싣고 나갈지는 **차량이** 정한다 — 선반은 얼마든지 내줄
               수 있고, 한 번에 실어 낼 양은 차의 성질이기 때문이다.
               지정이 없으면 선반이 권하는 양을 따른다(기존 카트 동작). */
            const want = cart.loadCount ?? a.dispatch ?? 0;
            /* 무엇을 가져올지 정해 두었으면 **그 종류만** 골라 온다.
               선반에는 여러 종류가 섞여 쌓이므로, 정해 두지 않으면 위에 있던
               것이 잡히는 대로 실린다 — 필요한 것만 나르려면 골라야 한다. */
            const got = takeLots(a.uid, want, cart.pickKind ?? null);
            if (got.length > 0) {
              setCarried(got.length);
              setCarriedKinds(got);
              sourceRef.current = a.uid;
              acted = true;
            }
          }
        } else if (a.kind === 'load') {
          /* 설비에서 싣는 것도 마찬가지다 — "이 종류만 나른다" 고 정해 둔
             카트는 다른 것을 만드는 설비 앞을 그냥 지나간다. */
          if (a.count > 0 && (!cart.pickKind || (a.payloadKind ?? 'OBJ') === cart.pickKind)) {
            setCarried(a.count);
            setCarriedKinds(Array.from({ length: a.count }, () => a.payloadKind ?? 'OBJ'));
            sourceRef.current = a.uid;
            acted = true;
          }
        } else if (a.kind === 'unload') {
          if (carried > 0) { setCarried(0); setCarriedKinds([]); sourceRef.current = null; acted = true; }
        }

        if (acted) lastKeyRef.current = a.key ?? a.uid;
        else pauseRef.current = 0;      // 아무 일도 없었으면 서 있을 이유도 없다
      }
    }

    const f = path.at(sRef.current);
    const d = dirRef.current;
    const tx = f.tan[0] * d;
    const tz = f.tan[1] * d;
    g.position.set(f.pos[0], f.pos[1] + (cart.y ?? 0), f.pos[2]);

    /* 트럭이 개구부를 지나 건물 밖으로 나가면 싣고 있던 것은 출하된 것이다.
       ---------------------------------------------------------------------
       출하 지점을 따로 배선하지 않는다 — "문으로 나갔다" 는 사실 자체가 출하다.
       다만 **문으로** 나가야 한다. 벽을 뚫고 나간 자리에서는 아무 일도 일어나지
       않아, 도면이 틀렸다는 것이 짐을 실은 채 도는 트럭으로 드러난다. */
    const outside = floor && !pointInMP(floor, [f.pos[0], f.pos[2]]);
    if (running && shipOutside && carried > 0 && outside && inGate(gates, [f.pos[0], f.pos[2]])) {
      addShipped(carried);
      setCarried(0);
      setCarriedKinds([]);
      sourceRef.current = null;
      lastKeyRef.current = null;      // 밖에 다녀왔으니 다시 실을 수 있다
    }
    // 모델의 진행축을 이동 방향에 맞춘다
    g.rotation.y = (axis === 'z' ? Math.atan2(tx, tz) : Math.atan2(-tz, tx)) + (cart.reverse ? Math.PI : 0);
  });

  return (
    <group ref={groupRef} onPointerDown={onPointerDown}>
      <group>
        {parts ? (
          <>
            <primitive object={parts.body} />
            {stack.map((o, i) => (
              <primitive key={i} object={o} />
            ))}
          </>
        ) : (
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[1.4, 1, 2.1]} />
            <meshBasicMaterial color={CART_COLOR} wireframe />
          </mesh>
        )}
      </group>

      {selected && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
          <ringGeometry args={[1.15, 1.35, 24]} />
          <meshBasicMaterial color={CART_COLOR} transparent opacity={0.9} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

/* ==========================================================================
 * 한 경로 = 카트 여러 대
 * ======================================================================== */

export default function CartView({
  cart,
  item,
  path,
  stations,
  selected = false,
  running = true,
  /** 트럭인가 — 건물 밖으로 나가면 짐을 출하로 넘긴다 */
  shipOutside = false,
  floor = null,
  gates = [],
  onPointerDown,
}) {
  const spec = useModelSpec(item);
  const count = Math.max(1, Math.min(20, cart.count ?? 1));

  if (!path) return null;

  return (
    <group>
      <PatrolLine path={path} color={selected ? CART_COLOR : '#7c6bb0'} opacity={selected ? 0.95 : 0.4} />
      {selected && <StationMarks path={path} stations={stations} />}

      {Array.from({ length: count }, (_, k) => (
        <CartUnit
          key={k}
          cart={cart}
          spec={spec}
          path={path}
          stations={stations}
          running={running}
          selected={selected}
          /* 출발 지점을 경로 길이만큼 고르게 나눈다 — 여러 대가 한 점에서
             출발하면 겹쳐 보이고, 역에서도 동시에 서 버린다 */
          startS={(k / count) * path.length}
          shipOutside={shipOutside}
          floor={floor}
          gates={gates}
          oneWay={shipOutside && !cart.closed}
          onPointerDown={onPointerDown}
        />
      ))}
    </group>
  );
}
