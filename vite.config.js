import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/* PORT 가 주어지면 그 포트로 띄운다(에이전트/CI 가 포트를 배정하는 경우). 평소엔 5174. */
const port = Number(process.env.PORT) || 5174;

export default defineConfig({
  /* 자산 주소를 **상대 경로로** 낸다. GitHub Pages 는 `…/SmartFactory/` 처럼
     하위 경로로 열리는데, 뿌리 기준(`/assets/…`)으로 내면 전부 404 가 된다.
     저장소 이름을 여기 박지 않는 쪽을 골랐다 — 이름이 바뀌어도 안 깨진다. */
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port,
    open: !process.env.PORT,
  },
});
