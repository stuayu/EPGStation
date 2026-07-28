<template>
    <div>
        <v-alert type="info" density="compact" class="mb-3">
            ライブ / 録画済みの配信プロファイルを編集します。
            <b>新形式 (profiles)</b> を設定するとそのスコープでは旧形式より優先されます。
            cmd を省略するとコンテナ・映像・音声の指定から ffmpeg コマンドを自動生成し、映像・音声も省略すると無変換になります。
        </v-alert>

        <div class="d-flex ga-2 flex-wrap mb-3">
            <v-select
                v-model="scope"
                :items="scopeItems"
                item-title="title"
                item-value="value"
                label="スコープ"
                density="compact"
                hide-details
                style="max-width: 240px"
            ></v-select>
            <v-btn-toggle v-model="format" density="compact" mandatory divided>
                <v-btn value="profiles" size="small">新形式 (profiles)</v-btn>
                <v-btn value="legacy" size="small">旧形式 (コンテナ別)</v-btn>
            </v-btn-toggle>
            <v-select
                v-if="format === 'legacy'"
                v-model="container"
                :items="containerItems"
                item-title="title"
                item-value="value"
                label="コンテナ"
                density="compact"
                hide-details
                style="max-width: 180px"
            ></v-select>
        </div>

        <!-- 新形式 -->
        <template v-if="format === 'profiles'">
            <v-card v-for="(item, index) in profiles" :key="index" variant="outlined" class="mb-2">
                <v-card-text class="py-2">
                    <div class="d-flex ga-2 flex-wrap align-start">
                        <v-text-field v-model="item.id" label="id" density="compact" hide-details style="max-width: 160px"></v-text-field>
                        <v-text-field v-model="item.name" label="表示名" density="compact" hide-details style="max-width: 200px"></v-text-field>
                        <v-select
                            v-model="item.container"
                            :items="containerItemsFor(scope)"
                            item-title="title"
                            item-value="value"
                            label="コンテナ"
                            density="compact"
                            hide-details
                            style="max-width: 150px"
                        ></v-select>
                        <v-switch v-model="item.isUnconverted" label="無変換" density="compact" hide-details color="primary"></v-switch>
                        <v-spacer></v-spacer>
                        <v-btn icon variant="text" size="small" color="error" @click="profiles.splice(index, 1)">
                            <v-icon>mdi-delete</v-icon>
                        </v-btn>
                    </div>
                    <v-text-field
                        v-if="item.isUnconverted !== true"
                        v-model="item.cmd"
                        label="コマンド (省略すると自動生成)"
                        density="compact"
                        hide-details
                        class="mt-1"
                    ></v-text-field>
                    <div v-if="item.isUnconverted !== true" class="d-flex ga-2 flex-wrap mt-2">
                        <v-text-field v-model="item.videoCodec" label="映像コーデック" density="compact" hide-details style="max-width: 150px"></v-text-field>
                        <v-text-field v-model.number="item.videoHeight" type="number" label="高さ" density="compact" hide-details style="max-width: 110px"></v-text-field>
                        <v-text-field v-model.number="item.videoBitrate" type="number" label="映像 kbps" density="compact" hide-details style="max-width: 130px"></v-text-field>
                        <v-text-field v-model="item.audioCodec" label="音声コーデック" density="compact" hide-details style="max-width: 150px"></v-text-field>
                        <v-text-field v-model.number="item.audioBitrate" type="number" label="音声 kbps" density="compact" hide-details style="max-width: 130px"></v-text-field>
                    </div>
                </v-card-text>
            </v-card>
            <v-btn size="small" variant="tonal" @click="addProfile">追加</v-btn>
        </template>

        <!-- 旧形式 -->
        <template v-else>
            <div v-for="(item, index) in legacyItems" :key="index" class="d-flex ga-2 mb-2 align-start">
                <v-text-field v-model="item.name" label="表示名" density="compact" hide-details style="max-width: 200px"></v-text-field>
                <v-text-field v-model="item.cmd" label="コマンド (省略で無変換)" density="compact" hide-details></v-text-field>
                <v-btn icon variant="text" size="small" color="error" @click="legacyItems.splice(index, 1)">
                    <v-icon>mdi-delete</v-icon>
                </v-btn>
            </div>
            <v-btn size="small" variant="tonal" @click="legacyItems.push({ name: '' })">追加</v-btn>
        </template>

        <div class="text-caption text-grey mt-2">
            編集内容は画面下部の「保存」でまとめて反映されます。%FFMPEG% / %TSREADEX% などのプレースホルダが使えます
        </div>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';

type ScopeValue = 'live' | 'recorded.ts' | 'recorded.encoded';

/**
 * 画面で扱いやすいよう平坦化したプロファイル
 */
interface FlatProfile {
    id?: string;
    name: string;
    container?: string;
    cmd?: string;
    isUnconverted?: boolean;
    videoCodec?: string;
    videoHeight?: number;
    videoBitrate?: number;
    audioCodec?: string;
    audioBitrate?: number;
}

/**
 * 配信プロファイル (config.yml の stream) の編集。
 * 新形式 (stream.profiles) と旧形式 (stream.live.ts.<container> 等) の両方を扱う
 */
@Component({})
class StreamProfileEditor extends Vue {
    // 親が持つ stream の値 (実効値をコピーしたもの)。編集結果はここへ書き戻す
    @Prop({ required: true })
    public value!: Record<string, any>;

    scope: ScopeValue = 'live';
    format: 'profiles' | 'legacy' = 'profiles';
    container = 'mp4';

    profiles: FlatProfile[] = [];
    legacyItems: Array<{ name: string; cmd?: string }> = [];

    readonly scopeItems = [
        { title: 'ライブ視聴', value: 'live' },
        { title: '録画済み (TS)', value: 'recorded.ts' },
        { title: '録画済み (エンコード済み)', value: 'recorded.encoded' },
    ];

    get containerItems(): Array<{ title: string; value: string }> {
        return this.containerItemsFor(this.scope);
    }

    /**
     * ライブのみ m2ts / 低遅延 m2ts を選べる
     */
    containerItemsFor(scope: ScopeValue): Array<{ title: string; value: string }> {
        const common = [
            { title: 'mp4', value: 'mp4' },
            { title: 'webm', value: 'webm' },
            { title: 'hls', value: 'hls' },
        ];
        return scope === 'live'
            ? [{ title: 'm2ts', value: 'm2ts' }, { title: 'm2ts (低遅延)', value: 'm2tsll' }, ...common]
            : common;
    }

    mounted(): void {
        this.reload();
    }

    @Watch('scope')
    @Watch('format')
    @Watch('container')
    onSelectionChanged(): void {
        // 表示を切り替える前に、いま編集していた内容を親へ書き戻す
        this.flush();
        this.reload();
    }

    /**
     * 現在のスコープ・形式に対応する値を読み込む
     */
    reload(): void {
        if (this.format === 'profiles') {
            const list: any[] = StreamProfileEditor.pick(this.value, this.profilesPath()) ?? [];
            this.profiles = list.map(x => ({
                id: x.id,
                name: x.name ?? '',
                container: x.container,
                cmd: x.cmd,
                isUnconverted: x.isUnconverted,
                videoCodec: x.video?.codec,
                videoHeight: x.video?.height,
                videoBitrate: x.video?.bitrate,
                audioCodec: x.audio?.codec,
                audioBitrate: x.audio?.bitrate,
            }));
        } else {
            const list: any[] = StreamProfileEditor.pick(this.value, this.legacyPath()) ?? [];
            this.legacyItems = list.map(x => ({ name: x.name ?? '', cmd: x.cmd }));
        }
    }

    /**
     * 編集内容を親の値へ書き戻す。保存ボタンを押す前でも常に最新にしておく
     */
    flush(): void {
        if (this.format === 'profiles') {
            const list = this.profiles
                .filter(x => (x.name ?? '') !== '')
                .map(x => {
                    const item: Record<string, any> = { name: x.name };
                    if ((x.id ?? '') !== '') item.id = x.id;
                    if ((x.container ?? '') !== '') item.container = x.container;
                    if (x.isUnconverted === true) {
                        item.isUnconverted = true;
                    } else {
                        if ((x.cmd ?? '') !== '') item.cmd = x.cmd;
                        const video = StreamProfileEditor.compact({
                            codec: x.videoCodec,
                            height: x.videoHeight,
                            bitrate: x.videoBitrate,
                        });
                        const audio = StreamProfileEditor.compact({ codec: x.audioCodec, bitrate: x.audioBitrate });
                        if (video !== null) item.video = video;
                        if (audio !== null) item.audio = audio;
                    }
                    return item;
                });
            StreamProfileEditor.assign(this.value, this.profilesPath(), list);
        } else {
            const list = this.legacyItems
                .filter(x => (x.name ?? '') !== '')
                .map(x => ((x.cmd ?? '') === '' ? { name: x.name } : { name: x.name, cmd: x.cmd }));
            StreamProfileEditor.assign(this.value, this.legacyPath(), list);
        }
    }

    addProfile(): void {
        this.profiles.push({ name: '', container: this.containerItems[0].value });
    }

    private profilesPath(): string {
        return this.scope === 'live' ? 'profiles.live' : `profiles.${this.scope.replace('.', '.')}`;
    }
    private legacyPath(): string {
        return this.scope === 'live' ? `live.ts.${this.container}` : `${this.scope}.${this.container}`;
    }

    private static compact(value: Record<string, any>): Record<string, any> | null {
        const result: Record<string, any> = {};
        for (const [key, v] of Object.entries(value)) {
            if (v === null || v === '' || typeof v === 'undefined') continue;
            if (typeof v === 'number' && Number.isNaN(v)) continue;
            result[key] = v;
        }
        return Object.keys(result).length === 0 ? null : result;
    }
    private static pick(source: Record<string, any>, path: string): any {
        return path
            .split('.')
            .reduce<any>((acc, key) => (acc === null || typeof acc !== 'object' ? undefined : acc[key]), source);
    }
    private static assign(target: Record<string, any>, path: string, value: any): void {
        const keys = path.split('.');
        let current = target;
        for (let i = 0; i < keys.length - 1; i++) {
            if (typeof current[keys[i]] !== 'object' || current[keys[i]] === null) current[keys[i]] = {};
            current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = value;
    }
}

export default toNative(StreamProfileEditor);
</script>
