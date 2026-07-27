import axios from 'axios';
import { inject, injectable } from 'inversify';
import IMetadataProviderCacheDB from '../db/IMetadataProviderCacheDB';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import ILlmTitleExtractor from './ILlmTitleExtractor';

/**
 * ローカル LLM (OpenAI 互換 Chat Completions API) を使って録画タイトルから作品名を抽出する。
 *
 * 正規表現ベースの SeriesNormalizer では拾えない変則的なタイトル
 * (未知の編成枠名・特殊な話数表記・サブタイトル連結など) を想定したフォールバックであり、
 * 作品辞書 (しょぼいカレンダー + Annict) で確定できなかった場合にのみ呼ばれることを前提とする。
 * 抽出結果はそのまま信用せず、呼び出し側が必ず作品辞書で引き直して検証する (ハルシネーション対策)。
 *
 * - 同一タイトルの再問い合わせを避けるため結果をメモリにキャッシュする
 * - LLM サーバーが落ちている場合に録画後処理を遅延させ続けないよう、
 *   連続失敗で一定時間呼び出しを休止する (サーキットブレーカー)
 */
@injectable()
export default class LlmTitleExtractor implements ILlmTitleExtractor {
    private static readonly DEFAULT_TIMEOUT_MS = 30 * 1000;
    // 抽出結果キャッシュの上限 (バックフィルで大量のタイトルを処理してもメモリを食いつぶさないように)
    private static readonly CACHE_MAX = 5000;
    // 抽出結果の永続キャッシュ (metadata_provider_cache) の provider 名と TTL。
    // 起動時パイプラインが未リンク録画を毎回再照合しても、同じタイトルを LLM へ再問い合わせしないようにする
    private static readonly CACHE_PROVIDER = 'seriesLlm';
    private static readonly CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    // この回数連続で失敗したら COOLDOWN_MS の間呼び出しを休止する
    private static readonly FAILURE_LIMIT = 5;
    private static readonly COOLDOWN_MS = 10 * 60 * 1000;
    // 抽出結果として受け入れる作品名の長さの範囲
    private static readonly MIN_TITLE_LENGTH = 2;
    private static readonly MAX_TITLE_LENGTH = 100;

    private static readonly SYSTEM_PROMPT = [
        'あなたは日本のテレビ番組表 (EPG) の録画タイトルから、アニメの正式な作品名を 1 つ抽出するアシスタントです。',
        '以下のルールに従い、必ず JSON のみを出力してください。',
        '- 出力形式: {"title":"作品名"} または {"title":null}',
        '- 放送局の編成枠名 (「ノイタミナ」「アニメシャワー」「日5」など)・[字][新][終][再][デ] などのマーカー・話数 (第3話 / #12 / Episode 5 など)・各話サブタイトル・出演者情報は取り除く',
        '- 「第2期」「2nd Season」のような続編表記は作品名の一部として残す',
        '- 読み仮名だけの括弧 (例: 「羅小黒戦記(ロシャオヘイセンキ)」の括弧内) は取り除く',
        '- アニメ以外の番組 (ニュース・実写ドラマ・バラエティなど) の場合や、作品名を特定できない場合は {"title":null} を返す',
        '- 説明文やマークダウンは一切出力しない',
    ].join('\n');

    private log: ILogger;
    private config: IConfigFile;

    private cache: Map<string, string | null> = new Map();
    private consecutiveFailures: number = 0;
    private suspendedUntil: number = 0;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IMetadataProviderCacheDB') private cacheDB: IMetadataProviderCacheDB,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
    }

    public isEnabled(): boolean {
        const llm = this.config.seriesLlm;
        return (
            typeof llm !== 'undefined' &&
            typeof llm.url === 'string' &&
            llm.url !== '' &&
            typeof llm.model === 'string' &&
            llm.model !== ''
        );
    }

    public async extractWorkTitle(recordedTitle: string): Promise<string | null> {
        if (this.isEnabled() === false) return null;
        if (Date.now() < this.suspendedUntil) return null;

        const cached = this.cache.get(recordedTitle);
        if (typeof cached !== 'undefined') return cached;

        // プロセス再起動をまたいで同じタイトルを再問い合わせしないよう、永続キャッシュも参照する
        const persisted = await this.getPersistentCache(recordedTitle);
        if (typeof persisted !== 'undefined') {
            this.putCache(recordedTitle, persisted);

            return persisted;
        }

        try {
            const title = await this.request(recordedTitle);
            this.consecutiveFailures = 0;
            this.putCache(recordedTitle, title);
            await this.putPersistentCache(recordedTitle, title);
            return title;
        } catch (err: any) {
            this.consecutiveFailures++;
            this.log.system.warn(`llm title extraction failed: ${err?.message ?? err}`);
            if (this.consecutiveFailures >= LlmTitleExtractor.FAILURE_LIMIT) {
                this.suspendedUntil = Date.now() + LlmTitleExtractor.COOLDOWN_MS;
                this.consecutiveFailures = 0;
                this.log.system.warn(
                    `llm title extraction suspended for ${LlmTitleExtractor.COOLDOWN_MS / 1000} sec (too many failures)`,
                );
            }
            return null;
        }
    }

    /**
     * OpenAI 互換 Chat Completions API へ問い合わせ、抽出された作品名を返す
     */
    private async request(recordedTitle: string): Promise<string | null> {
        const llm = this.config.seriesLlm as NonNullable<IConfigFile['seriesLlm']>;
        const baseUrl = (llm.url as string).replace(/\/+$/u, '');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (typeof llm.apiKey === 'string' && llm.apiKey !== '') headers.Authorization = `Bearer ${llm.apiKey}`;

        const response = await axios.post(
            `${baseUrl}/chat/completions`,
            {
                model: llm.model,
                messages: [
                    { role: 'system', content: LlmTitleExtractor.SYSTEM_PROMPT },
                    { role: 'user', content: recordedTitle },
                ],
                temperature: 0,
                max_tokens: 200,
                stream: false,
            },
            { headers, timeout: llm.timeoutMs ?? LlmTitleExtractor.DEFAULT_TIMEOUT_MS },
        );

        const content = response.data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('unexpected llm response shape');
        return this.parseContent(content);
    }

    /**
     * LLM の応答文字列から {"title": ...} を取り出す。
     * コードフェンスや前後の説明文が付いていても最初の JSON オブジェクトを拾う
     */
    private parseContent(content: string): string | null {
        const json = content.match(/\{[\s\S]*?\}/u);
        if (json === null) throw new Error('llm response has no json');
        const parsed = JSON.parse(json[0]);
        const title = parsed?.title;
        if (title === null || typeof title === 'undefined') return null;
        if (typeof title !== 'string') throw new Error('llm response title is not a string');
        const trimmed = title.trim();
        if (
            trimmed.length < LlmTitleExtractor.MIN_TITLE_LENGTH ||
            trimmed.length > LlmTitleExtractor.MAX_TITLE_LENGTH
        ) {
            return null;
        }
        return trimmed;
    }

    /**
     * 永続キャッシュから抽出結果を引く。未登録・期限切れ・読み取り失敗時は undefined を返す
     */
    private async getPersistentCache(recordedTitle: string): Promise<string | null | undefined> {
        try {
            const row = await this.cacheDB.get(LlmTitleExtractor.CACHE_PROVIDER, recordedTitle);
            if (row === null || Number(row.expiresAt) < Date.now()) return undefined;
            const parsed = JSON.parse(row.payload);
            const title = parsed?.title;

            return typeof title === 'string' ? title : null;
        } catch {
            return undefined;
        }
    }

    /**
     * 抽出結果を永続キャッシュへ保存する (失敗しても抽出処理は止めない)
     */
    private async putPersistentCache(recordedTitle: string, title: string | null): Promise<void> {
        try {
            await this.cacheDB.put(
                LlmTitleExtractor.CACHE_PROVIDER,
                recordedTitle,
                { title },
                null,
                Date.now() + LlmTitleExtractor.CACHE_TTL_MS,
            );
        } catch {
            this.log.system.warn('llm title extraction: failed to persist cache');
        }
    }

    private putCache(key: string, value: string | null): void {
        if (this.cache.size >= LlmTitleExtractor.CACHE_MAX) {
            // Map は挿入順を保つので先頭 (最古) を間引く
            const oldest = this.cache.keys().next().value;
            if (typeof oldest !== 'undefined') this.cache.delete(oldest);
        }
        this.cache.set(key, value);
    }
}
