import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const target = 'http://100.86.37.97:8888';

export default defineConfig({
    base: './',
    plugins: [vue()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
        port: 5199,
        proxy: {
            '/api': { target, changeOrigin: true, ws: true },
            '/socket.io': { target, changeOrigin: true, ws: true },
            '/streamfiles': { target, changeOrigin: true },
        },
    },
});
