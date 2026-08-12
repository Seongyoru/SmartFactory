/**
 * 상단 툴바 — 뷰 전환 · 도구 · 스냅 설정 · 저장
 */

import React, { useRef } from 'react';
import {
  Download,
  Eraser,
  Eye,
  EyeOff,
  GitCompare,
  GraduationCap,
  Grid3x3,
  Magnet,
  Moon,
  MousePointer2,
  Pause,
  Play,
  Redo2,
  RotateCw,
  Save,
  Sun,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import { SPEEDS, formatElapsed, resetClock, setSpeed, useElapsed, useSimSpeed } from '../core/clock.js';
import { resetMetrics } from '../core/metrics.js';
import { resetFaults, resetQuality } from '../core/faults.js';
import { TOOL, VIEW, useEditor } from '../core/store.jsx';
import { GRID_SIZES } from '../core/grid.js';
import { downloadJSON, layoutSnapshot, saveLayout } from '../core/persistence.js';
import { Btn, IconBtn } from './common.jsx';

export default function Toolbar() {
  const { state, dispatch } = useEditor();
  const simSpeed = useSimSpeed();
  const elapsed = useElapsed();
  const fileRef = useRef(null);

  const setView = (view) => dispatch({ type: 'SET', patch: { view } });
  const setTool = (tool) => dispatch({ type: 'SET_TOOL', tool });

  const importLayout = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      dispatch({ type: 'LOAD_LAYOUT', data });
    } catch {
      window.alert('레이아웃 파일을 읽지 못했습니다.');
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-head px-3">
      <div className="flex items-center gap-2 pr-1">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-sky-500 to-cyan-400 text-[11px] font-black text-slate-950">
          E
        </span>
        <div className="leading-tight">
          <p className="text-[12.5px] font-semibold text-ink">EGIS Smart Factory</p>
          <p className="text-[10px] text-ink4">설비 배치 에디터</p>
        </div>
      </div>

      <div className="mx-1 h-6 w-px bg-kbd" />

      {/* 뷰 전환 */}
      <div className="flex rounded-md bg-field p-0.5 ring-1 ring-edge">
        <button
          onClick={() => setView(VIEW.TOP)}
          className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
            state.view === VIEW.TOP ? 'bg-sky-500 text-white' : 'text-ink3 hover:text-ink'
          }`}
        >
          탑뷰 · 배치
        </button>
        <button
          onClick={() => setView(VIEW.ISO)}
          data-guide="view-iso"
          className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
            state.view === VIEW.ISO ? 'bg-sky-500 text-white' : 'text-ink3 hover:text-ink'
          }`}
        >
          3D · 확인
        </button>
      </div>

      {/* 도구 */}
      <div className="flex items-center gap-1">
        <IconBtn title="선택 / 이동 (Esc)" active={state.tool === TOOL.SELECT} onClick={() => setTool(TOOL.SELECT)}>
          <MousePointer2 size={14} />
        </IconBtn>
        <IconBtn title="지우개 (X)" active={state.tool === TOOL.ERASE} onClick={() => setTool(TOOL.ERASE)}>
          <Eraser size={14} />
        </IconBtn>
        <IconBtn
          title="90° 회전 (R)"
          onClick={() =>
            state.selected?.kind === 'equip'
              ? dispatch({ type: 'ROTATE', uid: state.selected.uid })
              : dispatch({ type: 'ROTATE_GHOST' })
          }
        >
          <RotateCw size={14} />
        </IconBtn>
      </div>

      <div className="mx-1 h-6 w-px bg-kbd" />

      {/* 되돌리기 — 남은 칸 수를 툴팁에 적어 "몇 번 더 갈 수 있는지" 를 보여 준다 */}
      <div className="flex items-center gap-1">
        <IconBtn
          title={`되돌리기 (Ctrl+Z)${state.past.length ? ` · ${state.past.length}단계` : ''}`}
          disabled={!state.past.length}
          onClick={() => dispatch({ type: 'UNDO' })}
        >
          <Undo2 size={14} />
        </IconBtn>
        <IconBtn
          title={`다시 실행 (Ctrl+Y)${state.future.length ? ` · ${state.future.length}단계` : ''}`}
          disabled={!state.future.length}
          onClick={() => dispatch({ type: 'REDO' })}
        >
          <Redo2 size={14} />
        </IconBtn>
      </div>

      <div className="mx-1 h-6 w-px bg-kbd" />

      {/* 스냅 */}
      <label className="flex items-center gap-1.5 text-[11px] text-ink3">
        <Grid3x3 size={13} />
        스냅
        <select
          value={state.gridSize}
          onChange={(e) => dispatch({ type: 'SET', patch: { gridSize: Number(e.target.value) } })}
          className="rounded border border-edge bg-field px-1.5 py-1 text-[11px] text-ink outline-none"
        >
          {GRID_SIZES.map((g) => (
            <option key={g} value={g}>
              {g >= 1 ? `${g} m` : `${g * 100} cm`}
            </option>
          ))}
        </select>
      </label>

      <IconBtn
        title="인접 설비에 면 맞춤"
        active={state.snapEdge}
        onClick={() => dispatch({ type: 'SET', patch: { snapEdge: !state.snapEdge } })}
      >
        <Magnet size={14} />
      </IconBtn>
      <IconBtn
        title="그리드 표시"
        active={state.showGrid}
        onClick={() => dispatch({ type: 'SET', patch: { showGrid: !state.showGrid } })}
      >
        {state.showGrid ? <Eye size={14} /> : <EyeOff size={14} />}
      </IconBtn>

      <div className="mx-1 h-6 w-px bg-kbd" />

      {/* 벨트 구동 — UV 스크롤 재생/정지 + 전역 기본 속도 */}
      <IconBtn
        title={state.running ? '벨트 정지' : '벨트 구동'}
        active={state.running}
        onClick={() => dispatch({ type: 'SET', patch: { running: !state.running } })}
      >
        {state.running ? <Pause size={14} /> : <Play size={14} />}
      </IconBtn>
      {/* 배속 — 지표는 시간으로 나눈 값이라, 시간을 빨리 못 감으면 답이 안 나온다.
          1시간짜리 라인을 실시간으로 보고 있을 수는 없다. */}
      <div className="flex items-center rounded-md bg-raise p-0.5 ring-1 ring-edge" title="시뮬레이션 배속">
        {SPEEDS.map((v) => (
          <button
            key={v}
            onClick={() => setSpeed(v)}
            className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums transition-colors ${
              simSpeed === v ? 'bg-sky-500 text-white' : 'text-ink4 hover:text-ink2'
            }`}
          >
            {v}×
          </button>
        ))}
      </div>
      {/* 경과 시간 — 누르면 지표를 처음부터 다시 잰다.
          배치를 고친 뒤의 성적을 보려면 이전 기록이 섞이면 안 된다. */}
      <button
        onClick={() => { resetClock(); resetMetrics(); resetFaults(); resetQuality(); }}
        title="시뮬레이션 안에서 흐른 시간 (▶ 를 켜 둔 동안만 흐른다) — 눌러서 지표 초기화"
        className="w-[86px] rounded px-1 py-0.5 text-left text-[11px] tabular-nums text-ink3 hover:bg-raiseh hover:text-ink"
      >
        ⏱ {formatElapsed(elapsed)}
      </button>

      <label className="flex items-center gap-1.5 text-[11px] text-ink3" title="개별 지정이 없는 벨트의 기본 속도">
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={state.beltSpeed}
          onChange={(e) => dispatch({ type: 'SET', patch: { beltSpeed: Number(e.target.value) } })}
          className="w-20 accent-sky-500"
        />
        <span className="w-14 tabular-nums text-ink2">{state.beltSpeed.toFixed(2)} m/s</span>
      </label>

      {/* 배치 비교 — 담아 둔 벌이 있으면 개수를 배지로 */}
      <IconBtn
        title="배치 비교 — 배치를 바꿔 보고 성적을 나란히 놓는다"
        active={state.showScenarios}
        onClick={() => dispatch({ type: 'SET', patch: { showScenarios: !state.showScenarios } })}
      >
        <GitCompare size={14} />
        {state.scenarios.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-sky-500 px-1 text-[9px] font-bold leading-[13px] text-white">
            {state.scenarios.length}
          </span>
        )}
      </IconBtn>

      {/* 따라 하기 — 처음 한 번은 저절로 뜨고, 그 뒤로는 여기서 다시 연다 */}
      <IconBtn
        title="따라 하기 — 순서대로 도면 하나 만들어 보기"
        active={!!state.guide}
        onClick={() => dispatch({ type: 'SET', patch: { guide: state.guide ? null : 'steps' } })}
      >
        <GraduationCap size={14} />
      </IconBtn>

      <IconBtn
        title={state.appearance === 'light' ? '다크 모드로' : '라이트 모드로'}
        onClick={() =>
          dispatch({ type: 'SET', patch: { appearance: state.appearance === 'light' ? 'dark' : 'light' } })
        }
      >
        {state.appearance === 'light' ? <Moon size={14} /> : <Sun size={14} />}
      </IconBtn>

      <div className="flex-1" />

      {/* 저장 */}
      <Btn
        onClick={() => {
          saveLayout(layoutSnapshot(state));
          window.alert('현재 배치를 브라우저에 저장했습니다.');
        }}
      >
        <Save size={13} /> 저장
      </Btn>
      <Btn
        onClick={() =>
          downloadJSON(
            layoutSnapshot(state),
            `egis-layout-${new Date().toISOString().slice(0, 10)}.json`,
          )
        }
      >
        <Download size={13} /> 내보내기
      </Btn>
      <Btn onClick={() => fileRef.current?.click()}>
        <Upload size={13} /> 불러오기
      </Btn>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => importLayout(e.target.files?.[0])}
      />
      <Btn
        danger
        onClick={() => {
          if (window.confirm('배치를 모두 지울까요? (라이브러리는 유지됩니다)')) dispatch({ type: 'CLEAR' });
        }}
      >
        <Trash2 size={13} /> 초기화
      </Btn>
    </header>
  );
}
