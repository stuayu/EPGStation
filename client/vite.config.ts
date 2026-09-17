import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';
import { patchMpegtsDist } from './mpegtsAdtsPatch.js';

const clientDirectory = fileURLToPath(new URL('.', import.meta.url));
const mpegtsDistPath = join(clientDirectory, 'node_modules', 'mpegts.js', 'dist', 'mpegts.js');
const normalizedMpegtsDistPath = mpegtsDistPath.replaceAll('\\', '/');

const normalizeModuleId = (id: string): string => id.split('?')[0].replaceAll('\\', '/');

const isMpegtsDistPath = (id: string): boolean => normalizeModuleId(id) === normalizedMpegtsDistPath;

/** mpegts.js の本番 bundle に AAC ADTS 偽同期対策と副音声の初期指定を適用する。 */
const mpegtsAdtsPatchPlugin = (): Plugin => ({
    name: 'epgstation-mpegts-adts-patch',
    enforce: 'pre',
    transform(code, id) {
        if (isMpegtsDistPath(id) === false) return null;
        return { code: patchMpegtsDist(code), map: null };
    },
});

/** Vite dev の optimizeDeps (esbuild) にも同じ mpegts.js 修正を適用する。 */
const mpegtsAdtsPatchEsbuildPlugin = () => ({
    name: 'epgstation-mpegts-adts-patch',
    setup(build: {
        onLoad: (
            options: { filter: RegExp },
            callback: (args: { path: string }) => { contents: string; loader: 'js' } | undefined | Promise<{ contents: string; loader: 'js' } | undefined>,
        ) => void;
    }) {
        build.onLoad(
            { filter: /(?:^|[\\/])node_modules[\\/]mpegts\.js[\\/]dist[\\/]mpegts\.js$/ },
            args => {
                if (isMpegtsDistPath(args.path) === false) return;
                return { contents: patchMpegtsDist(readFileSync(args.path, 'utf8')), loader: 'js' };
            },
        );
    },
});

const collectFiles = (directory: string, root = directory): string[] => {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...collectFiles(path, root));
        else files.push(relative(root, path).split(sep).join('/'));
    }
    return files;
};

/** Vite の出力一覧を SW へ注入する。public/ の固定資産も忘れず precache する。 */
const serviceWorkerPlugin = (): Plugin => ({
    name: 'epgstation-service-worker',
    generateBundle(_options, bundle) {
        const publicDir = join(clientDirectory, 'public');
        const template = readFileSync(join(clientDirectory, 'serviceWorker.template.js'), 'utf8');
        const workerUtil = readFileSync(join(clientDirectory, 'serviceWorkerUtil.js'), 'utf8');
        // index.html は Vite が generateBundle 後に生成するため bundle には入らない。
        const outputFiles = ['index.html', ...Object.keys(bundle).filter(fileName => fileName !== 'serviceWorker.js')];
        const publicFiles = collectFiles(publicDir);
        const precacheUrls = [...new Set([...outputFiles, ...publicFiles])].sort();
        const versionHash = createHash('sha256').update(precacheUrls.join('\n'));
        // ファイル名が変わらない index.html / public 固定資産の更新でも SW を更新する。
        versionHash.update(readFileSync(join(clientDirectory, 'index.html')));
        for (const fileName of publicFiles) versionHash.update(readFileSync(join(publicDir, fileName)));
        for (const fileName of Object.keys(bundle).filter(fileName => fileName !== 'serviceWorker.js').sort()) {
            const output = bundle[fileName];
            versionHash.update(fileName);
            if (output.type === 'asset') {
                if (typeof output.source === 'string') versionHash.update(output.source);
                else versionHash.update(output.source);
            } else {
                versionHash.update(output.code);
            }
        }
        const cacheVersion = versionHash.digest('hex').slice(0, 16);
        const source = template
            .replace('__EPGSTATION_SERVICE_WORKER_UTIL__', `${workerUtil}\nself.EpgStationServiceWorkerUtil = { classifyServiceWorkerRequest };`)
            .replace('__EPGSTATION_APP_CACHE_NAME__', JSON.stringify(`epgstation-app-${cacheVersion}`))
            .replace('__EPGSTATION_PRECACHE_URLS__', JSON.stringify(precacheUrls));
        this.emitFile({ type: 'asset', fileName: 'serviceWorker.js', source });
    },
});

export default defineConfig({
    base: './',
    plugins: [vue(), mpegtsAdtsPatchPlugin(), serviceWorkerPlugin()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    optimizeDeps: {
        exclude: ['mpeg2toh264/player', 'mpeg2toh264/yadif'],
        esbuildOptions: { plugins: [mpegtsAdtsPatchEsbuildPlugin()] },
    },
    build: { outDir: 'dist', emptyOutDir: true },
});
