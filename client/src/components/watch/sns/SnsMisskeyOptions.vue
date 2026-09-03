<template>
    <div class="sns-misskey-options">
        <v-menu v-model="expanded" v-bind:close-on-content-click="false" location="bottom end">
            <template v-slot:activator="{ props }">
                <v-btn icon size="small" variant="outlined" density="compact" v-bind="props" title="Misskey オプション">
                    <v-icon size="16">mdi-tune-variant</v-icon>
                </v-btn>
            </template>
            <v-card class="menu-card" max-width="360">
                <v-card-text class="menu-card-body options-body">
                    <div v-if="accounts.length > 1" class="text-caption shared-hint">{{ accounts.length }} アカウント共通</div>
                    <div class="option-row">
                        <div class="text-caption option-label">公開範囲</div>
                        <v-btn-toggle v-model="visibility" mandatory density="compact" variant="outlined" divided v-bind:disabled="channelForced === true" class="visibility-toggle">
                            <v-btn value="public" size="small" title="公開"><v-icon size="16">mdi-earth</v-icon></v-btn>
                            <v-btn value="home" size="small" title="ホーム"><v-icon size="16">mdi-home</v-icon></v-btn>
                            <v-btn value="followers" size="small" title="フォロワー"><v-icon size="16">mdi-lock-outline</v-icon></v-btn>
                            <v-btn value="specified" size="small" title="ダイレクト"><v-icon size="16">mdi-email-outline</v-icon></v-btn>
                        </v-btn-toggle>
                        <div v-if="channelForced === true" class="text-caption forced-hint">チャンネル投稿は公開のみです</div>
                    </div>

                    <v-select
                        v-model="channelId"
                        v-bind:items="channelItems"
                        label="チャンネル"
                        density="comfortable"
                        hide-details
                        v-bind:loading="isLoadingChannels"
                        v-bind:disabled="accounts.length !== 1"
                        class="mt-3"
                    ></v-select>
                    <div v-if="accounts.length > 1" class="text-caption channel-disabled-hint">複数アカウント選択時はチャンネルを選べません</div>

                    <div class="option-row local-only-row mt-3">
                        <div class="local-only-label">
                            <div class="text-body-2">ローカルのみ</div>
                            <div class="text-caption text-medium-emphasis">連合しているサーバーへ配信しません</div>
                        </div>
                        <v-switch v-model="localOnly" hide-details density="compact"></v-switch>
                    </div>

                    <v-text-field
                        v-model="cw"
                        label="内容の注意書き (CW)"
                        density="comfortable"
                        hide-details
                        clearable
                        hint="投稿の前にクリックしないと本文が表示されなくなります"
                        class="mt-3"
                    ></v-text-field>
                </v-card-text>
            </v-card>
        </v-menu>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISnsPostState from '@/model/state/sns/ISnsPostState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../../api';

/**
 * SnsPostPanel が投稿のたびに切り替える Misskey 投稿オプションの値
 */
export interface SnsMisskeyOptionValue {
    visibility: apid.SnsVisibility;
    localOnly: boolean;
    channelId: string | null;
    channelName: string | null;
    cw: string;
}

/**
 * SNS 投稿パネルの Misskey 向けオプション UI (公開範囲・チャンネル・ローカルのみ・CW)。
 * 既定で畳んでおき、詳細トグルで開く。選択中の Misskey アカウント全体に一括で適用する
 */
@Component({})
class SnsMisskeyOptions extends Vue {
    // 現在選択されている Misskey アカウント (呼び出し側で 1 件以上に絞り込んで渡すこと)
    @Prop({ required: true })
    public accounts!: apid.SnsAccountItem[];

    @Prop({ required: true })
    public modelValue!: SnsMisskeyOptionValue;

    public expanded: boolean = false;
    public channels: apid.SnsMisskeyChannel[] = [];
    public isLoadingChannels: boolean = false;

    private snsPostState: ISnsPostState = container.get<ISnsPostState>('ISnsPostState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    // 直近にチャンネル一覧を取得したアカウント id (アカウントが変わっていなければ取得し直さない)
    private lastFetchedAccountId: apid.SnsAccountId | null = null;

    public get visibility(): apid.SnsVisibility {
        return this.modelValue.visibility;
    }

    public set visibility(value: apid.SnsVisibility) {
        this.$emit('update:modelValue', { ...this.modelValue, visibility: value });
    }

    public get localOnly(): boolean {
        return this.modelValue.localOnly;
    }

    public set localOnly(value: boolean) {
        this.$emit('update:modelValue', { ...this.modelValue, localOnly: value });
    }

    public get cw(): string {
        return this.modelValue.cw;
    }

    public set cw(value: string | null) {
        this.$emit('update:modelValue', { ...this.modelValue, cw: value ?? '' });
    }

    public get channelId(): string | null {
        return this.modelValue.channelId;
    }

    // チャンネルを選ぶと Misskey の仕様で公開範囲が public に強制されるため、ここでも合わせて public にする
    public set channelId(value: string | null) {
        const channelName = value === null ? null : (this.channels.find(c => c.id === value)?.name ?? null);
        this.$emit('update:modelValue', {
            ...this.modelValue,
            channelId: value,
            channelName: channelName,
            visibility: value === null ? this.modelValue.visibility : 'public',
        });
    }

    public get channelForced(): boolean {
        return this.channelId !== null;
    }

    public get channelItems(): { title: string; value: string | null }[] {
        return [{ title: 'チャンネルに投稿しない', value: null }, ...this.channels.map(c => ({ title: c.name, value: c.id }))];
    }

    public created(): void {
        this.onAccountsChanged();
    }

    // アカウントが 1 つに絞られているときだけチャンネル一覧を取得する (複数アカウントではインスタンスが異なりうるため選べない)
    @Watch('accounts', { deep: true })
    public onAccountsChanged(): void {
        if (this.accounts.length !== 1) {
            this.channels = [];
            this.lastFetchedAccountId = null;
            return;
        }

        const accountId = this.accounts[0].id;
        if (accountId === this.lastFetchedAccountId) return;
        this.lastFetchedAccountId = accountId;
        void this.fetchChannels(accountId);
    }

    private async fetchChannels(accountId: apid.SnsAccountId): Promise<void> {
        this.isLoadingChannels = true;
        try {
            this.channels = await this.snsPostState.getMisskeyChannels(accountId);
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'Misskey のチャンネル一覧の取得に失敗しました' });
        }
        this.isLoadingChannels = false;
    }
}

export default toNative(SnsMisskeyOptions);
</script>

<style lang="sass" scoped>
.sns-misskey-options
    flex: 0 0 auto

.options-body
    .shared-hint
        color: var(--watch-fg-dim)
        margin-bottom: 6px

    .option-row
        display: flex
        align-items: center
        flex-wrap: wrap
        gap: 8px

        .option-label
            flex: 0 0 auto
            color: var(--watch-fg-dim)

    .visibility-toggle
        flex-wrap: wrap

    .forced-hint
        flex: 1 1 100%
        color: var(--watch-fg-dim)

    .channel-disabled-hint
        color: var(--watch-fg-dim)
        margin-top: 2px

    .local-only-row
        .local-only-label
            flex: 1 1 auto
            min-width: 0
</style>
