/**
 * =============================================================================
 *  선반(랙) — 형상 + 적재된 자재
 * =============================================================================
 *  칸 수 · 한 칸 길이 · 단 수 · 단 간격을 모두 사용자가 정하므로, 모델을 통째로
 *  복제해서는 만들 수 없다(모델에는 3단이 구워져 있다). 그래서 모델을
 *  **판 한 장과 기둥** 으로 분해해서 필요한 만큼 다시 쌓는다.
 *
 *    기둥 — 칸 경계마다 하나. 필요한 높이에 맞춰 Y 로 늘인다
 *    판   — (칸 × 단) 개수만큼 복제해서 각 단 높이에 놓는다
 *
 *  이렇게 하면 이음매마다 기둥이 하나만 남고(모델을 통째로 복제하면 두 개가
 *  겹친다), 단 수를 모델과 다르게 잡아도 형상이 따라온다.
 *
 *  모델이 없으면 같은 규칙으로 상자를 그린다 — 배치와 적재를 그대로 확인할 수
 *  있어야 하기 때문이다.
 * ---------------------------------------------------------------------------
 */

import React, { useEffect, useMemo } from 'react';
import { cloneScene, useModelMissing, useModelSpec } from '../core/modelStore.js';

import { clampStock, useLots, useStock } from '../core/simStore.js';
import { usePayloadSpecs } from '../core/payload.js';
import { rotToRad } from '../core/grid.js';
import {
  FALLBACK,
  bayLength,
  levelY,
  shelfBays,
  shelfCapacity,
  shelfHeight,
  shelfLength,
  shelfLevelCount,
  shelfSpec,
  shelfZones,
  slotPosition,
  payloadWidth,
} from '../core/shelf.js';
import { NO_PICK, SHELF_BAND_COLOR } from './ZoneMarks.jsx';

const FRAME_COLOR = '#64748b';
const BOARD_COLOR = '#94a3b8';

/* --------------------------------------------------------------------------
 * 모델 랙 — 판과 기둥으로 분해해서 다시 쌓는다
 * ------------------------------------------------------------------------ */
function ModelRack({ spec, placed, ghost }) {
  const s = shelfSpec(spec);
  const bays = shelfBays(placed);
  const levels = shelfLevelCount(placed);
  const B = bayLength(placed, spec);
  const L = shelfLength(placed, spec);
  const kx = B / s.pitch;                       // 한 칸 길이를 바꾼 만큼 가로로 늘인다
  const ky = shelfHeight(placed, spec) / s.postHeight;

  /* 원본에서 판 한 장과 기둥을 떼어 낸다 (모델당 한 번) */
  const parts = useMemo(() => {
    const src = cloneScene(spec, { cloneMaterials: ghost });
    let board = null;
    const posts = [];
    src.traverse((n) => {
      if (n.name === s.boardName) board = n;
      else if (s.postNames?.includes(n.name)) posts.push(n);
    });
    [board, ...posts].forEach((n) => n?.parent?.remove(n));
    if (ghost) {
      [board, ...posts].forEach((n) =>
        n?.traverse((m) => {
          if (!m.isMesh || !m.material) return;
          m.material.transparent = true;
          m.material.opacity = 0.55;
          m.material.depthWrite = false;
        }),
      );
    }
    return { board, post: posts[0] ?? null };
  }, [spec, ghost, s.boardName, s.postNames]);

  /* 기둥 — 칸 경계마다 하나 (칸 수 + 1) */
  const postNodes = useMemo(() => {
    if (!parts.post) return [];
    return Array.from({ length: bays + 1 }, (_, i) => {
      const o = parts.post.clone(true);
      o.position.set(-L / 2 + i * B, 0, parts.post.position.z);
      o.scale.set(1, ky, 1);
      return o;
    });
  }, [parts.post, bays, B, L, ky]);

  /* 판 — 칸 × 단 */
  const boardNodes = useMemo(() => {
    if (!parts.board) return [];
    const out = [];
    for (let lv = 0; lv < levels; lv++) {
      for (let b = 0; b < bays; b++) {
        const o = parts.board.clone(true);
        o.position.set(
          -L / 2 + B * (b + 0.5),
          parts.board.position.y + (levelY(lv, placed, spec) - s.boardTop),
          parts.board.position.z,
        );
        o.scale.set(kx, 1, 1);
        out.push(o);
      }
    }
    return out;
  }, [parts.board, bays, levels, B, L, kx, placed.levelGap, placed.bayLength, spec, s.boardTop]);

  return (
    <group>
      {postNodes.map((o, i) => <primitive key={`p${i}`} object={o} />)}
      {boardNodes.map((o, i) => <primitive key={`b${i}`} object={o} />)}
    </group>
  );
}

/* --------------------------------------------------------------------------
 * 절차적 랙 — 모델이 없을 때
 * ------------------------------------------------------------------------ */
function ProceduralRack({ placed, ghost }) {
  const bays = shelfBays(placed);
  const levels = shelfLevelCount(placed);
  const B = bayLength(placed, null);
  const L = shelfLength(placed, null);
  const { depth, boardThickness, postSize } = FALLBACK;
  const topY = shelfHeight(placed, null);
  const opacity = ghost ? 0.55 : 1;

  return (
    <group>
      {Array.from({ length: bays + 1 }, (_, i) => -L / 2 + i * B).map((x, i) =>
        [-1, 1].map((side) => (
          <mesh key={`${i}_${side}`} position={[x, topY / 2, (side * (depth - postSize)) / 2]} castShadow>
            <boxGeometry args={[postSize, topY, postSize]} />
            <meshStandardMaterial color={FRAME_COLOR} metalness={0.5} roughness={0.6} transparent={ghost} opacity={opacity} />
          </mesh>
        )),
      )}
      {Array.from({ length: levels }, (_, lv) => (
        <mesh key={lv} position={[0, levelY(lv, placed, null) - boardThickness / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[L, boardThickness, depth]} />
          <meshStandardMaterial color={BOARD_COLOR} metalness={0.35} roughness={0.7} transparent={ghost} opacity={opacity} />
        </mesh>
      ))}
    </group>
  );
}

/* --------------------------------------------------------------------------
 * 적재된 자재
 * ------------------------------------------------------------------------ */
function StoredItems({ placed, spec, count }) {
  /* 자리마다 무엇이 놓였는지는 재고가 기억한다 — 카트가 섞어 부리면
     섞인 채로 쌓여야 한다(하나로 뭉뚱그리면 전체 색이 한꺼번에 바뀐다). */
  const lots = useLots(placed.uid);
  const specOf = usePayloadSpecs();
  /* 적재수는 shelf.js 에 등록된 자재 폭 하나로만 계산한다. 여기서 따로 재면
     인스펙터가 적은 개수와 실제로 그리는 개수가 어긋난다(34 vs 35). */
  const width = payloadWidth();

  const items = useMemo(() => {
    if (count <= 0) return [];
    const cap = shelfCapacity(placed, spec);
    const out = [];
    for (let i = 0; i < Math.min(count, cap); i++) {
      const s = specOf(lots[i]);
      if (!s) continue;                        // 아직 못 읽은 모델은 건너뛴다
      out.push({ obj: cloneScene(s), pos: slotPosition(i, placed, spec) });
    }
    return out;
  }, [lots, specOf, count, placed.bays, placed.levels, placed.bayLength, placed.levelGap, placed.perLevel, spec, width]);

  return (
    <group>
      {items.map(({ obj, pos }, i) => (
        <primitive key={i} object={obj} position={pos} />
      ))}
    </group>
  );
}

/* ========================================================================== */

export default function ShelfView({
  placed,
  item,
  selected = false,
  ghost = false,
  valid = true,
  onPointerDown,
}) {
  const spec = useModelSpec(item);
  const missing = useModelMissing(item);
  const stock = useStock(placed.uid);

  const useModel = !!spec?.shelf && !missing;
  const modelSpec = useModel ? spec : null;
  const capacity = shelfCapacity(placed, modelSpec);
  const zones = useMemo(
    () => shelfZones(placed, modelSpec),
    [placed.bays, placed.bayLength, modelSpec],
  );

  /**
   * 그릴 띠 — 한 면에 한 줄.
   * -------------------------------------------------------------------------
   *  shelfZones 는 앞뒤 면을 다시 반씩(입고·출고) 쪼개 넷을 준다. 그 구분은
   *  카트가 역할을 정하지 않았을 때의 기본값을 고르는 데에만 쓰이고, 화면에서는
   *  의미가 없다 — 색이 같으니 어차피 한 줄로 보인다. 같은 면끼리 합쳐 두면
   *  "앞면 전체가 하나의 역" 이라는 지금 규칙이 형상에서도 그대로 읽히고,
   *  맞닿은 두 판이 만드는 이음매도 남지 않는다.
   */
  const bands = useMemo(() => {
    const bySide = new Map();
    for (const z of zones) {
      const key = z.cz.toFixed(4);
      const lo = z.cx - z.w / 2;
      const hi = z.cx + z.w / 2;
      const cur = bySide.get(key);
      if (!cur) bySide.set(key, { cz: z.cz, d: z.d, lo, hi });
      else { cur.lo = Math.min(cur.lo, lo); cur.hi = Math.max(cur.hi, hi); }
    }
    return [...bySide.values()].map((b) => ({ cx: (b.lo + b.hi) / 2, cz: b.cz, w: b.hi - b.lo, d: b.d }));
  }, [zones]);

  /* 길이·단수를 줄이면 수용량이 줄어든다. 남아 있던 재고가 그보다 많으면
     "54 / 27" 같은 값이 남으므로 여기서 잘라 낸다. */
  useEffect(() => {
    if (!ghost) clampStock(placed.uid, capacity);
  }, [ghost, placed.uid, capacity]);

  return (
    <group
      position={[placed.pos[0], placed.y ?? 0, placed.pos[1]]}
      rotation={[0, rotToRad(placed.rot), 0]}
      onPointerDown={ghost ? undefined : onPointerDown}
    >
      {useModel ? (
        <ModelRack spec={spec} placed={placed} ghost={ghost} />
      ) : (
        <ProceduralRack placed={placed} ghost={ghost} />
      )}

      {!ghost && <StoredItems placed={placed} spec={modelSpec} count={stock} />}

      {/* 입출고 띠 — 앞뒤 양면에 한 줄씩, **한 가지 색**.
          싣는 곳인지 내리는 곳인지는 카트가 역마다 정하므로(cart.roles) 선반
          쪽에서는 단정하지 않는다. 실제로 무엇을 하는지는 경로 위의 정차역 링이
          보여 준다. 카트 경로를 그릴 때 보이도록 늘 표시한다. */}
      {bands.map((z, i) => (
        <mesh
          key={i}
          position={[z.cx, 0.02, z.cz]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={3}
          raycast={NO_PICK}
        >
          <planeGeometry args={[z.w, z.d]} />
          <meshBasicMaterial
            color={ghost ? (valid ? '#22d3ee' : '#f43f5e') : SHELF_BAND_COLOR}
            transparent
            opacity={selected ? 0.6 : 0.35}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
