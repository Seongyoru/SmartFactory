/**
 * =============================================================================
 *  설비 옆 표시 — 누르지 않고도 안이 보인다
 * =============================================================================
 *  설비가 왜 서 있는지는 **안을 봐야** 안다. 그런데 그걸 보려면 설비를 하나씩
 *  눌러 인스펙터를 열어야 했다. 라인이 열 대면 열 번 눌러야 원인을 찾는다.
 *  자재가 어디서 막혔는지는 **도면을 훑으면서** 알아야 하는 종류의 정보다.
 *
 *  두 가지를 띄운다.
 *
 *    진행 게이지   **다음 덩어리가 나갈 때까지** — 1초/개 × 3층이면 3초짜리다
 *    ● 2/12       무슨 재료가 몇 개 있는가 (제 몫 대비)
 *
 *  다 만들어 놓고 기다리는 **개수는 안 적는다.** 게이지가 가득 찬 것이 곧 그 뜻이고,
 *  숫자로 적으면 자리가 「덩어리 + 한 개」 라 `3/9` 같은 어중간한 값이 된다 —
 *  그 +1 은 벨트 박자를 흡수하려고 둔 여유칸이지 사용자가 정한 값이 아니다.
 *
 *  ── 게이지는 리렌더 없이 그린다 ──────────────────────────────────────────
 *  진행률은 프레임마다 바뀐다. 상태로 들고 있으면 설비 한 대당 초당 60번 리렌더가
 *  걸린다. 그래서 `useFrame` 안에서 **DOM 노드의 width 만 직접 만진다** — React
 *  는 이 변화를 아예 모른다. (`useFrame` 은 r3f 트리에 있는 이 컴포넌트가 부르고,
 *  ref 는 포털 너머의 노드를 가리킨다 — 포털도 ref 는 그대로 통한다)
 *
 *  ── 화면 픽셀 크기로 그린다 ──────────────────────────────────────────────
 *  drei 의 `Html` 로 그려 축척과 무관하게 같은 크기를 유지한다. 3D 로 된 글자를
 *  쓰면 도면을 줌 아웃했을 때 — 즉 **여러 대를 한눈에 훑을 때** — 안 보인다.
 *  정작 필요한 순간에 사라지는 셈이다.
 * ---------------------------------------------------------------------------
 */

import React, { useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { PAYLOAD_ITEMS } from '../data/library.js';
import { getMade, useLots, useMade } from '../core/simStore.js';
import { countKinds } from '../core/bom.js';
import { bundleProgress } from '../core/process.js';

export default function StockTag({
  at,
  y = 0,
  height = 4,
  slots = null,
  starved = false,
  cycleSec = 0,
  per = 0,
  cap = 0,
}) {
  const lots = useLots(at.uid);
  const made = useMade(at.uid);
  const fill = useRef(null);

  /**
   * 게이지 — **다음 덩어리가 나갈 때까지**를 잰다.
   * -------------------------------------------------------------------------
   *  한 개짜리로 재면 3층 설비의 게이지가 세 번 차올랐다 떨어지는 동안 벨트로는
   *  아무것도 안 나간다. 1초/개 × 3층이면 **3초짜리 게이지**가 맞다.
   *
   *  `made` 는 여기서 직접 읽는다 — 프레임마다 도는 자리라 리렌더를 기다리면
   *  게이지가 한 박자씩 늦는다.
   */
  useFrame(() => {
    const el = fill.current;
    if (!el) return;
    el.style.width = `${(bundleProgress(at.uid, per, getMade(at.uid)) * 100).toFixed(1)}%`;
  });

  const have = countKinds(lots);
  const keys = Object.keys(slots ?? {});
  /** 만들어 놓을 자리가 다 찼다 = 아무도 안 가져가서 서 있다 */
  const full = cap > 0 && made >= cap;

  return (
    <Html
      position={[at.pos[0], y + height + 0.35, at.pos[1]]}
      center
      zIndexRange={[18, 0]}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      <div
        className={`w-max rounded px-1.5 py-0.5 shadow ${
          starved ? 'bg-rose-500/90' : 'bg-black/65'
        }`}
      >
        {/* 진행 게이지 — 사출 타이밍이 눈으로 보인다.
            공정이 길수록 이게 유일한 "돌고 있다" 는 신호다. */}
        {cycleSec > 0 && (
          <div className="mb-0.5 h-[3px] w-full min-w-[44px] overflow-hidden rounded-full bg-white/25">
            <div
              ref={fill}
              className={`h-full rounded-full ${full ? 'bg-amber-400' : 'bg-sky-400'}`}
              style={{ width: '0%' }}
            />
          </div>
        )}

        {/* 재료 칸이 없는 설비(공급원)는 게이지만 남는다 — 빈 줄을 안 만든다 */}
        {keys.length > 0 && (
        <div className="flex items-center gap-1.5 whitespace-nowrap text-[10px] font-medium tabular-nums text-white/90">
          {keys.map((k) => {
            const n = have[k] ?? 0;
            return (
              <span key={k} className="flex items-center gap-0.5">
                <span
                  className="inline-block h-2 w-2 rounded-[2px] ring-1 ring-white/25"
                  style={{ background: PAYLOAD_ITEMS[k]?.color ?? '#94a3b8' }}
                />
                {/* 0 은 흐리게 — "이게 안 오고 있다" 가 굶는 이유일 때가 많고,
                    그 자리가 한눈에 띄어야 한다 */}
                <span className={n === 0 ? 'text-rose-300' : ''}>{n}</span>
                <span className="text-white/40">/{slots[k]}</span>
              </span>
            );
          })}

        </div>
        )}
      </div>
    </Html>
  );
}
