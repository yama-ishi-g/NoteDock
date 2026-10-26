/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import plugin from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    // GitHub Pages（https://yama-ishi-g.github.io/NoteDock/）で配信するため、ビルド時のみサブパスにする
    base: command === 'build' ? '/NoteDock/' : '/',
    plugins: [plugin()],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
        port: 54144,
        // iPad実機確認用（Cloudflare Tunnel の一時URL）からのアクセスを許可する
        allowedHosts: ['.trycloudflare.com'],
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
}))
