/**
 * =============================================================================
 *  입출고 구역 표시 — 바닥에 깔리는 녹색/주황 면
 * =============================================================================
 *  카트 경로를 그릴 때 "여기로 지나가면 자재가 오간다" 를 미리 보여 준다.
 *  선택해야만 보이면 경로를 그리는 도중에는 알 수가 없으므로 늘 켜 둔다.
 *
 *    녹색  입고 — 자재가 들어가는 곳 (카트가 내려놓는다 / 설비가 받는다)
 *    주황  출고 — 자재가 나오는 곳 (카트가 실어 간다 / 설비가 내보낸다)
 *
 *  바닥에 눕혀 놓고 depthTest 를 끄기 때문에 탑뷰에서 설비·선반에 가려지지
 *  않는다. 대신 렌더 순서를 낮게 잡아 선택 표시나 고스트보다는 아래에 깔린다.
 * ---------------------------------------------------------------------------
 */

import React from 'react';

export const ZONE_IN_COLOR = '#34d399';
export const ZONE_OUT_COLOR = '#fb923c';

/**
 * 레이캐스트에서 빼는 함수.
 *  구역 표시는 "여기로 지나가면 자재가 오간다" 를 알려 주는 안내일 뿐인데,
 *  클릭을 가로채면 그 위에 카트 경유점을 찍을 수 없다. 정작 경로를 그려야 하는
 *  자리가 막히므로 픽킹 대상에서 제외한다.
 */
export const NO_PICK = () => null;

/**
 * @param zones [{ kind:'in'|'out', center:[x,z], size:[w,d], rot }]
 *              center/size 는 월드 기준, rot 은 0..3 회전
 */
export default function ZoneMarks({ zones, opacity = 0.35, y = 0.02 }) {
  return (
    <group>
      {zones.map((z, i) => (
        <mesh
          key={i}
          position={[z.center[0], y, z.center[1]]}
          rotation={[-Math.PI / 2, 0, -(z.rot ?? 0) * (Math.PI / 2)]}
          renderOrder={3}
          /* 안내용 표시일 뿐이므로 클릭을 가로채지 않는다 */
          raycast={NO_PICK}
        >
          <planeGeometry args={[z.size[0], z.size[1]]} />
          <meshBasicMaterial
            color={z.kind === 'in' ? ZONE_IN_COLOR : ZONE_OUT_COLOR}
            transparent
            opacity={opacity}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
