<template>
    <v-main>
        <TitleBar title="SNS 連携"></TitleBar>
        <v-container>
            <v-card class="mx-auto mb-4" max-width="800">
                <v-card-text>
                    <div class="text-caption text-medium-emphasis mb-2">
                        視聴画面から Bluesky / Misskey へ投稿できるようにアカウントを連携します。認証情報はサーバー側で暗号化して保存され、クライアントへは返りません。
                    </div>
                    <div class="d-flex flex-wrap ga-2">
                        <v-btn color="primary" variant="flat" prepend-icon="mdi-butterfly-outline" @click="openBlueskyDialog()">Bluesky を連携</v-btn>
                        <v-btn color="primary" variant="flat" prepend-icon="mdi-account-multiple-plus-outline" @click="openMisskeyDialog()">Misskey を連携</v-btn>
                    </div>
                </v-card-text>
            </v-card>

            <v-card class="mx-auto" max-width="800">
                <v-card-title class="text-subtitle-1">連携済みアカウント</v-card-title>
                <v-card-text v-if="isLoading === true" class="d-flex justify-center pa-6">
                    <v-progress-circular indeterminate color="primary"></v-progress-circular>
                </v-card-text>
                <v-card-text v-else-if="accounts.length === 0" class="text-body-2 text-medium-emphasis">
                    連携済みのアカウントはありません
                </v-card-text>
                <template v-else>
                    <v-list-item v-for="a in accounts" :key="a.id" class="account-item" lines="two">
                        <template v-slot:prepend>
                            <v-avatar>
                                <v-img v-if="a.avatarUrl !== null" :src="a.avatarUrl"></v-img>
                                <v-icon v-else>{{ a.provider === 'bluesky' ? 'mdi-butterfly-outline' : 'mdi-account-circle' }}</v-icon>
                            </v-avatar>
                        </template>
                        <v-list-item-title class="account-title">
                            {{ a.displayName }}
                            <v-chip size="x-small" variant="outlined" class="ml-1">{{ a.provider === 'bluesky' ? 'Bluesky' : 'Misskey' }}</v-chip>
                            <v-chip v-if="a.needsReauth === true" size="x-small" color="error" variant="flat" class="ml-1" :title="reauthReasonText(a)">要再連携</v-chip>
                        </v-list-item-title>
                        <v-list-item-subtitle class="account-subtitle">
                            @{{ a.handle }}<template v-if="a.instanceUrl !== null"> ({{ a.instanceUrl }})</template>
                        </v-list-item-subtitle>
                        <template v-slot:append>
                            <div class="d-flex flex-wrap ga-1 justify-end">
                                <v-btn v-if="a.needsReauth === true" size="small" variant="text" color="warning" @click="reauth(a)">再連携</v-btn>
                                <v-btn v-if="a.provider === 'misskey'" size="small" variant="text" @click="openMisskeySettingsDialog(a)">設定</v-btn>
                                <v-btn size="small" variant="text" color="error" @click="confirmDelete(a)">解除</v-btn>
                            </div>
                        </template>
                    </v-list-item>
                </template>
            </v-card>
        </v-container>

        <!-- Bluesky 連携ダイアログ -->
        <v-dialog v-model="isOpenBlueskyDialog" max-width="440" :fullscreen="isMobile === true">
            <v-card>
                <v-card-title>Bluesky を連携</v-card-title>
                <v-card-text>
                    <v-text-field v-model="blueskyIdentifier" label="ハンドル または メールアドレス" density="comfortable" autocomplete="username"></v-text-field>
                    <v-text-field
                        v-model="blueskyAppPassword"
                        label="アプリパスワード"
                        type="password"
                        density="comfortable"
                        autocomplete="current-password"
                        hint="通常のログインパスワードではありません"
                        persistent-hint
                    ></v-text-field>
                    <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener noreferrer" class="text-caption d-inline-block mt-2">
                        アプリパスワードを発行する (bsky.app が開きます)
                    </a>
                    <v-alert v-if="blueskyErrorMessage !== ''" type="error" density="compact" class="mt-3">{{ blueskyErrorMessage }}</v-alert>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenBlueskyDialog = false">キャンセル</v-btn>
                    <v-btn
                        color="primary"
                        variant="text"
                        :loading="isBlueskySaving"
                        :disabled="blueskyIdentifier.trim() === '' || blueskyAppPassword.trim() === ''"
                        @click="submitBluesky"
                    >
                        連携する
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Misskey 連携ダイアログ (MiAuth ワンクリック) -->
        <v-dialog v-model="isOpenMisskeyDialog" max-width="440" :fullscreen="isMobile === true">
            <v-card>
                <v-card-title>Misskey を連携</v-card-title>
                <v-card-text>
                    <v-text-field
                        v-model="misskeyInstanceUrl"
                        label="インスタンス URL"
                        placeholder="misskey.io"
                        density="comfortable"
                        hint="ホスト名だけでも https://... の形でも入力できます"
                        persistent-hint
                        @keydown.enter="submitMisskeyAuth"
                    ></v-text-field>
                    <div class="text-caption text-medium-emphasis mt-2">
                        ボタンを押すと Misskey の承認画面へ移動します。承認するとこの画面へ自動的に戻ります (MiAuth)。
                    </div>
                    <v-alert v-if="misskeyErrorMessage !== ''" type="error" density="compact" class="mt-3">{{ misskeyErrorMessage }}</v-alert>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenMisskeyDialog = false">キャンセル</v-btn>
                    <v-btn color="primary" variant="text" :loading="isMisskeyAuthing" :disabled="misskeyInstanceUrl.trim() === ''" @click="submitMisskeyAuth">
                        連携する
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Misskey アカウントごとの既定値設定ダイアログ -->
        <v-dialog v-model="isOpenMisskeySettingsDialog" max-width="440" :fullscreen="isMobile === true">
            <v-card v-if="misskeySettingsTarget !== null">
                <v-card-title>{{ misskeySettingsTarget.displayName }} の既定値</v-card-title>
                <v-card-text class="menu-card-body">
                    <v-select
                        v-model="misskeySettingsVisibility"
                        :items="visibilityItems"
                        label="公開範囲"
                        density="comfortable"
                        hint="チャンネル投稿先を指定すると公開範囲は自動的に公開になります"
                        persistent-hint
                    ></v-select>
                    <v-select
                        v-model="misskeySettingsChannelId"
                        :items="channelItems"
                        label="チャンネル"
                        density="comfortable"
                        :loading="isLoadingChannels"
                        clearable
                        class="mt-4"
                        hint="指定しない場合は通常のノートとして投稿されます"
                        persistent-hint
                    ></v-select>
                    <div class="my-2 d-flex flex-row align-center">
                        <div>
                            <v-list-item-title class="text-subtitle-1">ローカルのみ</v-list-item-title>
                            <v-list-item-subtitle>連合しているサーバーへ配信しません</v-list-item-subtitle>
                        </div>
                        <v-spacer></v-spacer>
                        <v-switch v-model="misskeySettingsLocalOnly"></v-switch>
                    </div>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenMisskeySettingsDialog = false">キャンセル</v-btn>
                    <v-btn color="primary" variant="text" :loading="isMisskeySettingsSaving" @click="submitMisskeySettings">保存</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- 連携解除の確認ダイアログ -->
        <v-dialog v-model="isOpenDeleteDialog" max-width="400">
            <v-card v-if="deleteTarget !== null">
                <v-card-title>連携を解除しますか?</v-card-title>
                <v-card-text>{{ deleteTarget.displayName }} (@{{ deleteTarget.handle }}) の連携を解除します。SNS 側のアプリ連携は別途取り消してください。</v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenDeleteDialog = false">キャンセル</v-btn>
                    <v-btn color="error" variant="text" :loading="isDeleting" @click="submitDelete">解除する</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-main>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISnsAccountsState from '@/model/state/sns/ISnsAccountsState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../api';

interface SelectItem<T> {
    title: string;
    value: T;
}

@Component({ components: { TitleBar } })
class SnsAccounts extends Vue {
    public isLoading: boolean = false;

    private snsAccountsState: ISnsAccountsState = container.get<ISnsAccountsState>('ISnsAccountsState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    get isMobile(): boolean {
        return this.$vuetify.display.smAndDown;
    }

    get accounts(): apid.SnsAccountItem[] {
        return this.snsAccountsState.getAccounts();
    }

    public readonly visibilityItems: SelectItem<apid.SnsVisibility>[] = [
        { title: '公開', value: 'public' },
        { title: 'ホーム', value: 'home' },
        { title: 'フォロワー', value: 'followers' },
        { title: 'ダイレクト', value: 'specified' },
    ];

    /**
     * 一覧を取得し直す
     */
    public async fetchAccounts(): Promise<void> {
        this.isLoading = true;
        try {
            await this.snsAccountsState.fetchAccounts();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '連携アカウント一覧の取得に失敗しました' });
        }
        this.isLoading = false;
    }

    public async mounted(): Promise<void> {
        // MiAuth コールバックから戻ってきた場合はクエリで結果が渡ってくる
        const misskeyResult = typeof this.$route.query.misskey === 'string' ? this.$route.query.misskey : null;
        if (misskeyResult !== null) {
            if (misskeyResult === 'success') {
                this.snackbarState.open({ color: 'success', text: 'Misskey アカウントを連携しました' });
            } else {
                const reason = typeof this.$route.query.reason === 'string' ? this.$route.query.reason : '';
                this.snackbarState.open({ color: 'error', text: `Misskey の連携に失敗しました${reason !== '' ? ` (${reason})` : ''}` });
            }
            // 履歴を汚さないようクエリを消す (このページ自体の再取得は下の fetchAccounts で行う)
            await this.$router.replace({ path: '/settings/sns' });
        }

        await this.fetchAccounts();
    }

    // --- Bluesky 連携 ---
    public isOpenBlueskyDialog: boolean = false;
    public blueskyIdentifier: string = '';
    public blueskyAppPassword: string = '';
    public blueskyErrorMessage: string = '';
    public isBlueskySaving: boolean = false;

    public openBlueskyDialog(): void {
        this.blueskyIdentifier = '';
        this.blueskyAppPassword = '';
        this.blueskyErrorMessage = '';
        this.isOpenBlueskyDialog = true;
    }

    public async submitBluesky(): Promise<void> {
        if (this.blueskyIdentifier.trim() === '' || this.blueskyAppPassword.trim() === '') {
            return;
        }

        this.isBlueskySaving = true;
        this.blueskyErrorMessage = '';
        try {
            await this.snsAccountsState.loginBluesky({
                identifier: this.blueskyIdentifier.trim(),
                appPassword: this.blueskyAppPassword.trim(),
            });
            this.isOpenBlueskyDialog = false;
            this.snackbarState.open({ color: 'success', text: 'Bluesky アカウントを連携しました' });
        } catch (err) {
            console.error(err);
            this.blueskyErrorMessage = 'ログインに失敗しました。ハンドルとアプリパスワードを確認してください';
        }
        this.isBlueskySaving = false;
    }

    /**
     * 再連携が必要な理由を短い説明文にする (チップの title に表示)
     * @param account: apid.SnsAccountItem
     * @return string
     */
    public reauthReasonText(account: apid.SnsAccountItem): string {
        if (account.needsReauthReason === 'permission') {
            // MiAuth は permission がトークン発行時に固定されるため、後から要求権限を増やしても
            // 既存の連携には反映されない。再連携すると現在必要な権限が付与し直される
            return '連携時に付与した権限が古く、一部の操作 (リアクション等) に必要な権限が不足しています。再連携すると解消します';
        }
        if (account.needsReauthReason === 'encryption') {
            return '保存されている認証情報を復号できません。再連携が必要です';
        }

        return '';
    }

    /**
     * 再連携 (トークン切れ等)。Bluesky はログインダイアログを、Misskey は認証ダイアログを開き直す
     * @param account: apid.SnsAccountItem
     */
    public reauth(account: apid.SnsAccountItem): void {
        if (account.provider === 'bluesky') {
            this.openBlueskyDialog();
            this.blueskyIdentifier = account.handle;
        } else {
            this.openMisskeyDialog();
            this.misskeyInstanceUrl = account.instanceUrl ?? '';
        }
    }

    // --- Misskey 連携 (MiAuth) ---
    public isOpenMisskeyDialog: boolean = false;
    public misskeyInstanceUrl: string = '';
    public misskeyErrorMessage: string = '';
    public isMisskeyAuthing: boolean = false;

    public openMisskeyDialog(): void {
        this.misskeyInstanceUrl = '';
        this.misskeyErrorMessage = '';
        this.isOpenMisskeyDialog = true;
    }

    /**
     * MiAuth の認証セッションを作成し、返ってきた authUrl へブラウザを遷移させる。
     * 承認後は Misskey がサーバーのコールバックへリダイレクトし、このページへ戻ってくる
     */
    public async submitMisskeyAuth(): Promise<void> {
        if (this.misskeyInstanceUrl.trim() === '') {
            return;
        }

        this.isMisskeyAuthing = true;
        this.misskeyErrorMessage = '';
        try {
            const session = await this.snsAccountsState.createMisskeyAuthSession({ instanceUrl: this.misskeyInstanceUrl.trim() });
            window.location.href = session.authUrl;
        } catch (err) {
            console.error(err);
            this.misskeyErrorMessage = '認証セッションの作成に失敗しました。インスタンス URL を確認してください';
            this.isMisskeyAuthing = false;
        }
    }

    // --- Misskey アカウントごとの既定値設定 ---
    public isOpenMisskeySettingsDialog: boolean = false;
    public misskeySettingsTarget: apid.SnsAccountItem | null = null;
    public misskeySettingsVisibility: apid.SnsVisibility = 'public';
    public misskeySettingsChannelId: string | null = null;
    public misskeySettingsLocalOnly: boolean = false;
    public isLoadingChannels: boolean = false;
    public isMisskeySettingsSaving: boolean = false;
    public channelItems: SelectItem<string>[] = [];

    public async openMisskeySettingsDialog(account: apid.SnsAccountItem): Promise<void> {
        this.misskeySettingsTarget = account;
        this.misskeySettingsVisibility = account.defaultVisibility ?? 'public';
        this.misskeySettingsChannelId = account.defaultChannelId;
        this.misskeySettingsLocalOnly = account.isDefaultLocalOnly;
        this.channelItems = account.defaultChannelId === null || account.defaultChannelName === null ? [] : [{ title: account.defaultChannelName, value: account.defaultChannelId }];
        this.isOpenMisskeySettingsDialog = true;

        this.isLoadingChannels = true;
        try {
            const channels = await this.snsAccountsState.getMisskeyChannels(account.id);
            this.channelItems = channels.map(c => ({ title: c.name, value: c.id }));
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'チャンネル一覧の取得に失敗しました' });
        }
        this.isLoadingChannels = false;
    }

    public async submitMisskeySettings(): Promise<void> {
        if (this.misskeySettingsTarget === null) {
            return;
        }

        const channelName = this.channelItems.find(c => c.value === this.misskeySettingsChannelId)?.title ?? null;

        this.isMisskeySettingsSaving = true;
        try {
            await this.snsAccountsState.updateAccount(this.misskeySettingsTarget.id, {
                defaultVisibility: this.misskeySettingsVisibility,
                defaultChannelId: this.misskeySettingsChannelId,
                defaultChannelName: this.misskeySettingsChannelId === null ? null : channelName,
                isDefaultLocalOnly: this.misskeySettingsLocalOnly,
            });
            this.isOpenMisskeySettingsDialog = false;
            this.snackbarState.open({ color: 'success', text: '設定を保存しました' });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '設定の保存に失敗しました' });
        }
        this.isMisskeySettingsSaving = false;
    }

    // --- 連携解除 ---
    public isOpenDeleteDialog: boolean = false;
    public deleteTarget: apid.SnsAccountItem | null = null;
    public isDeleting: boolean = false;

    public confirmDelete(account: apid.SnsAccountItem): void {
        this.deleteTarget = account;
        this.isOpenDeleteDialog = true;
    }

    public async submitDelete(): Promise<void> {
        if (this.deleteTarget === null) {
            return;
        }

        this.isDeleting = true;
        try {
            await this.snsAccountsState.deleteAccount(this.deleteTarget.id);
            this.isOpenDeleteDialog = false;
            this.snackbarState.open({ color: 'success', text: '連携を解除しました' });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '連携の解除に失敗しました' });
        }
        this.isDeleting = false;
    }
}

export default toNative(SnsAccounts);
</script>

<style lang="sass" scoped>
.account-item
    border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity))

    &:last-child
        border-bottom: none

// v-list-item-title は既定で nowrap のため、表示名 + チップが並ぶこの行は折り返す
.account-title
    white-space: normal

.account-subtitle
    white-space: normal
</style>
