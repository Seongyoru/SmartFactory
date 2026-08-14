/**
 * 상단 툴바 — 뷰 전환 · 도구 · 스냅 설정 · 저장
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  Eraser,
  Eye,
  EyeOff,
  GitCompare,
  GraduationCap,
  Copy,
  Grid3x3,
  Library,
  Magnet,
  Moon,
  MousePointer2,
  Pause,
  Play,
  Redo2,
  RotateCw,
  Save,
  Share2,
  Sun,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import { SPEEDS, formatElapsed, resetClock, setSpeed, useElapsed, useSimSpeed } from '../core/clock.js';
import { resetMetrics } from '../core/metrics.js';
import { resetFaults, resetQuality } from '../core/faults.js';
import { resetWork } from '../core/process.js';
import { TOOL, VIEW, useEditor } from '../core/store.jsx';
import { GRID_SIZES } from '../core/grid.js';
import { downloadJSON, layoutSnapshot, saveLayout } from '../core/persistence.js';
import { loadGalleryIndex, loadGalleryLayout } from '../core/gallery.js';
import { SHARE_OFF, copyText, fetchShared, listShared, shareLayout } from '../core/share.js';
import { layoutSummary, layoutThumbSVG } from '../core/thumb.js';
import { Btn, IconBtn } from './common.jsx';

const kb = (n) => (n > 0 ? `${(n / 1024).toFixed(1)} KB` : '');
const when = (at) => {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(+d) ? '' : d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
    + ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
};

/**
 * 도면 카드 하나 — 그림 · 이름 · 언제 · 얼마나.
 *  이름만 늘어놓으면 「어느 도면이었더라」 가 된다. **위에서 본 미니맵**이
 *  한 장 있으면 라인 모양으로 바로 갈린다(core/thumb.js — 화면 캡처가 아니라
 *  도면 데이터로 그린 것이라 언제 봐도 같은 그림이다).
 */
function LayoutCard({ row, disabled, onPick }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className="group w-full overflow-hidden rounded-lg text-left ring-1 ring-edge transition-colors hover:ring-sky-500 disabled:opacity-50"
    >
      <div className="aspect-[16/9] w-full bg-field">
        {row.thumb
          ? <img src={row.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
          : <div className="grid h-full place-items-center text-[10px] text-ink4">미리보기 없음</div>}
      </div>
      <div className="px-2 py-1.5">
        <div className="truncate text-[11.5px] font-medium text-ink2">{row.name}</div>
        <div className="truncate text-[9.5px] text-ink4">
          {[row.note || row.summary, when(row.at), kb(row.size)].filter(Boolean).join(' · ')}
        </div>
      </div>
    </button>
  );
}

/**
 * 공용 도면 — **저장소에 담아 둔 것**과 **올라온 것**을 한 자리에.
 * ---------------------------------------------------------------------------
 *  둘은 들어오는 길이 다르다. 저장소(`public/layouts/`)는 git push 로 넣는
 *  것이고, 올라온 것은 앱의 「공유」로 들어온다. 그런데 **쓰는 사람에게는 같은
 *  것**이다 — 남이 만든 도면을 열어 보는 일. 그래서 한 목록에 둔다.
 *
 *  **둘 다 비어 있으면 버튼 자체를 안 낸다.** 아무것도 없는 배포에서
 *  「공용 도면」 이 떠 있고 눌러도 빈 창이면 고장 난 것처럼 보인다.
 */
function GalleryButton({ onPick }) {
  const [rows, setRows] = useState(null);        // null = 아직 안 읽음
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);

  /* 한 번 읽은 저장소 도면은 들고 있는다 — 썸네일을 그리려고 읽은 것을
     고를 때 또 읽으면 같은 파일을 두 번 받는다 */
  const cache = useRef(new Map());

  const reload = async () => {
    const [repo, up] = await Promise.all([loadGalleryIndex(), listShared()]);
    /* 올라온 것이 위 — 방금 올린 것을 바로 찾을 수 있어야 한다 */
    setRows([
      ...up.map((r) => ({ ...r, from: 'share' })),
      ...repo.map((r) => ({ ...r, from: 'repo' })),
    ]);

    /**
     * 저장소 도면의 썸네일은 **열 때 그린다.**
     *  SVG 를 같이 커밋해 두면 도면을 고친 뒤 그림만 옛것으로 남아 목록이
     *  거짓말을 한다. 도면은 작고(1~2KB) CDN 이 물고 있으니, 그때그때 그려서
     *  **항상 맞는 그림**을 보여 주는 편이 낫다. 개수·크기도 여기서 나온다.
     */
    for (const e of repo) {
      loadGalleryLayout(e).then((data) => {
        cache.current.set(e.file, data);
        setRows((prev) => (prev ?? []).map((r) => (r.from === 'repo' && r.file === e.file
          ? {
            ...r,
            thumb: `data:image/svg+xml;utf8,${encodeURIComponent(layoutThumbSVG(data))}`,
            summary: layoutSummary(data),
          }
          : r)));
      }).catch(() => { /* 못 읽으면 「미리보기 없음」 으로 남는다 */ });
    }
  };
  useEffect(() => { reload(); }, []);
  if (!rows?.length) return null;

  const pick = async (row) => {
    setBusy(row.id);
    try {
      const data = row.from === 'share'
        ? await fetchShared(row.id)
        : cache.current.get(row.file) ?? await loadGalleryLayout(row);
      onPick(data, row);
      setOpen(false);
    } catch (err) {
      console.error('[공용 도면] 못 열었다', err);
      window.alert(`「${row.name}」 을 열지 못했습니다 — ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative">
      <Btn active={open} onClick={() => { if (!open) reload(); setOpen((v) => !v); }}>
        <Library size={13} /> 공용 도면
      </Btn>
      {open && (
        <>
          {/* 바깥을 누르면 닫힌다 — 목록을 닫으려고 같은 버튼을 다시 찾게 하지 않는다 */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-30 mt-1 w-[540px] rounded-lg bg-panel shadow-xl ring-1 ring-edge">
            <div className="grid max-h-[52vh] grid-cols-3 gap-2 overflow-y-auto p-2.5">
              {rows.map((r) => (
                <LayoutCard key={`${r.from}:${r.id}`} row={r} disabled={busy != null} onPick={() => pick(r)} />
              ))}
            </div>
            <p className="border-t border-line px-2.5 py-1.5 text-[9.5px] leading-snug text-ink4">
              여는 순간 <b className="text-ink3">지금 도면을 덮어씁니다.</b> 되돌리기(Ctrl+Z)로 돌아올 수 있습니다.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 도면 올리기 — 링크 하나로 서로 테스트.
 * ---------------------------------------------------------------------------
 *  **올리기 전에 반드시 묻는다.** 링크를 가진 사람은 누구나 열 수 있고, 한 번
 *  나간 것은 되돌릴 수 없다. 「공유」 를 눌렀다는 것만으로 그 뜻까지 동의한
 *  것으로 치면 안 된다 — 사내 도면이 섞이는 순간 사고가 된다.
 */
function ShareButton({ snapshot }) {
  const [state, setState] = useState(null);   // null · 'ask' · 'busy' · { url, copied }
  /* 이름을 받는다 — 목록에 「(이름 없음)」 이 늘어서면 고를 수가 없다 */
  const [name, setName] = useState('');

  const upload = async () => {
    setState('busy');
    try {
      const { url } = await shareLayout(snapshot(), name);
      setState({ url, copied: await copyText(url) });
    } catch (e) {
      console.error('[공유] 못 올렸다', e);
      setState(null);
      window.alert(e.code === SHARE_OFF
        ? `공유가 아직 켜져 있지 않습니다.\n\n${e.message}`
        : `올리지 못했습니다 — ${e.message}`);
    }
  };

  return (
    <div className="relative">
      <Btn active={!!state} onClick={() => setState(state ? null : 'ask')}>
        <Share2 size={13} /> 공유
      </Btn>
      {state && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setState(null)} />
          <div className="absolute right-0 top-full z-30 mt-1 w-[290px] rounded-lg bg-panel p-2.5 shadow-xl ring-1 ring-edge">
            {state === 'ask' && (
              <>
                <p className="text-[11.5px] leading-relaxed text-ink2">
                  지금 도면을 올립니다. <b className="text-ink">링크</b>가 나오고,
                  <b className="text-ink"> 「공용 도면」 목록</b>에도 올라갑니다.
                </p>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) upload(); }}
                  placeholder="도면 이름 (예: A라인 조립 2단)"
                  maxLength={60}
                  className="mt-2 w-full rounded bg-field px-2 py-1 text-[11.5px] text-ink2 ring-1 ring-edge focus:ring-sky-500"
                />
                <p className="mt-1.5 rounded bg-amber-500/10 px-2 py-1.5 text-[10.5px] leading-snug text-amber-600 ring-1 ring-amber-500/25">
                  올리면 <b>누구나</b> 목록에서 보고 열 수 있습니다. 한 번 올린 것은 앱에서
                  되돌릴 수 없습니다 — 회사 도면이면 다시 생각해 주세요.
                </p>
                <div className="mt-2 flex justify-end gap-1.5">
                  <Btn onClick={() => setState(null)}>취소</Btn>
                  <Btn onClick={upload}><Share2 size={12} /> 올리기</Btn>
                </div>
              </>
            )}
            {state === 'busy' && <p className="text-[11.5px] text-ink3">올리는 중…</p>}
            {state?.url && (
              <>
                <p className="mb-1 text-[10.5px] text-ink4">
                  {state.copied ? '링크를 복사했습니다 — 그대로 붙여넣으세요.' : '아래 링크를 복사해 보내세요.'}
                </p>
                <input
                  readOnly
                  value={state.url}
                  onFocus={(e) => e.target.select()}
                  className="w-full rounded bg-field px-2 py-1 text-[11px] text-ink2 ring-1 ring-edge"
                />
                <div className="mt-2 flex justify-end gap-1.5">
                  <Btn onClick={async () => setState({ ...state, copied: await copyText(state.url) })}>
                    <Copy size={12} /> 복사
                  </Btn>
                  <Btn onClick={() => setState(null)}>닫기</Btn>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

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
        onClick={() => { resetClock(); resetMetrics(); resetFaults(); resetQuality(); resetWork(); }}
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
      {/* 저장소에 담아 둔 공용 도면 — 담긴 것이 없으면 버튼도 안 나온다 */}
      <GalleryButton onPick={(data) => dispatch({ type: 'LOAD_LAYOUT', data })} />
      {/* 올리기 — 링크 하나로 서로 테스트. 올리기 전에 반드시 묻는다 */}
      <ShareButton snapshot={() => layoutSnapshot(state)} />
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
