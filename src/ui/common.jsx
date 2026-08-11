/**
 * UI 조각 모음 — 패널/버튼/필드의 공통 스타일
 *
 *  색은 전부 의미 이름(bg-panel, text-ink …)만 쓴다. 실제 값은 루트의
 *  data-theme 이 정하므로 여기서 라이트/다크를 신경 쓸 필요가 없다.
 */

import React from 'react';

export function Btn({ active, danger, className = '', children, ...rest }) {
  const base =
    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const tone = active
    ? 'bg-sky-500 text-white shadow-[0_0_0_1px_rgba(56,189,248,0.5)]'
    : danger
      ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 ring-1 ring-red-500/30'
      : 'bg-raise text-ink2 hover:bg-raiseh ring-1 ring-edge';
  return (
    <button type="button" className={`${base} ${tone} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function IconBtn({ active, title, children, ...rest }) {
  return (
    <button
      type="button"
      title={title}
      className={`grid h-8 w-8 place-items-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        active ? 'bg-sky-500 text-white' : 'bg-raise text-ink2 hover:bg-raiseh ring-1 ring-edge'
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Section({ title, right, children }) {
  return (
    <div className="border-b border-line px-3 py-3 last:border-b-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink4">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[11px] text-ink4">{label}</span>
      <span className="text-xs font-medium text-ink tabular-nums">{children}</span>
    </div>
  );
}

/** 값이 오른쪽에 붙는 슬라이더 — 인스펙터에서 가장 많이 쓰는 모양 */
export function Slider({ label, value, text, onChange, min, max, step = 0.05 }) {
  return (
    <label className="mt-2 block first:mt-0">
      <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
        {label}
        <b className="text-ink tabular-nums">{text}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-sky-500"
      />
    </label>
  );
}

/** 색 고르기 — 견본을 크게 두어 도면 색을 눈으로 맞출 수 있게 한다 */
export function ColorField({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[11px] text-ink4">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="text-[10.5px] uppercase tabular-nums text-ink4">{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-9 cursor-pointer rounded border border-edge bg-field p-0.5"
        />
      </span>
    </div>
  );
}

export function Field({ label, ...rest }) {
  return (
    <label className="block py-1">
      <span className="mb-1 block text-[11px] text-ink4">{label}</span>
      <input
        className="w-full rounded-md border border-edge bg-field px-2 py-1.5 text-xs text-ink outline-none focus:border-sky-500/60"
        {...rest}
      />
    </label>
  );
}
