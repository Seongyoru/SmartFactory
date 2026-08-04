/**
 * =============================================================================
 *  포트 마커 — 유입/유출부를 눈에 보이게
 * =============================================================================
 *  연결 모드에서만 뜬다. 화살표가 "자재가 흐르는 방향" 을 가리킨다.
 *    초록 = 유입(IN) · 주황 = 유출(OUT) · 하늘 = 미지정(양방향)
 *  점선 테두리(자동 생성 포트)는 모델에 포트가 정의돼 있지 않아 bbox 로
 *  추정한 것이라는 뜻이다 — 모델에 포트를 심으면 실선이 된다.
 * ---------------------------------------------------------------------------
 */

import React from 'react';

const COLORS = { in: '#34d399', out: '#fb923c', any: '#38bdf8' };

function Marker({ port, active, dimmed, blocked, onClick }) {
  const [dx, dz] = port.dir;
  const yaw = Math.atan2(-dz, dx);
  const color = active ? '#ffffff' : blocked ? '#64748b' : COLORS[port.kind] ?? COLORS.any;
  const s = active ? 1.35 : blocked ? 0.7 : 1;
  const fade = blocked ? 0.18 : dimmed ? 0.35 : 0.95;

  return (
    <group position={port.world} rotation={[0, yaw, 0]}>
      {/* 화살촉 (원뿔의 기본 방향 +Y 를 +X 로 눕힌다) */}
      <mesh rotation={[0, 0, -Math.PI / 2]} scale={s} renderOrder={9}>
        <coneGeometry args={[0.18, 0.5, 12]} />
        <meshBasicMaterial color={color} transparent opacity={fade} depthTest={false} />
      </mesh>
      {/* 포트 위치 표시 링 */}
      <mesh position={[-0.28, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={9}>
        <ringGeometry args={[0.16, 0.24, 16]} />
        <meshBasicMaterial color={color} transparent opacity={blocked ? 0.15 : dimmed ? 0.3 : 0.8} depthTest={false} />
      </mesh>
      {/* 자동 추정 포트는 흐린 점선 느낌으로 한 겹 더 */}
      {!port.explicit && !blocked && (
        <mesh position={[-0.28, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={8}>
          <ringGeometry args={[0.3, 0.34, 16, 1, 0, Math.PI * 1.2]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} depthTest={false} />
        </mesh>
      )}
      {/* 클릭 판정 (넉넉하게) — 보이지 않게 하되 레이캐스트는 살려 둔다 */}
      {onClick && (
        <mesh onClick={onClick}>
          <sphereGeometry args={[0.6, 8, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/**
 * @param accept 연결 가능한 포트만 걸러내는 술어. 연결을 그리는 중이면
 *               이을 수 없는 포트(유입↔유입 등)를 회색으로 죽여서
 *               "여기는 안 된다" 를 클릭 전에 보여 준다.
 */
export default function PortMarkers({ ports, activeKey, accept, onPick }) {
  return (
    <group>
      {ports.map((p) => {
        const blocked = accept ? !accept(p) : false;
        return (
          <Marker
            key={p.key}
            port={p}
            active={p.key === activeKey}
            dimmed={!!activeKey && p.key !== activeKey}
            blocked={blocked && p.key !== activeKey}
            onClick={onPick && !blocked ? (e) => { e.stopPropagation(); onPick(p); } : undefined}
          />
        );
      })}
    </group>
  );
}
