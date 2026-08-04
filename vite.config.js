import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/* PORT 가 주어지면 그 포트로 띄운다(에이전트/CI 가 포트를 배정하는 경우). 평소엔 5174. */
const port = Number(process.env.PORT) || 5174;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port,
    open: !process.env.PORT,
  },
});
