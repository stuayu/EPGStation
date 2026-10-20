<template>
    <v-dialog v-model="dialogModel" :fullscreen="isMobile === true" max-width="640">
        <v-card>
            <v-card-title>実況コメントのミュート</v-card-title>
            <v-card-text class="mute-body">
                <v-switch v-model="settings.muteVulgar" label="下品な表現" hide-details></v-switch>
                <v-switch v-model="settings.muteAbusive" label="差別的・攻撃的な表現" hide-details></v-switch>
                <v-switch v-model="settings.muteBigSize" label="大きいコメント" hide-details></v-switch>
                <v-switch v-model="settings.muteFixed" label="上下固定コメント" hide-details></v-switch>
                <v-switch v-model="settings.muteColored" label="色付きコメント" hide-details></v-switch>
                <v-switch v-model="settings.muteConsecutiveCharacters" label="同じ文字が8文字以上続くコメント" hide-details></v-switch>
                <v-switch v-model="settings.muteEmojiOnly" label="絵文字だけのコメント" hide-details></v-switch>
                <v-text-field v-model="userIds" label="ミュートするユーザー ID (カンマ区切り)" @update:model-value="saveUserIds"></v-text-field>
                <v-text-field v-model="keyword" label="キーワード" @keyup.enter="addKeyword"></v-text-field>
                <div class="d-flex ga-2 align-center">
                    <v-select v-model="keywordMatch" :items="matchItems" label="一致方法" density="compact"></v-select>
                    <v-btn @click="addKeyword">追加</v-btn>
                </div>
                <v-chip v-for="(item, index) in settings.mutedKeywords" :key="index" closable @click:close="removeKeyword(index)">
                    {{ matchLabel(item.match) }}: {{ item.pattern }}
                </v-chip>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn @click="dialogModel = false">閉じる</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import container from '@/model/ModelContainer';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import { mergeCommentMuteSettings, type CommentKeywordMatch, type CommentMuteSettings } from '@/util/CommentMuteUtil';

/**
 * ミュート設定を複製する。this.settings は Vue のリアクティブな Proxy なので structuredClone は使えない
 * (DataCloneError で視聴画面ごと描画されなくなる)。値は JSON で表せるものだけなので JSON 経由で複製する
 */
const cloneMuteSettings = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

@Component({})
class JikkyoCommentMuteDialog extends Vue {
    @Prop({ required: true }) public modelValue!: boolean;
    public settings: CommentMuteSettings = { normalizeKeywords: true, mutedUserIds: [], mutedKeywords: [] };
    public userIds = '';
    public keyword = '';
    public keywordMatch: CommentKeywordMatch = 'partial';
    public matchItems = [
        { title: '部分一致', value: 'partial' },
        { title: '前方一致', value: 'forward' },
        { title: '後方一致', value: 'backward' },
        { title: '完全一致', value: 'exact' },
        { title: '正規表現', value: 'regex' },
    ];
    private storage = container.get<ISettingStorageModel>('ISettingStorageModel');
    private baseline: CommentMuteSettings = {};
    get dialogModel(): boolean {
        return this.modelValue;
    }
    set dialogModel(value: boolean) {
        this.$emit('update:modelValue', value);
    }
    get isMobile(): boolean {
        return this.$vuetify.display.smAndDown;
    }
    public created(): void {
        this.reload();
    }
    @Watch('settings', { deep: true }) public onSettingsChanged(): void {
        this.save();
    }
    @Watch('modelValue') public onDialogVisibilityChanged(value: boolean): void {
        if (value === true) this.reload();
    }
    public reload(): void {
        this.settings = cloneMuteSettings(this.storage.tmp.jikkyoCommentMuteSettings);
        this.baseline = cloneMuteSettings(this.settings);
        this.userIds = (this.settings.mutedUserIds ?? []).join(', ');
    }
    public saveUserIds(): void {
        this.settings.mutedUserIds = this.userIds
            .split(',')
            .map(value => value.trim())
            .filter(Boolean);
        this.save();
    }
    public addKeyword(): void {
        const pattern = this.keyword.trim();
        if (!pattern) return;
        this.settings.mutedKeywords = [...(this.settings.mutedKeywords ?? []), { match: this.keywordMatch, pattern }];
        this.keyword = '';
        this.save();
    }
    public removeKeyword(index: number): void {
        this.settings.mutedKeywords?.splice(index, 1);
        this.save();
    }
    public matchLabel(match: CommentKeywordMatch): string {
        return { partial: '部分一致', forward: '前方一致', backward: '後方一致', exact: '完全一致', regex: '正規表現' }[match];
    }
    private save(): void {
        const latest = this.storage.tmp.jikkyoCommentMuteSettings;
        const merged = mergeCommentMuteSettings(this.baseline, this.settings, latest);
        if (JSON.stringify(merged) !== JSON.stringify(this.settings)) this.settings = cloneMuteSettings(merged);
        this.baseline = cloneMuteSettings(merged);
        this.storage.tmp.jikkyoCommentMuteSettings = merged;
        this.storage.save();
        window.dispatchEvent(new Event('jikkyo-comment-mute-settings-updated'));
    }
}
export default toNative(JikkyoCommentMuteDialog);
</script>

<style scoped>
.mute-body {
    max-height: min(75vh, 680px);
    overflow-y: auto;
}
</style>
