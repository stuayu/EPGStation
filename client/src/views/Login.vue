<template>
    <v-app class="login-root">
        <v-main>
            <v-container class="fill-height">
                <v-card class="mx-auto" max-width="420" width="100%">
                    <v-card-title class="text-h6">
                        {{ isSetup === true ? 'EPGStation の初期設定' : 'EPGStation へログイン' }}
                    </v-card-title>
                    <v-card-subtitle v-if="isSetup === true">
                        最初のログインユーザーを作成します
                    </v-card-subtitle>
                    <v-card-text>
                        <!-- SSO でのログイン / サインアップ -->
                        <template v-if="providers.length > 0">
                            <v-btn
                                v-for="p in providers"
                                :key="p.id"
                                block
                                variant="outlined"
                                class="mb-2"
                                :prepend-icon="providerIcon(p.id)"
                                :href="p.authorizeUrl"
                            >
                                {{ p.label }} で{{ isSetup === true ? 'はじめる' : 'ログイン' }}
                            </v-btn>
                            <div v-if="isSetup === true" class="text-caption text-grey mb-2">
                                最初にサインアップした人がシステム管理者になります
                            </div>
                            <div class="d-flex align-center my-3">
                                <v-divider></v-divider>
                                <span class="text-caption text-grey mx-2">または</span>
                                <v-divider></v-divider>
                            </div>
                        </template>

                        <v-form @submit.prevent="submit">
                            <v-text-field
                                v-model="name"
                                label="ユーザー名"
                                autocomplete="username"
                                density="comfortable"
                                autofocus
                            ></v-text-field>
                            <v-text-field
                                v-model="password"
                                label="パスワード"
                                type="password"
                                :autocomplete="isSetup === true ? 'new-password' : 'current-password'"
                                density="comfortable"
                                :hint="isSetup === true ? '8 文字以上' : undefined"
                                :persistent-hint="isSetup === true"
                            ></v-text-field>
                            <v-text-field
                                v-if="isSetup === true"
                                v-model="passwordConfirm"
                                label="パスワード (確認)"
                                type="password"
                                autocomplete="new-password"
                                density="comfortable"
                            ></v-text-field>
                            <v-alert v-if="errorMessage !== ''" type="error" density="compact" class="mt-2">
                                {{ errorMessage }}
                            </v-alert>
                            <v-btn
                                type="submit"
                                color="primary"
                                block
                                class="mt-4"
                                :loading="submitting"
                                :disabled="canSubmit === false"
                            >
                                {{ isSetup === true ? '作成してはじめる' : 'ログイン' }}
                            </v-btn>
                        </v-form>
                    </v-card-text>
                </v-card>
            </v-container>
        </v-main>
    </v-app>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IAuthApiModel from '@/model/api/auth/IAuthApiModel';
import * as apid from '../../../api';

type AuthProviderItem = apid.AuthProviderItem;
import { Component, Vue, toNative } from 'vue-facing-decorator';

@Component({})
class Login extends Vue {
    name = '';
    password = '';
    passwordConfirm = '';
    // 初期ユーザーが未作成なら「作成」モードで表示する
    isSetup = false;
    providers: AuthProviderItem[] = [];
    submitting = false;
    errorMessage = '';

    private api = container.get<IAuthApiModel>('IAuthApiModel');

    providerIcon(id: string): string {
        return id === 'google' ? 'mdi-google' : id === 'github' ? 'mdi-github' : 'mdi-login-variant';
    }

    get canSubmit(): boolean {
        if (this.name.trim() === '' || this.password === '') return false;
        if (this.isSetup === true && this.password !== this.passwordConfirm) return false;
        return true;
    }

    async mounted(): Promise<void> {
        try {
            const status = await this.api.getStatus();
            // 認証が無効 / すでにログイン済みなら通常画面へ戻す。
            // この画面は router を持たない単独マウントなので、location で読み込み直す
            if (status.enabled === false || status.user !== null) {
                window.location.replace(window.location.pathname);

                return;
            }
            this.isSetup = status.initialized === false;
            this.providers = status.providers;
        } catch (err) {
            console.error(err);
        }
        // SSO のコールバックで失敗した場合はクエリで理由が渡ってくる
        const error = new URLSearchParams(window.location.search).get('authError');
        if (error !== null) this.errorMessage = Login.toMessage({ response: { data: { message: error } } });
    }

    async submit(): Promise<void> {
        if (this.canSubmit === false) return;
        this.submitting = true;
        this.errorMessage = '';
        try {
            if (this.isSetup === true) await this.api.setup(this.name.trim(), this.password);
            else await this.api.login(this.name.trim(), this.password);
            // 認証状態に依存する初期化 (config 取得・socket.io 接続) をやり直すため画面ごと読み込み直す
            window.location.replace(window.location.pathname);
        } catch (err: any) {
            console.error(err);
            this.errorMessage = Login.toMessage(err);
        } finally {
            this.submitting = false;
        }
    }

    /**
     * サーバが返すエラーコードを画面向けの文言にする
     */
    private static toMessage(err: any): string {
        const message = err?.response?.data?.message ?? '';
        switch (message) {
            case 'InvalidCredentials':
                return 'ユーザー名またはパスワードが違います';
            case 'PasswordIsTooShort':
                return 'パスワードは 8 文字以上にしてください';
            case 'PasswordIsTooLong':
                return 'パスワードが長すぎます';
            case 'InvalidUserName':
                return 'ユーザー名を入力してください';
            case 'UserNameIsAlreadyUsed':
                return 'そのユーザー名はすでに使われています';
            case 'AuthIsAlreadyInitialized':
                return 'すでに初期設定が済んでいます。画面を再読み込みしてください';
            case 'SigningKeyIsNotAvailable':
                return '暗号化鍵を読み込めませんでした (data/key/secret.key を確認してください)';
            case 'SignUpIsNotAllowed':
                return '新規サインアップは許可されていません。管理者にユーザーの作成を依頼してください';
            case 'InvalidOAuthState':
                return 'ログインの有効期限が切れました。もう一度お試しください';
            case 'OAuthProviderIsNotConfigured':
                return 'この連携は設定されていません (config.yml の auth.providers を確認してください)';
            case 'OAuthTokenExchangeFailed':
            case 'OAuthRequestFailed':
            case 'OAuthProfileIsNotAvailable':
                return '外部サービスとの連携に失敗しました';
            default:
                return err?.response?.status === 401 ? 'ユーザー名またはパスワードが違います' : 'ログインに失敗しました';
        }
    }
}

export default toNative(Login);
</script>

<style lang="sass" scoped>
.login-root
    .fill-height
        display: flex
        align-items: center
        justify-content: center
</style>
