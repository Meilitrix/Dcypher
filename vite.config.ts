import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = (name: string) => fileURLToPath(new URL(`packages/${name}/index.ts`, import.meta.url));

// Decypher web control UI. The API orchestrator runs separately (see server.ts).
export default defineConfig(() => {
  return {
    root,
    plugins: [react()],
    resolve: {
      alias: {
        '@decypher/core': pkg('core'),
        '@decypher/agent': pkg('agent'),
        '@decypher/protect': pkg('protect'),
        '@decypher/snapshot': pkg('snapshot'),
        '@decypher/diff': pkg('diff'),
      },
    },
    server: {
      port: 5173,
      watch: {
        // The orchestrator copies repos into these workspaces; never treat them as UI source.
        ignored: ['**/.decypher-work/**', '**/.decypher-smoke/**', '**/.decypher-preview/**', '**/sample-target/**'],
      },
      // API base is absolute (http://localhost:8787) so HMR/proxy is not required.
    },
  };
});
