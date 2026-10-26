/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import plugin from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// https://vitejs.dev/config/
export default defineConfig(({ command, isPreview }) => ({
    // GitHub Pages（https://yama-ishi-g.github.io/NoteDock/）で配信するため、ビルドとpreviewはサブパスにする
    base: command === 'build' || isPreview ? '/NoteDock/' : '/',
    plugins: [
        plugin(),
        VitePWA({
            // 段階0は検証しやすさを優先して自動更新。段階1で「更新のお知らせ」方式（prompt）に変える
            registerType: 'autoUpdate',
            includeAssets: ['favicon.svg', 'icons/apple-touch-icon-180.png'],
            manifest: {
                name: 'NoteDock',
                short_name: 'NoteDock',
                description: 'iPadで使うオフライン対応のノートアプリ',
                lang: 'ja',
                display: 'standalone',
                orientation: 'any',
                theme_color: '#185fa5',
                background_color: '#ffffff',
                icons: [
                    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                    { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
            },
            workbox: {
                // pdf.js の worker・cMap・標準フォント・wasm もオフラインで使えるように precache する
                globPatterns: ['**/*.{js,mjs,css,html,svg,png,bcmap,pfb,ttf,wasm,icc}'],
                maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
            },
        }),
    ],
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
