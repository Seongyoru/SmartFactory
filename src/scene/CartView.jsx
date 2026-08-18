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
import { Html } from '@react-three/drei';
import { cloneScene, useModelSpec } from '../core/modelStore.js';
import { CART_MARGIN, stationStyle } from '../core/cart.js';
import { simStep } from '../core/clock.js';
import { newCartUnit, runCart } from '../core/sim.js';
import { usePayloadSpecs } from '../core/payload.js';
import { canonKind } from '../data/library.js';

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

function CartUnit({
  cart, spec, path, stations, running, selected, startS, shipOutside, floor, gates, oneWay,
  /** 같은 경로 위 모든 차의 자리 — 앞차와 간격을 지키려면 서로를 봐야 한다 */
  fleet, index, gap,
  onPointerDown,
}) {
  const groupRef = useRef(null);
  /**
   * 이 차의 **모든 가변 상태**가 여기 하나에 들어 있다.
   * -------------------------------------------------------------------------
   *  예전에는 useRef 일곱 개와 useState 둘로 흩어져 있었다. 그러면 굴리는 코드가
   *  화면에 묶여 **화면 없이는 못 돈다** — 반복 실행을 막고 있던 것이 그것이다.
   *  평범한 객체 하나로 모으니 `core/sim.js` 가 그대로 굴릴 수 있다.
   *
   *  `reverse` 는 모델만 돌리는 값이 아니라 **진행 방향 자체**를 뒤집는다.
   *  모델 방향은 진행 방향에서 나오므로(아래 rotation.y) 저절로 따라온다.
   */
  const unit = useRef(null);
  if (!unit.current) unit.current = newCartUnit(startS, cart.reverse);

  /**
   * 실은 것 — **화면에 그리려고만** 들고 있는 사본이다.
   *  임자는 `unit.current.carried` 다. 짐 모형을 쌓으려면 리렌더가 필요해서
   *  바뀔 때만 여기로 옮겨 적는다.
   */
  const [carriedKinds, setCarriedKinds] = useState([]);
  const carried = carriedKinds.length;
  const specOf = usePayloadSpecs();

  // 대수가 바뀌면 출발 지점을 다시 나눠 갖는다
  useEffect(() => { unit.current.s = startS; }, [startS]);
  /* 첫 프레임 전에도 남들이 내 자리를 볼 수 있어야 한다 — 안 그러면 대수가
     바뀐 직후 한 프레임 동안 서로가 안 보여 겹친 채로 출발한다 */
  useEffect(() => {
    if (fleet) fleet.current[index] = { s: unit.current.s, dir: unit.current.dir };
  }, [fleet, index, startS]);
  /* 방향을 뒤집으면 곧바로 반영한다 — 다음 바퀴를 기다리지 않는다.
     (고리는 제자리에서 돌아서고, 끝이 있는 경로는 startS 가 반대쪽 끝으로
      바뀌므로 위의 효과가 자리도 함께 옮긴다) */
  useEffect(() => { unit.current.dir = cart.reverse ? -1 : 1; }, [cart.reverse]);

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

  /**
   * 얼마나 실을 수 있는가 · 나눠 채울 것인가.
   * -------------------------------------------------------------------------
   *  트럭은 하는 일이 "밖으로 내보내기" 하나뿐이라 목적지가 갈리지 않는다.
   *  그래서 자리가 남는 동안 **여러 역에서 나눠 채우고** 다 차면 그대로 나간다.
   *  카트는 한 곳에서 받아 다른 곳에 옮기는 것이 일이라, 가는 길에 이것저것
   *  주워 담으면 어디에 무엇을 내려놓을지가 흐려진다 — 비어 있을 때만 싣는다.
   */
  const topUp = shipOutside;
  const capacity = Math.max(0, cart.loadCount ?? (shipOutside ? 10 : 3));
  const full = carried >= capacity && capacity > 0;

  /* 적재량 표시는 트럭에만 붙인다. 카트는 실을 양이 가는 곳마다 달라서
     (선반이 권하는 양을 따른다) 분모로 삼을 수가 없다. */
  const showLoad = shipOutside && capacity > 0;
  /* 차체 위 — 모델 높이를 알면 그 위로, 모르면 넉넉히 */
  const loadLabelY = (spec?.bbox?.size?.[1] ?? 3.3) + 0.6;

  useFrame((_, real) => {
    /* 배속을 반영한 **시뮬 시간**으로 바꿔서 쓴다. 프레임이 길어졌을 때의
       상한도 여기서 이미 걸린다(clock.simStep). */
    const dt = simStep(real);
    const g = groupRef.current;
    if (!g || !path) return;

    /**
     * 굴리는 일은 **core/sim.js 가 한다.**
     * -----------------------------------------------------------------------
     *  예전에는 이 자리에 140줄이 있었다 — 간격 지키기, 정차역에서 싣고 내리기,
     *  문으로 나가면 출하. 전부 화면 안에 있어서 **화면이 있어야만 돌았다.**
     *
     *  규칙을 옮겨 적은 것이 아니라 **상태를 담는 그릇을 바꾼 것**이다. 여기
     *  useRef·useState 에 흩어져 있던 일곱 조각이 unit 객체 하나가 됐고, 그래서
     *  화면도 헤드리스도 같은 함수를 부른다.
     */
    if (running) {
      runCart(unit.current, {
        path, stations, cart, capacity, topUp, oneWay,
        /* 앞차의 자리는 최대 한 프레임 묵은 값이다(형제들이 차례로 돈다).
           한 프레임은 길어야 0.1 시뮬초라 간격 여유 안에서 흡수된다. */
        fleet: fleet?.current,
        gap, floor, gates, shipOutside,
      }, dt);

      /* 옮긴 자리를 형제들에게 알린다 — 이 값 하나로 서로 간격을 잰다 */
      if (fleet) fleet.current[index] = { s: unit.current.s, dir: unit.current.dir };

      /* 실은 것이 바뀌었을 때만 리렌더 — 짐 모형을 다시 쌓아야 하기 때문이다.
         매 프레임 setState 를 걸면 같은 씬의 다른 것들까지 함께 다시 그린다. */
      const held = unit.current.carried;
      if (held.length !== carriedKinds.length) setCarriedKinds(held);
    }

    const fr = path.at(unit.current.s);
    const d = unit.current.dir;
    const tx = fr.tan[0] * d;
    const tz = fr.tan[1] * d;
    g.position.set(fr.pos[0], fr.pos[1] + (cart.y ?? 0), fr.pos[2]);
    /* 모델의 진행축을 이동 방향에 맞춘다. tx·tz 에 이미 진행 방향(d)이 곱해져
       있으므로, 거꾸로 달리면 모델도 저절로 그쪽을 본다. */
    g.rotation.y = axis === 'z' ? Math.atan2(tx, tz) : Math.atan2(-tz, tx);
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

      {/* 적재량 — 눌러 보지 않아도 몇 개를 실었는지 보인다.
          차체 위에 띄우되 화면 픽셀 크기로 그린다(Html) — 도면을 줌 아웃해도
          숫자는 읽혀야 하기 때문이다. 축척에 맞춰 줄어들면 정작 전체를 볼 때
          안 보인다. 채워질수록 색이 짙어져 멀리서는 숫자를 안 읽어도 안다. */}
      {showLoad && (
        <Html
          position={[0, loadLabelY, 0]}
          center
          zIndexRange={[20, 0]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          <div
            style={{
              padding: '1px 6px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1.5,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              color: '#fff',
              background: full ? '#16a34a' : carried > 0 ? '#0284c7' : 'rgba(15,23,42,0.72)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
            }}
          >
            {carried}/{capacity}
          </div>
        </Html>
      )}

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

  /**
   * 한 경로 위 모든 차의 자리 — 서로 겹치지 않으려면 서로를 봐야 한다.
   * -------------------------------------------------------------------------
   *  React 상태로 두면 프레임마다 리렌더가 걸린다(차 한 대가 움직일 때마다
   *  경로·정차역·컨베이어까지 다시 계산된다). 자리는 그리기용 값이 아니라
   *  계산용 값이므로 ref 로 나눠 갖는다.
   */
  const fleet = useRef([]);
  /* 대수를 줄이면 사라진 차의 자리가 남아 유령 앞차가 된다 */
  useEffect(() => { fleet.current.length = count; }, [count]);

  /* 최소 간격은 **차체 길이**가 바탕이다 — 두 대가 붙어 설 수 있는 가장 짧은
     거리가 곧 한 대의 길이다. 트럭(7m 남짓)과 카트(2m 남짓)는 그래서 다르다.
     모델을 아직 못 읽었으면 카트 크기로 어림잡는다. */
  const axis = spec?.connector?.axis ?? 'z';
  const bodyLen = spec?.bbox?.size?.[axis === 'z' ? 2 : 0] ?? 2.2;
  const gap = bodyLen + CART_MARGIN;

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
             출발하면 겹쳐 보이고, 역에서도 동시에 서 버린다.
             거꾸로 달리는 차는 **반대쪽 끝**에서 출발한다. 안 그러면 시작점(0)에
             서서 곧바로 경로 밖으로 나가려다 되돌아서므로, 방향을 뒤집은 것이
             아무 일도 아닌 것이 된다. 고리는 끝이 없으므로 그대로 둔다 —
             제자리에서 반대로 돌기 시작하면 그만이다. */
          startS={cart.reverse && !cart.closed
            ? path.length - (k / count) * path.length
            : (k / count) * path.length}
          shipOutside={shipOutside}
          floor={floor}
          gates={gates}
          oneWay={shipOutside && !cart.closed}
          fleet={fleet}
          index={k}
          gap={gap}
          onPointerDown={onPointerDown}
        />
      ))}
    </group>
  );
}
