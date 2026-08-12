/**
 * =============================================================================
 *  설비 옆 재고 표시 — 누르지 않고도 안이 보인다
 * =============================================================================
 *  조립 설비가 왜 서 있는지는 **버퍼 안을 봐야** 안다. 그런데 그걸 보려면 설비를
 *  하나씩 눌러 인스펙터를 열어야 했다. 라인이 열 대면 열 번 눌러야 원인을 찾는다.
 *
 *  자재가 어디서 막혔는지는 **도면을 훑으면서** 알아야 하는 종류의 정보다.
 *  그래서 설비 옆에 늘 띄운다.
 *
 *  ── 무엇을 띄우고 무엇을 안 띄우는가 ─────────────────────────────────────
 *  종류 색 점과 「가진 수 / 제 몫」만 띄운다. 이름은 안 쓴다 — 색이 이미 목록·
 *  벨트 위 물건과 같은 색이라 이름을 또 적으면 길어지기만 한다.
 *
 *  **재료를 먹는 설비만** 띄운다. 원자재 공급원은 버퍼가 없고, 적치대·선반은
 *  자기 몸에 물건이 쌓이는 게 이미 보인다.
 *
 *  ── 화면 픽셀 크기로 그린다 ──────────────────────────────────────────────
 *  drei 의 `Html` 로 그려 축척과 무관하게 같은 크기를 유지한다. 3D 로 된 글자를
 *  쓰면 도면을 줌 아웃했을 때 — 즉 **여러 대를 한눈에 훑을 때** — 안 보인다.
 *  정작 필요한 순간에 사라지는 셈이다.
 * ---------------------------------------------------------------------------
 */

import React from 'react';
import { Html } from '@react-three/drei';
import { PAYLOAD_ITEMS } from '../data/library.js';
import { useLots } from '../core/simStore.js';
import { countKinds } from '../core/bom.js';

export default function StockTag({ at, y = 0, height = 4, slots, starved = false }) {
  const lots = useLots(at.uid);
  const have = countKinds(lots);

  const keys = Object.keys(slots ?? {});
  if (!keys.length) return null;

  return (
    <Html
      position={[at.pos[0], y + height + 0.35, at.pos[1]]}
      center
      zIndexRange={[18, 0]}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      <div
        className={`flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums shadow ${
          starved ? 'bg-rose-500/90 text-white' : 'bg-black/65 text-white/90'
        }`}
      >
        {keys.map((k) => {
          const n = have[k] ?? 0;
          const cap = slots[k];
          return (
            <span key={k} className="flex items-center gap-0.5">
              <span
                className="inline-block h-2 w-2 rounded-[2px] ring-1 ring-white/25"
                style={{ background: PAYLOAD_ITEMS[k]?.color ?? '#94a3b8' }}
              />
              {/* 0 은 흐리게 — "이게 안 오고 있다" 가 굶는 이유일 때가 많고,
                  그 자리가 한눈에 띄어야 한다 */}
              <span className={n === 0 ? 'text-rose-300' : ''}>{n}</span>
              <span className="text-white/40">/{cap}</span>
            </span>
          );
        })}
      </div>
    </Html>
  );
}
