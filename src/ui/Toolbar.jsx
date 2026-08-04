/**
 * 상단 툴바 — 뷰 전환 · 도구 · 스냅 설정 · 저장
 */

import React, { useRef } from 'react';
import {
  Download,
  Eraser,
  Eye,
  EyeOff,
  Grid3x3,
  Magnet,
  Moon,
  MousePointer2,
  Pause,
  Play,
  RotateCw,
  Save,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { TOOL, VIEW, useEditor } from '../core/store.jsx';
import { GRID_SIZES } from '../core/grid.js';
import { downloadJSON, layoutSnapshot, saveLayout } from '../core/persistence.js';
import { Btn, IconBtn } from './common.jsx';

export default function Toolbar() {
  const { state, dispatch } = useEditor();
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
