import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';

/** Short git revision shown in the UI; 'dev' when built outside a checkout (npm tarball). */
const gitRevision = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
})();

/** GitHub Pages serves the app under /openui/; the npm package serves it at /. */
const baseURL = process.env.NUXT_APP_BASE_URL ?? '/';

/**
 * Runs before first paint so the page background matches the persisted theme.
 * Kept here (not in a component) because in SPA mode only app.head reaches the
 * static HTML shell.
 */
const antiFoucScript =
  "(function(){var PREFIX='opencode.';var THEME_KEY=PREFIX+'settings.theme.v1';var SEEDS_KEY=PREFIX+'settings.customThemeSeeds.v1';var BG_MAP={dark:'#111a2c',light:'#f1f5f9',dracula:'#343746','solarized-dark':'#073642'};var bg=BG_MAP.dark;try{var id=localStorage.getItem(THEME_KEY);if(id==='custom'){var seeds=JSON.parse(localStorage.getItem(SEEDS_KEY)||'{}');if(seeds.background)bg=seeds.background;}else if(id&&BG_MAP[id]){bg=BG_MAP[id];}}catch(e){}document.documentElement.style.setProperty('--theme-bg-surface',bg);})();";

/**
 * agent-conduit, which reads Claude Code's session files, comes from npm. Set
 * AGENT_CONDUIT_DIR=../agent-conduit in .env to run against a local checkout's dist/
 * instead (`yarn dev` there rebuilds it on save). .env is not committed, so CI
 * and the npm build always get the published package.
 */
const agentConduitDir = process.env.AGENT_CONDUIT_DIR;

export default defineNuxtConfig({
  compatibilityDate: '2026-09-01',
  ssr: false,
  devtools: { enabled: true },

  alias: agentConduitDir ? { 'agent-conduit': resolve(agentConduitDir, 'dist') } : {},
  // The Vite-era dev port. The built server (and `npx openui`) still defaults
  // to 3000; PORT or --port override either.
  devServer: { port: 5173 },
  spaLoadingTemplate: false,
  experimental: {
    // A deploy while a session is open would otherwise trigger a hard reload on
    // the next query-only navigation (session switch).
    appManifest: false,
  },

  app: {
    baseURL,
    head: {
      title: 'openui - OpenCode Visualizer',
      meta: [{ name: 'viewport', content: 'width=device-width,initial-scale=1' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: `${baseURL}favicon.svg` }],
      script: [{ innerHTML: antiFoucScript, tagPosition: 'head', tagPriority: 'critical' }],
    },
  },

  css: ['@xterm/xterm/css/xterm.css', '~/assets/css/tailwind.css', '~/assets/css/shell.css'],

  modules: ['@nuxt/icon'],
  icon: {
    // Never fetch from the Iconify CDN at runtime; bundle what the app uses.
    provider: 'none',
    serverBundle: false,
    clientBundle: {
      scan: true,
      icons: [
        'lucide:archive',
        'lucide:arrow-down',
        'lucide:arrow-left',
        'lucide:arrow-up',
        'lucide:asterisk',
        'lucide:bell',
        'lucide:bell-ring',
        'lucide:bookmark',
        'lucide:bookmark-plus',
        'lucide:brain',
        'lucide:check',
        'lucide:chevron-down',
        'lucide:chevron-left',
        'lucide:chevron-right',
        'lucide:clock',
        'lucide:download',
        'lucide:ellipsis-vertical',
        'lucide:eye',
        'lucide:eye-off',
        'lucide:folder',
        'lucide:folder-open',
        'lucide:gauge',
        'lucide:git-branch',
        'lucide:git-branch-plus',
        'lucide:git-commit-horizontal',
        'lucide:git-merge',
        'lucide:github',
        'lucide:globe',
        'lucide:import',
        'lucide:list',
        'lucide:log-out',
        'lucide:message-circle-plus',
        'lucide:message-square',
        'lucide:moon',
        'lucide:package',
        'lucide:panel-left-close',
        'lucide:panel-left-open',
        'lucide:paperclip',
        'lucide:refresh-cw',
        'lucide:rows-3',
        'lucide:search',
        'lucide:send',
        'lucide:settings',
        'lucide:share-2',
        'lucide:shield-check',
        'lucide:sparkles',
        'lucide:sun',
        'lucide:terminal',
        'lucide:timer',
        'lucide:trash-2',
        'lucide:upload',
        'lucide:x',
      ],
      sizeLimitKb: 512,
    },
  },

  components: [
    { path: '~/components/renderers', pathPrefix: false },
    { path: '~/components/viewers', pathPrefix: false },
    { path: '~/components/Trajectory', pathPrefix: false },
    { path: '~/components', extensions: ['.vue'] },
  ],

  runtimeConfig: {
    // Server-only. Overridable at runtime via NUXT_OPENCODE_URL / NUXT_CLAUDE_ENABLED / NUXT_CLAUDE_BIN.
    opencodeUrl: process.env.OPENCODE_URL ?? '',
    claudeEnabled: process.env.EXPERIMENTAL_CLAUDE === 'true',
    claudeBin: '',
    public: {
      gitRevision,
    },
  },

  vite: {
    plugins: [tailwindcss()],
    // Workers import ES modules (shiki, stateBuilder); IIFE workers cannot.
    worker: { format: 'es' },
  },

  typescript: {
    strict: true,
    // Run `yarn typecheck` (CI) instead of checking on every dev/build.
    typeCheck: false,
    tsConfig: {
      compilerOptions: {
        noUnusedLocals: true,
        noUnusedParameters: true,
        // Nuxt enables this by default; the codebase predates it (137 errors). Revisit after decomposition.
        noUncheckedIndexedAccess: false,
      },
    },
    nodeTsConfig: { compilerOptions: { noUnusedLocals: true, noUnusedParameters: true } },
  },

  nitro: {
    // Self-contained server output so the npm package ships no node_modules.
    noExternals: true,
    typescript: {
      tsConfig: { compilerOptions: { noUnusedLocals: true, noUnusedParameters: true } },
    },
  },
});
