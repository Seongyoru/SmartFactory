/**
 * =============================================================================
 *  작업자 — 설비 옆에 서 있는 사람
 * =============================================================================
 *  사람은 **걸어 다니지 않는다**(crew.js 참고). 설비에 붙는 자원이라, 화면에서
 *  할 일도 하나뿐이다 — **지금 이 설비에 사람이 붙어 있는가**를 보여 주는 것.
 *
 *  그래서 사람이 안 붙은 설비에는 **아무것도 안 그린다.** 회색으로 흐리게 그리는
 *  방법도 있지만, 그러면 "사람이 있는데 뭔가 이상한 상태" 로 읽힌다. 비어 있는
 *  자리가 곧 "사람이 없다" 는 말이고, 그게 그 설비가 왜 서 있는지의 답이다.
 *
 *  ── 모델이 없어도 된다 ───────────────────────────────────────────────────
 *  `public/models/Worker.glb` 가 있으면 그걸 쓰고, 없으면 절차적으로 그린다.
 *  선반(`Shelf.glb`)이 쓰는 것과 같은 방식이다 — 모델을 기다리느라 기능을 막을
 *  이유가 없고, 나중에 파일만 넣으면 그때부터 그쪽이 나온다.
 *
 *  사람 모형은 **얼굴도 팔다리도 없다.** 도면 위의 0.4m 짜리 물체라 어차피 안
 *  보이고, 사람 모양을 흉내 낼수록 "이 사람이 무엇을 하는지" 를 그림이 말하는
 *  것처럼 보인다 — 우리는 그걸 모른다. 서 있다는 것만 말한다.
 * ---------------------------------------------------------------------------
 */

import React, { useMemo } from 'react';
import { cloneScene, useModelMissing, useModelSpec } from '../core/modelStore.js';

/** 작업자 모델 — 없어도 된다(`optional`). 있으면 절차적 모형 대신 이걸 쓴다 */
export const WORKER_ITEM = {
  id: '__WORKER',
  name: '작업자',
  modelKey: '/models/Worker.glb',
  url: '/models/Worker.glb',
  optional: true,
};

const BODY = '#f8fafc';       // 작업복 — 바닥·설비와 안 겹치는 밝은 색
const VEST = '#f59e0b';       // 안전조끼 — 멀리서 사람을 찾게 해 주는 색
const HEAD = '#fbbf24';       // 안전모

/** 사람 하나의 크기(m) — 실제 치수에 맞춘다. 도면에서 축척감의 기준이 된다 */
const H = { body: 1.15, bodyR: 0.19, head: 0.13, headY: 1.42, vest: 0.42, vestR: 0.205 };

/** 몇 명이 서 있든 서로 안 겹치게 벌려 세우는 간격(m) */
const SPREAD = 0.55;

/* --------------------------------------------------------------------------
 * 절차적 사람 — 모델이 없을 때
 * ------------------------------------------------------------------------ */
function ProceduralWorker() {
  return (
    <group>
      {/* 몸통 */}
      <mesh position={[0, H.body / 2, 0]} castShadow>
        <capsuleGeometry args={[H.bodyR, H.body - H.bodyR * 2, 4, 12]} />
        <meshStandardMaterial color={BODY} roughness={0.85} />
      </mesh>
      {/* 안전조끼 — 몸통보다 아주 조금 굵게 둘러 겹침(z-fighting)을 피한다 */}
      <mesh position={[0, H.body * 0.62, 0]} castShadow>
        <cylinderGeometry args={[H.vestR, H.vestR, H.vest, 12, 1, true]} />
        <meshStandardMaterial color={VEST} roughness={0.7} side={2} />
      </mesh>
      {/* 안전모 */}
      <mesh position={[0, H.headY, 0]} castShadow>
        <sphereGeometry args={[H.head, 14, 10]} />
        <meshStandardMaterial color={HEAD} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** 설비 옆면에서 이만큼 떨어져 선다(m) */
const STANDOFF = 0.7;

/**
 * 설비 한 대에 붙은 작업자들.
 * ---------------------------------------------------------------------------
 *  **옆면(로컬 +X)에 선다.** 설비의 유입·유출 포트는 앞뒤(Z)에 붙어 있어서 그쪽은
 *  컨베이어가 차지한다 — 앞에 세우면 벨트를 뚫고 서 있는 그림이 된다.
 *  여럿이면 옆면을 따라 앞뒤로 벌려 세운다.
 *
 *  @param at    설비 중심 [x, z] (월드)
 *  @param rot   설비 회전(0~3). 사람도 함께 돌아 늘 같은 면에 붙는다
 *  @param halfX 설비 폭의 절반(로컬 X). 이만큼 나가서 STANDOFF 만큼 더 물러선다
 *  @param count 몇 명 (0 이면 아무것도 안 그린다)
 */
export default function WorkerView({ at, rot = 0, halfX = 1.5, count = 0, y = 0 }) {
  const spec = useModelSpec(WORKER_ITEM);
  const missing = useModelMissing(WORKER_ITEM);

  /* 모델은 한 번 복제해 두고 여러 명이 나눠 쓴다 — 사람 수는 자주 안 바뀐다 */
  const models = useMemo(() => {
    if (!spec || count <= 0) return null;
    return Array.from({ length: count }, () => cloneScene(spec));
  }, [spec, count]);

  if (count <= 0) return null;
  if (!spec && !missing) return null;                 // 아직 읽는 중 — 잠깐 비워 둔다

  /* 여럿이면 옆면을 따라 앞뒤(로컬 Z)로 벌려 세운다 */
  const x = halfX + STANDOFF;
  const offsets = Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * SPREAD);

  return (
    <group position={[at[0], y, at[1]]} rotation={[0, (rot * Math.PI) / 2, 0]}>
      {offsets.map((dz, i) => (
        /* 설비 쪽을 보게 돌려 세운다 — 등을 돌리고 서 있으면 어느 설비에 붙은
           사람인지가 안 읽힌다 */
        <group key={i} position={[x, 0, dz]} rotation={[0, -Math.PI / 2, 0]}>
          {models ? <primitive object={models[i]} /> : <ProceduralWorker />}
        </group>
      ))}
    </group>
  );
}
