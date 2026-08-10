/**
 * =============================================================================
 *  구역 레이어 — 캔버스 오른쪽 아래에 떠 있는 목록
 * =============================================================================
 *  구역은 바닥을 통째로 덮는 큰 면이라 씬에서 클릭을 받게 두면 그 위의 설비를
 *  고르려다 번번이 구역이 잡힌다. 그래서 씬에서는 **아예 픽킹을 끄고**, 고르고
 *  숨기고 지우는 일은 전부 여기서 한다.
 *
 *  포토샵의 레이어 창과 같은 감각으로 둔다 — 눈 아이콘으로 잠깐 감추고, 이름을
 *  눌러 고르고, 휴지통으로 지운다. 구역이 하나도 없으면 화면에 뜨지 않는다.
 * ---------------------------------------------------------------------------
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Layers, Trash2 } from 'lucide-react';
import { useEditor } from '../core/store.jsx';
import { focusOn } from '../core/focusStore.js';
import { mpLabelPoint } from '../core/area.js';

export default function ZoneLayers() {
  const { state, dispatch } = useEditor();
  const [open, setOpen] = useState(true);
  const zones = state.zones;

  if (!zones.length) return null;

  const sel = state.selected;

  return (
    <div className="absolute bottom-3 right-3 z-10 w-56 overflow-hidden rounded-lg border border-line bg-float shadow-lg backdrop-blur">
      <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
        <Layers size={12} className="text-ink4" />
        {/* 개수는 괄호에 넣는다 — "구역 16" 은 16번 구역으로 읽힌다 */}
        <span className="flex-1 text-[11px] font-semibold text-ink2">구역 ({zones.length})</span>
        <button
          title={state.showZones ? '구역 모두 감추기' : '구역 모두 보이기'}
          onClick={() => dispatch({ type: 'SET', patch: { showZones: !state.showZones } })}
          className="rounded p-0.5 text-ink4 hover:bg-raiseh hover:text-ink2"
        >
          {state.showZones ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded p-0.5 text-ink4 hover:bg-raiseh hover:text-ink2"
        >
          {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
      </div>

      {open && (
        <ul className="max-h-52 overflow-y-auto p-1">
          {zones.map((z) => {
            const active = sel?.kind === 'zone' && sel.uid === z.uid;
            return (
              <li
                key={z.uid}
                className={`group flex items-center gap-1.5 rounded-md px-1.5 py-1 ${
                  active ? 'bg-sky-500/15' : 'hover:bg-raiseh'
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-edge"
                  style={{ background: z.color, opacity: z.hidden ? 0.3 : 1 }}
                />
                <button
                  onClick={() => {
                    dispatch({ type: 'SELECT', selected: { kind: 'zone', uid: z.uid } });
                    const at = mpLabelPoint(z.mp);
                    if (at) focusOn(at);
                  }}
                  className={`min-w-0 flex-1 truncate text-left text-[11px] ${
                    z.hidden ? 'text-ink4 line-through' : active ? 'text-sky-500' : 'text-ink2'
                  }`}
                >
                  {z.name}
                </button>
                <button
                  title={z.hidden ? '보이기' : '감추기'}
                  onClick={() => dispatch({ type: 'UPDATE_ZONE', uid: z.uid, patch: { hidden: !z.hidden } })}
                  className="rounded p-0.5 text-ink4 hover:text-ink2"
                >
                  {z.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                </button>
                {/* 늘 자리를 지킨다. 마우스를 올릴 때 나타나면 그만큼 눈 아이콘이
                    옆으로 밀려서, 눈을 누르려던 손이 휴지통을 누르게 된다. */}
                <button
                  title="삭제"
                  onClick={() => dispatch({ type: 'DELETE', kind: 'zone', uid: z.uid })}
                  className="rounded p-0.5 text-ink4 opacity-45 transition hover:text-red-500 hover:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 size={11} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
