/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import plugin from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import pkg from './package.json' with { type: 'json' };

// 画面に表示して、iPadで新しい版に更新されたかを確かめるためのビルド情報
function commitHash(): string {
    try {
        return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
        return 'dev';
    }
}

// 本番（main ブランチ）と開発版（dev ブランチ）を同じ GitHub Pages に置く
//   本番:   https://yama-ishi-g.github.io/NoteDock/
//   開発版: https://yama-ishi-g.github.io/NoteDock/dev/   （NOTEDOCK_CHANNEL=dev でビルド）
const channel = process.env.NOTEDOCK_CHANNEL === 'dev' ? 'dev' : 'prod';
const isDev = channel === 'dev';
const PROD_BASE = '/NoteDock/';
const DEV_BASE = '/NoteDock/dev/';
const appName = isDev ? 'NoteDock開発版' : 'NoteDock';

/** index.html のアプリ名（タブ・ホーム画面の名前）を開発版用にする */
function channelHtml(): Plugin {
    return {
        name: 'notedock-channel-html',
        transformIndexHtml: (html) => html.replaceAll('>NoteDock<', `>${appName}<`).replace('content="NoteDock"', `content="${appName}"`),
    };
}

// https://vitejs.dev/config/
export default defineConfig(({ command, isPreview }) => ({
    // GitHub Pages で配信するため、ビルドとpreviewはサブパスにする
    base: command === 'build' || isPreview ? (isDev ? DEV_BASE : PROD_BASE) : '/',
    plugins: [
        plugin(),
        channelHtml(),
        VitePWA({
            // 新しい版が届いたら「更新があります」を表示し、利用者の操作で切り替える（編集中の内容を失わないため）
            registerType: 'prompt',
            includeAssets: ['favicon.svg', 'icons/apple-touch-icon-180.png'],
            manifest: {
                // 本番と開発版をホーム画面に両方追加できるよう、id を分ける
                id: isDev ? DEV_BASE : PROD_BASE,
                name: appName,
                short_name: appName,
                description: 'iPadで使うオフライン対応のノートアプリ',
                lang: 'ja',
                display: 'standalone',
                orientation: 'any',
                theme_color: isDev ? '#d85a30' : '#185fa5',
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
                // 本番の Service Worker の範囲（/NoteDock/）には開発版（/NoteDock/dev/）も含まれるため、
                // 開発版のページを本番の index.html で返さないようにする
                navigateFallbackDenylist: isDev ? [] : [/^\/NoteDock\/dev\//],
            },
        }),
    ],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
        __BUILD_COMMIT__: JSON.stringify(commitHash()),
        __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
        __APP_CHANNEL__: JSON.stringify(channel),
    },
    server: {
        port: 54144,
        // iPad実機確認用（Cloudflare Tunnel の一時URL）からのアクセスを許可する
        allowedHosts: ['.trycloudflare.com'],
    },
    build: {
        // オフラインで使う PWA のため、1つのファイルにまとまっていても問題ない
        chunkSizeWarningLimit: 1500,
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
}))
