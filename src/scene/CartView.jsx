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
import {
  CART_MARGIN, followDistance, forgetStation, loadRoom, pickSet, stationStyle, stepCart,
} from '../core/cart.js';
import { simStep } from '../core/clock.js';
import { accumulateCart } from '../core/metrics.js';
import { addLots, addLotsShared, addShipped, getMade, takeLots, takeMade } from '../core/simStore.js';
import { slotShares } from '../core/bom.js';
import { usePayloadSpecs } from '../core/payload.js';
import { inGate, pointInMP } from '../core/area.js';
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
  const sRef = useRef(startS);
  /**
   * 어느 쪽으로 달리는가 (+1 정방향 · −1 역방향).
   * -------------------------------------------------------------------------
   *  `reverse` 는 원래 **모델만 180° 돌려** 놓는 값이었다. 차가 뒤로 가는 것처럼
   *  보이지만 실제로는 그대로 앞으로 갔고, 정차역을 만나는 순서도 그대로였다 —
   *  보이는 것과 도는 것이 달랐다. 이제 **진행 방향 자체**를 뒤집는다.
   *  모델 방향은 진행 방향에서 나오므로(아래 rotation.y) 저절로 따라온다.
   */
  const dirRef = useRef(cart.reverse ? -1 : 1);
  const pauseRef = useRef(0);
  const lastKeyRef = useRef(null);
  /** 그 기억을 남긴 자리 — 충분히 멀어지면 잊는다 (cart.js 의 forgetStation) */
  const lastSRef = useRef(null);
  /** 지금 싣고 있는 짐을 어디서 받았는가 — 같은 곳에 도로 내려놓지 않기 위해 */
  const sourceRef = useRef(null);
  const [carried, setCarried] = useState(0);
  /** 무엇을 싣고 있는가 — 실은 곳에서 따라오고, 내릴 때 그대로 넘긴다 */
  /** 싣고 있는 물건들의 종류 (아래에서부터). 섞어 실으면 섞인 채로 간다 */
  const [carriedKinds, setCarriedKinds] = useState([]);
  const specOf = usePayloadSpecs();

  // 대수가 바뀌면 출발 지점을 다시 나눠 갖는다
  useEffect(() => { sRef.current = startS; }, [startS]);
  /* 첫 프레임 전에도 남들이 내 자리를 볼 수 있어야 한다 — 안 그러면 대수가
     바뀐 직후 한 프레임 동안 서로가 안 보여 겹친 채로 출발한다 */
  useEffect(() => {
    if (fleet) fleet.current[index] = { s: sRef.current, dir: dirRef.current };
  }, [fleet, index, startS]);
  /* 방향을 뒤집으면 곧바로 반영한다 — 다음 바퀴를 기다리지 않는다.
     (고리는 제자리에서 돌아서고, 끝이 있는 경로는 startS 가 반대쪽 끝으로
      바뀌므로 위의 효과가 자리도 함께 옮긴다) */
  useEffect(() => { dirRef.current = cart.reverse ? -1 : 1; }, [cart.reverse]);

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

    if (running) {
      /* 방금 주고받은 역에서 충분히 멀어졌으면 그 기억을 푼다.
         안 그러면 짐이 남은 채 한 바퀴를 돌 때 그 역이 통째로 걸러져,
         자리가 났는데도 서지 않고 지나간다(cart.js 의 forgetStation). */
      lastKeyRef.current = forgetStation(
        lastKeyRef.current, lastSRef.current, sRef.current, path.length, cart.closed,
      );
      if (!lastKeyRef.current) lastSRef.current = null;

      /**
       * 앞차와의 간격 — **속도를 깎아서** 지킨다.
       * ---------------------------------------------------------------------
       *  움직이고 나서 위치를 되밀면 안 된다. 정차역 판정은 "이번 프레임에
       *  s0 → s1 사이를 지났는가" 로 하는데, 지나간 뒤 되밀면 밟지도 않은 역을
       *  들른 것으로 세게 된다. 갈 수 있는 거리를 이번 프레임 시간으로 나눠
       *  **속도 상한**으로 바꿔 주면, 그 뒤 계산은 전부 그대로 맞는다.
       *
       *  앞차의 자리는 최대 한 프레임 묵은 값이다(형제들이 차례로 돈다). 한
       *  프레임은 길어야 0.1 시뮬초라 간격 여유 안에서 흡수된다.
       */
      const me = { s: sRef.current, dir: dirRef.current };
      const speed = cart.speed ?? 1.4;
      let capped = speed;
      if (fleet && gap > 0) {
        const room = followDistance(me, fleet.current, { length: path.length, closed: cart.closed, gap });
        if (room !== Infinity && dt > 1e-6) capped = Math.min(speed, room / dt);
      }
      /**
       * 앞차 때문에 **못 간 몫**을 시간으로 환산해 남긴다.
       * ---------------------------------------------------------------------
       *  완전히 선 것만 세면 "느려졌지만 가긴 갔다" 가 통째로 빠진다. 속도가
       *  절반으로 깎였으면 그 프레임의 절반은 못 간 것이다 — 잃은 거리를 원래
       *  속도로 나누면 그대로 잃은 시간이 된다.
       *
       *  정차(dwell)는 안 센다. 역에 서서 주고받은 시간은 **일을 한** 시간이고
       *  여기서 세는 것은 **아무것도 못 한** 시간이다(metrics 의 accumulateCart).
       */
      if (speed > 0 && pauseRef.current <= 0) {
        accumulateCart(cart.uid, dt, dt * (1 - capped / speed));
      }

      const next = stepCart(
        { s: sRef.current, dir: dirRef.current, pause: pauseRef.current, lastKey: lastKeyRef.current },
        {
          length: path.length,
          closed: cart.closed,
          oneWay,
          speed: capped,
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
        lastSRef.current = null;
      }
      sRef.current = next.s;
      dirRef.current = next.dir;
      pauseRef.current = next.pause;
      /* 옮긴 자리를 형제들에게 알린다 — 이 값 하나로 서로 간격을 잰다 */
      if (fleet) fleet.current[index] = { s: next.s, dir: next.dir };

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
          /**
           * 싣기.
           * -------------------------------------------------------------------
           *  카트는 **비어 있을 때만** 싣는다. 한 곳에서 받아 다른 곳에 옮기는
           *  것이 카트의 일이라, 가는 길에 이것저것 주워 담으면 어디에 무엇을
           *  내려놓아야 하는지가 흐려진다.
           *
           *  트럭은 반대다. 하는 일이 "밖으로 내보내기" 하나뿐이라 목적지가
           *  갈리지 않는다. 첫 역에서 다 못 채웠는데 그대로 나가면 반쯤 빈 차가
           *  왕복하게 되므로, **자리가 남는 동안 다음 역에서 마저 채운다.**
           */
          const room = loadRoom(carried, capacity, topUp, cart.loadCount ?? a.dispatch ?? 0);
          if (room > 0) {
            /* 무엇을 가져올지 정해 두었으면 **그 종류만** 골라 온다.
               선반에는 여러 종류가 섞여 쌓이므로, 정해 두지 않으면 위에 있던
               것이 잡히는 대로 실린다 — 필요한 것만 나르려면 골라야 한다. */
            const got = takeLots(a.uid, room, pickSet(cart));
            if (got.length > 0) {
              setCarried(carried + got.length);
              setCarriedKinds([...carriedKinds, ...got]);
              sourceRef.current = a.uid;
              acted = true;
            }
          }
        } else if (a.kind === 'load') {
          /* 설비에서 싣는 것도 마찬가지다 — "이 종류만 나른다" 고 정해 둔
             카트는 다른 것을 만드는 설비 앞을 그냥 지나간다. */
          let take = Math.min(a.count, loadRoom(carried, capacity, topUp, a.count));
          /**
           * **만들어 놓은 것만 실어 간다.**
           * -------------------------------------------------------------------
           *  예전에는 여기서 재료를 내고 그 자리에서 만들었다 — "가지러 온 만큼
           *  만든다". 공정 시간이 없던 시절에는 그게 유일한 방법이었지만, 그래서
           *  카트만 드나드는 설비는 **시간이 0** 이었다. 카트가 30개를 요구하면
           *  30개가 그 순간 튀어나왔다.
           *
           *  이제 만드는 것은 SimClock 이 공정 시간대로 하고, 카트는 벨트와 똑같이
           *  출력 자리에 쌓인 것만 가져간다(EditorScene 의 onSpawn 과 같은 규칙).
           */
          take = Math.min(take, getMade(a.uid));
          /* 고른 종류들 중 하나여야 싣는다. 아무것도 안 골랐으면 가리지 않는다.
             (옛 이름으로 적힌 도면도 pickSet 이 지금 이름으로 바꿔 준다) */
          const want = pickSet(cart);
          if (take > 0 && (!want.size || want.has(a.payloadKind))) {
            const got = takeMade(a.uid, take);
            if (got > 0) {
              setCarried(carried + got);
              setCarriedKinds([...carriedKinds, ...Array.from({ length: got }, () => a.payloadKind)]);
              sourceRef.current = a.uid;
              acted = true;
            }
          }
        } else if (a.kind === 'unload') {
          /**
           * 설비 유입부에 내려놓기.
           * ---------------------------------------------------------------------
           *  레시피가 있는 설비에는 **실제로 쌓인다** — 그것이 그 설비의 재료다.
           *  다만 **쓰는 종류만** 받는다. 안 쓰는 것을 받아 두면 그 자리는 영영
           *  안 빠지고, 정작 필요한 재료가 들어올 자리가 없어져 라인이 조용히
           *  선다(무엇이 잘못됐는지 화면에 아무 단서도 안 남는다).
           *
           *  레시피가 없는 설비에서는 예전 그대로 **사라진다.** 안 먹는 설비에
           *  쌓아 둘 이유가 없고, 이미 그린 도면이 갑자기 다르게 굴러도 안 된다.
           */
          if (carried > 0 && a.recipe) {
            /* 자리는 **종류마다** 정해져 있다 — 안 쓰는 종류는 몫이 0 이라
               저절로 걸러지고, 쓰는 종류도 제 몫이 차면 더 못 넣는다.
               못 넣은 것은 그대로 싣고 다음 자리로 간다(bom.js 의 slotShares). */
            const slots = slotShares(a.recipe, a.capacity);
            const { moved, left } = addLotsShared(a.uid, carriedKinds, (k) => slots[k] ?? 0);
            if (moved > 0) {
              setCarried(left.length);
              setCarriedKinds(left);
              if (!left.length) sourceRef.current = null;
              acted = true;
            }
          } else if (carried > 0) {
            setCarried(0); setCarriedKinds([]); sourceRef.current = null; acted = true;
          }
        }

        if (acted) {
          lastKeyRef.current = a.key ?? a.uid;
          lastSRef.current = sRef.current;
        } else {
          pauseRef.current = 0;         // 아무 일도 없었으면 서 있을 이유도 없다
        }
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
      /* 무엇이 나갔는지까지 넘긴다 — 총량만 세면 라인이 한쪽으로 치우쳐도 모른다 */
      addShipped(carriedKinds);
      setCarried(0);
      setCarriedKinds([]);
      sourceRef.current = null;
      lastKeyRef.current = null;      // 밖에 다녀왔으니 다시 실을 수 있다
      lastSRef.current = null;
    }
    /* 모델의 진행축을 이동 방향에 맞춘다.
       tx·tz 에 이미 진행 방향(d)이 곱해져 있으므로, 거꾸로 달리면 모델도 저절로
       그쪽을 본다 — 방향과 모델이 따로 놀 수 없다. */
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
