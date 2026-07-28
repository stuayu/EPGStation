<template>
    <div v-if="loaded === true">
        <v-alert type="info" density="compact" class="mb-3">
            config.yml を直接書き換えるのではなく、ここでの変更を<b>差分として保存</b>し、起動時に config.yml へ重ねて適用します。
            そのため config.yml のコメントや書式は失われません。空欄にすると config.yml の値に戻ります。
        </v-alert>
        <v-alert v-if="restartKeys.length > 0" type="warning" density="compact" closable class="mb-3" @click:close="restartKeys = []">
            保存しました。次の項目は EPGStation の再起動後に反映されます: {{ restartKeys.join('、') }}
        </v-alert>

        <v-text-field
            v-model="keyword"
            label="設定項目を検索"
            density="compact"
            hide-details
            clearable
            prepend-inner-icon="mdi-magnify"
            class="mb-3"
        ></v-text-field>

        <v-expansion-panels v-model="openedSections" multiple>
            <v-expansion-panel v-for="section in visibleSections" :key="section.title" :title="section.title">
                <template v-slot:text>
                    <div v-for="field in section.fields" :key="field.path" class="mb-3">
                        <!-- 真偽値 -->
                        <v-switch
                            v-if="field.type === 'boolean'"
                            :model-value="valueOf(field)"
                            :label="field.label"
                            density="compact"
                            hide-details
                            color="primary"
                            @update:model-value="v => setValue(field, v)"
                        ></v-switch>

                        <!-- 選択 -->
                        <v-select
                            v-else-if="field.type === 'select'"
                            :model-value="valueOf(field)"
                            :items="field.items"
                            item-title="title"
                            item-value="value"
                            :label="field.label"
                            density="compact"
                            hide-details
                            clearable
                            @update:model-value="v => setValue(field, v)"
                        ></v-select>

                        <!-- 数値 -->
                        <v-text-field
                            v-else-if="field.type === 'number'"
                            :model-value="valueOf(field)"
                            type="number"
                            :label="field.label"
                            density="compact"
                            hide-details
                            clearable
                            @update:model-value="v => setValue(field, v === '' || v === null ? null : Number(v))"
                        ></v-text-field>

                        <!-- 文字列の配列 (1 行 1 件) -->
                        <v-textarea
                            v-else-if="field.type === 'lines'"
                            :model-value="linesOf(field)"
                            :label="field.label"
                            density="compact"
                            rows="3"
                            auto-grow
                            hide-details
                            @update:model-value="v => setLines(field, v)"
                        ></v-textarea>

                        <!-- 文字列 -->
                        <v-text-field
                            v-else
                            :model-value="valueOf(field)"
                            :label="field.label"
                            :type="field.secret === true ? 'password' : 'text'"
                            :autocomplete="field.secret === true ? 'new-password' : undefined"
                            density="compact"
                            hide-details
                            clearable
                            @update:model-value="v => setValue(field, v)"
                        ></v-text-field>

                        <div class="d-flex align-center ga-2 mt-1">
                            <span v-if="field.hint" class="text-caption text-grey">{{ field.hint }}</span>
                            <v-chip v-if="requiresRestart(field)" size="x-small" color="warning" variant="flat">要再起動</v-chip>
                            <v-chip v-if="isOverridden(field)" size="x-small" color="primary" variant="flat">画面で変更</v-chip>
                            <v-btn v-if="isOverridden(field)" size="x-small" variant="text" @click="resetField(field)">
                                config.yml の値に戻す
                            </v-btn>
                        </div>
                    </div>
                </template>
            </v-expansion-panel>

            <!-- 録画ディレクトリ -->
            <v-expansion-panel v-if="keyword === '' || keyword === null" title="録画ディレクトリ">
                <template v-slot:text>
                    <div v-for="(dir, index) in recordedDirs" :key="index" class="d-flex ga-2 mb-2 align-start">
                        <v-text-field v-model="dir.name" label="名前" density="compact" hide-details style="max-width: 180px"></v-text-field>
                        <v-text-field v-model="dir.path" label="パス" density="compact" hide-details></v-text-field>
                        <v-text-field
                            v-model.number="dir.limitThreshold"
                            type="number"
                            label="空き容量閾値 (MB)"
                            density="compact"
                            hide-details
                            style="max-width: 170px"
                        ></v-text-field>
                        <v-select
                            v-model="dir.action"
                            :items="dirActionItems"
                            item-title="title"
                            item-value="value"
                            label="超過時"
                            density="compact"
                            hide-details
                            clearable
                            style="max-width: 130px"
                        ></v-select>
                        <v-btn icon variant="text" size="small" color="error" @click="recordedDirs.splice(index, 1)">
                            <v-icon>mdi-delete</v-icon>
                        </v-btn>
                    </div>
                    <v-btn size="small" variant="tonal" @click="recordedDirs.push({ name: '', path: '' })">追加</v-btn>
                    <div class="text-caption text-grey mt-1">
                        1 件目が既定の保存先です。<v-chip size="x-small" color="warning" variant="flat" class="ml-1">要再起動</v-chip>
                    </div>
                </template>
            </v-expansion-panel>

            <!-- 配信プロファイル -->
            <v-expansion-panel v-if="keyword === '' || keyword === null" title="配信プロファイル (ライブ / 録画済み)">
                <template v-slot:text>
                    <StreamProfileEditor ref="streamEditor" :value="streamConfig"></StreamProfileEditor>
                </template>
            </v-expansion-panel>

            <!-- エンコード設定 -->
            <v-expansion-panel v-if="keyword === '' || keyword === null" title="エンコード設定">
                <template v-slot:text>
                    <div v-for="(item, index) in encodePresets" :key="index" class="mb-3">
                        <div class="d-flex ga-2 align-start">
                            <v-text-field v-model="item.name" label="名前" density="compact" hide-details style="max-width: 200px"></v-text-field>
                            <v-text-field v-model="item.id" label="id (任意)" density="compact" hide-details style="max-width: 160px"></v-text-field>
                            <v-text-field v-model="item.suffix" label="拡張子" density="compact" hide-details style="max-width: 120px"></v-text-field>
                            <v-text-field v-model.number="item.rate" type="number" step="0.1" label="rate" density="compact" hide-details style="max-width: 100px"></v-text-field>
                            <v-btn icon variant="text" size="small" color="error" @click="encodePresets.splice(index, 1)">
                                <v-icon>mdi-delete</v-icon>
                            </v-btn>
                        </div>
                        <v-text-field v-model="item.cmd" label="コマンド" density="compact" hide-details class="mt-1"></v-text-field>
                    </div>
                    <v-btn size="small" variant="tonal" @click="encodePresets.push({ name: '', cmd: '' })">追加</v-btn>
                    <div class="text-caption text-grey mt-1">
                        id を省略すると name が識別子になります。運用中に name を変えると既存の予約設定が無効になるため、id の指定を推奨します
                    </div>
                </template>
            </v-expansion-panel>
        </v-expansion-panels>

        <div class="d-flex align-center ga-2 mt-4">
            <v-btn color="primary" :loading="saving" @click="save">保存</v-btn>
            <v-btn variant="text" :disabled="saving" @click="load">変更を破棄</v-btn>
        </div>
    </div>
    <div v-else class="d-flex justify-center py-4">
        <v-progress-circular indeterminate size="24"></v-progress-circular>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISystemSettingApiModel from '@/model/api/config/ISystemSettingApiModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import StreamProfileEditor from '@/components/settings/StreamProfileEditor.vue';
import { CONFIG_FORM_SECTIONS, ConfigFormField } from '@/util/ConfigFormFields';
import { Component, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

/**
 * config.yml を画面から編集するパネル。
 * 保存は「config.yml との差分」として行い、ファイル自体は書き換えない
 */
@Component({ components: { StreamProfileEditor } })
class ConfigFormPanel extends Vue {
    loaded = false;
    saving = false;
    keyword = '';
    openedSections: number[] = [0];
    restartKeys: string[] = [];

    // config.yml の値 (差分を消したときに戻る先)
    private fileConfig: Record<string, any> = {};
    // 画面で編集中の差分
    private overlay: Record<string, any> = {};
    private fields: apid.ConfigFieldInfo[] = [];

    recordedDirs: Array<Record<string, any>> = [];
    // 配信プロファイル (stream) の編集用。子コンポーネントが直接書き換える
    streamConfig: Record<string, any> = {};
    encodePresets: Array<Record<string, any>> = [];

    readonly dirActionItems = [
        { title: '何もしない', value: 'none' },
        { title: '古い録画を削除', value: 'remove' },
    ];

    private api = container.get<ISystemSettingApiModel>('ISystemSettingApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    get visibleSections(): Array<{ title: string; fields: ConfigFormField[] }> {
        const keyword = (this.keyword ?? '').trim().toLowerCase();
        if (keyword === '') return CONFIG_FORM_SECTIONS;
        return CONFIG_FORM_SECTIONS.map(section => ({
            title: section.title,
            fields: section.fields.filter(
                f => f.label.toLowerCase().includes(keyword) || f.path.toLowerCase().includes(keyword),
            ),
        })).filter(section => section.fields.length > 0);
    }

    mounted(): void {
        void this.load();
    }

    async load(): Promise<void> {
        try {
            const result = await this.api.getEditableConfig();
            this.fileConfig = result.file ?? {};
            this.overlay = result.overlay ?? {};
            this.fields = result.fields ?? [];
            // 配列項目は編集しやすいよう実効値から複製して持つ
            this.recordedDirs = JSON.parse(JSON.stringify(result.effective?.recorded ?? []));
            this.encodePresets = JSON.parse(JSON.stringify(result.effective?.encode ?? []));
            this.streamConfig = JSON.parse(JSON.stringify(result.effective?.stream ?? {}));
            this.loaded = true;
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '設定の取得に失敗しました' });
        }
    }

    /**
     * 表示する値。差分があればそれを、無ければ config.yml の値を返す
     */
    valueOf(field: ConfigFormField): any {
        const overlaid = ConfigFormPanel.pick(this.overlay, field.path);
        return typeof overlaid === 'undefined' ? ConfigFormPanel.pick(this.fileConfig, field.path) : overlaid;
    }
    linesOf(field: ConfigFormField): string {
        const value = this.valueOf(field);
        return Array.isArray(value) ? value.join('\n') : '';
    }

    setValue(field: ConfigFormField, value: any): void {
        // 空文字・null は「差分を消して config.yml の値に戻す」
        if (value === null || value === '' || (typeof value === 'number' && Number.isNaN(value))) {
            this.resetField(field);
            return;
        }
        ConfigFormPanel.assign(this.overlay, field.path, value);
    }
    setLines(field: ConfigFormField, value: string): void {
        const lines = (value ?? '')
            .split('\n')
            .map(x => x.trim())
            .filter(x => x !== '');
        if (lines.length === 0) {
            this.resetField(field);
            return;
        }
        ConfigFormPanel.assign(this.overlay, field.path, field.itemType === 'number' ? lines.map(Number) : lines);
    }
    resetField(field: ConfigFormField): void {
        ConfigFormPanel.remove(this.overlay, field.path);
    }
    isOverridden(field: ConfigFormField): boolean {
        return typeof ConfigFormPanel.pick(this.overlay, field.path) !== 'undefined';
    }
    requiresRestart(field: ConfigFormField): boolean {
        const topKey = field.path.split('.')[0];
        return this.fields.find(x => x.key === topKey)?.requiresRestart === true;
    }

    async save(): Promise<void> {
        this.saving = true;
        try {
            const payload = JSON.parse(JSON.stringify(this.overlay));

            // 一覧で編集する項目は「config.yml と違うときだけ」差分として送る。
            // 常に送ると、触っていなくても値が差分に固定され、以後 config.yml 側の
            // 変更が反映されなくなってしまう
            const dirs = this.recordedDirs.filter(x => (x.name ?? '') !== '' && (x.path ?? '') !== '');
            if (dirs.length > 0 && ConfigFormPanel.differs(dirs, this.fileConfig.recorded)) payload.recorded = dirs;

            const presets = this.encodePresets.filter(x => (x.name ?? '') !== '' && (x.cmd ?? '') !== '');
            if (presets.length > 0 && ConfigFormPanel.differs(presets, this.fileConfig.encode)) payload.encode = presets;

            // 表示中のプロファイルも書き戻してから比較する
            const editor = this.$refs.streamEditor as { flush?: () => void } | undefined;
            editor?.flush?.();
            if (
                Object.keys(this.streamConfig).length > 0 &&
                ConfigFormPanel.differs(this.streamConfig, this.fileConfig.stream)
            ) {
                payload.stream = this.streamConfig;
            }

            const result = await this.api.update({ config: payload });
            this.restartKeys = result.requiresRestartKeys.filter(x => x.startsWith('config.'));
            this.snackbarState.open({ color: 'success', text: '設定を保存しました' });
            await this.load();
        } catch (err: any) {
            console.error(err);
            const message: string = err?.response?.data?.message ?? '';
            this.snackbarState.open({
                color: 'error',
                text: message.startsWith('AppSettingInvalid') ? `入力が不正です (${message})` : '設定の保存に失敗しました',
            });
        } finally {
            this.saving = false;
        }
    }

    /**
     * config.yml の値と違うか (同じなら差分として保存しない)
     */
    private static differs(value: unknown, fileValue: unknown): boolean {
        return JSON.stringify(value) !== JSON.stringify(fileValue ?? undefined);
    }

    /**
     * 'a.b.c' 形式のパスで値を取り出す
     */
    private static pick(source: Record<string, any>, path: string): any {
        return path.split('.').reduce<any>((acc, key) => (acc === null || typeof acc !== 'object' ? undefined : acc[key]), source);
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
    private static remove(target: Record<string, any>, path: string): void {
        const keys = path.split('.');
        let current = target;
        for (let i = 0; i < keys.length - 1; i++) {
            if (typeof current[keys[i]] !== 'object' || current[keys[i]] === null) return;
            current = current[keys[i]];
        }
        delete current[keys[keys.length - 1]];
    }
}

export default toNative(ConfigFormPanel);
</script>
