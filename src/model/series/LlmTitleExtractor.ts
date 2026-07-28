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
 * - ローカル LLM だけでなく OpenRouter 等の従量/フリー枠のホスティング API も想定するため、
 *   リクエスト間隔の下限 (minIntervalMs) と 429 の Retry-After に従う
 */
@injectable()
export default class LlmTitleExtractor implements ILlmTitleExtractor {
    private static readonly DEFAULT_TIMEOUT_MS = 30 * 1000;
    // 応答の上限トークン数。
    // reasoning 系モデルは本文の前に思考へ数百トークン使うため、小さいと content が空のまま
    // finish_reason: 'length' で切れる (OpenRouter のフリーモデルはほぼこれに該当する)。
    // 非 reasoning モデルは JSON を出した時点で停止するので、大きくしても実コストは増えない
    private static readonly DEFAULT_MAX_TOKENS = 2000;
    // finish_reason: 'length' で本文が空だった場合に上限をこの倍率で引き上げて 1 度だけやり直す。
    // reasoning モデルの思考量はモデル・入力ごとに大きく振れるため、固定値を上げ続けるより
    // 「足りなければ増やして覚える」方が無駄が少ない
    private static readonly MAX_TOKENS_ESCALATION_RATE = 4;
    // 引き上げの上限 (これを超えても本文が出ないモデルは reasoning を止められない構成とみなす)
    private static readonly DEFAULT_MAX_TOKENS_LIMIT = 16000;
    // 抽出結果キャッシュの上限 (バックフィルで大量のタイトルを処理してもメモリを食いつぶさないように)
    private static readonly CACHE_MAX = 5000;
    // 抽出結果の永続キャッシュ (metadata_provider_cache) の provider 名と TTL。
    // 起動時パイプラインが未リンク録画を毎回再照合しても、同じタイトルを LLM へ再問い合わせしないようにする
    private static readonly CACHE_PROVIDER = 'seriesLlm';
    private static readonly CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    // この回数連続で失敗したら COOLDOWN_MS の間呼び出しを休止する
    private static readonly FAILURE_LIMIT = 5;
    private static readonly COOLDOWN_MS = 10 * 60 * 1000;
    // 429 応答に Retry-After が無かった場合の待機時間
    private static readonly DEFAULT_RETRY_AFTER_MS = 60 * 1000;
    // 抽出結果として受け入れる作品名の長さの範囲
    private static readonly MIN_TITLE_LENGTH = 2;
    private static readonly MAX_TITLE_LENGTH = 100;

    private static readonly SYSTEM_PROMPT = [
        'あなたは日本のテレビ番組表 (EPG) の録画タイトルから、その番組が属するシリーズ名を 1 つ抽出するアシスタントです。',
        'アニメに限らず、ドラマ・バラエティ・情報番組・ニュース・スポーツなど全ジャンルを対象とします。',
        '以下のルールに従い、必ず JSON のみを出力してください。',
        // 書式例のプレースホルダをそのまま複写してしまうモデルがあるため、書式は文章で説明し、
        // 具体形は末尾の入出力例だけで示す
        '- 出力は JSON オブジェクト 1 個だけ。キーは "title" のみ。値は抽出したシリーズ名の文字列、該当しなければ null',
        '- 毎回変わる要素はすべて取り除く: 話数 (第3話 / #12 / Episode 5 など)・各話サブタイトル・回ごとのゲストや特集内容・放送日・「SP」「拡大版」などの回次情報',
        '- 放送局の編成枠名 (「ノイタミナ」「アニメシャワー」「日5」など)・[字][新][終][再][デ] などのマーカー・出演者情報は取り除く',
        '- 「第2期」「2nd Season」のような続編表記は作品名の一部として残す',
        '- 読み仮名だけの括弧 (例: 「羅小黒戦記(ロシャオヘイセンキ)」の括弧内) は取り除く',
        '- 毎回同じ名前で放送される番組は、ジャンルを問わずその番組名を返す',
        '- 単発の特番・番宣・イベント中継など、繰り返し放送されるシリーズに属さない番組や、番組名を特定できない場合は null にする',
        '- 説明文・解説・マークダウン・思考過程は一切出力しない。JSON 以外の文字を出力してはいけない',
        '',
        '入力と出力の例:',
        '入力: それいけ!アンパンマン「カレーパンマンとハロウィンマン・他」[多]',
        '出力: {"title": "それいけ!アンパンマン"}',
        '入力: バナナマンのせっかくグルメ★日村が秋田で新米&名物メシを食べまくる2時間SP',
        '出力: {"title": "バナナマンのせっかくグルメ"}',
        '入力: アニメ魔入りました!入間くん4 1問題児(アブノーマル)クラス、もう1人の悪魔',
        '出力: {"title": "魔入りました!入間くん 第4シリーズ"}',
        '入力: 4K クロージング',
        '出力: {"title": null}',
    ].join('\n');

    private log: ILogger;
    private config: IConfigFile;

    private cache: Map<string, string | null> = new Map();
    // 上限切れで引き上げた応答トークン数 (プロセス内で保持し、以後の問い合わせにも使う)
    private maxTokens: number | null = null;
    private consecutiveFailures: number = 0;
    private suspendedUntil: number = 0;
    private lastRequestAt: number = 0;
    // minIntervalMs の待機を直列化するためのチェーン (並行呼び出しでも間隔を守る)
    private throttleChain: Promise<void> = Promise.resolve();

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

    public isSuspended(): boolean {
        return Date.now() < this.suspendedUntil;
    }

    public async extractWorkTitle(recordedTitle: string): Promise<string | null> {
        if (this.isEnabled() === false) return null;
        if (this.isSuspended() === true) return null;

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
            // レート制限は「壊れている」わけではないので、失敗回数ではなく指示された時間だけ待つ
            const retryAfterMs = LlmTitleExtractor.retryAfterMsOf(err);
            if (retryAfterMs !== null) {
                this.suspendedUntil = Date.now() + retryAfterMs;
                this.consecutiveFailures = 0;
                this.log.system.warn(`llm title extraction rate limited: retry after ${retryAfterMs / 1000} sec`);

                return null;
            }

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
        const result = await this.postCompletion(recordedTitle, this.currentMaxTokens());
        if (result.ok === true) return result.title;

        // 本文が空のまま上限で切れた = 思考にトークンを使い切っている。
        // 上限を引き上げて 1 度だけやり直し、成功した値を以後の既定として覚える
        // (同じモデルなら次のタイトルでも同じだけ思考するため、毎回 1 往復無駄にしないようにする)
        const escalated = this.escalatedMaxTokens();
        if (result.truncated === false || escalated === null) throw new Error(result.message);

        this.log.system.info(
            `llm response was truncated before the answer; retrying with max_tokens ${escalated} (${result.message})`,
        );
        const retried = await this.postCompletion(recordedTitle, escalated);
        if (retried.ok === false) throw new Error(retried.message);
        this.maxTokens = escalated;

        return retried.title;
    }

    /**
     * 1 回分の問い合わせ。
     * 上限切れで本文が空だった場合は例外にせず truncated として返し、呼び出し側にやり直しを判断させる
     */
    private async postCompletion(
        recordedTitle: string,
        maxTokens: number,
    ): Promise<{ ok: true; title: string | null } | { ok: false; truncated: boolean; message: string }> {
        const llm = this.config.seriesLlm as NonNullable<IConfigFile['seriesLlm']>;
        const baseUrl = (llm.url as string).replace(/\/+$/u, '');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (typeof llm.apiKey === 'string' && llm.apiKey !== '') headers.Authorization = `Bearer ${llm.apiKey}`;

        await this.throttle(llm.minIntervalMs);

        const response = await axios.post(
            `${baseUrl}/chat/completions`,
            {
                model: llm.model,
                messages: [
                    { role: 'system', content: LlmTitleExtractor.SYSTEM_PROMPT },
                    { role: 'user', content: recordedTitle },
                ],
                temperature: 0,
                max_tokens: maxTokens,
                stream: false,
                // 思考を切れるモデルでは切る (OpenRouter 等が解釈する。未知のキーは無視される)
                reasoning: { enabled: false },
            },
            { headers, timeout: llm.timeoutMs ?? LlmTitleExtractor.DEFAULT_TIMEOUT_MS },
        );

        const choice = response.data?.choices?.[0];
        const finishReason = choice?.finish_reason;
        const content = choice?.message?.content;
        if (typeof content === 'string' && content !== '') {
            return { ok: true, title: this.parseContent(content, finishReason) };
        }

        // 本文を出さず思考欄にだけ答えを書くモデルがあるため、そこに JSON があれば拾う
        const reasoning = choice?.message?.reasoning;
        if (typeof reasoning === 'string' && /\{[\s\S]*?\}/u.test(reasoning) === true) {
            return { ok: true, title: this.parseContent(reasoning, finishReason) };
        }

        // 原因の切り分けができるよう、応答の形をそのままエラーに載せる
        return {
            ok: false,
            truncated: finishReason === 'length',
            message:
                `llm response has no content (finish_reason: ${finishReason ?? 'unknown'}, ` +
                `completion_tokens: ${response.data?.usage?.completion_tokens ?? 'unknown'}, ` +
                `max_tokens: ${maxTokens})`,
        };
    }

    /**
     * 現在の応答上限。引き上げに成功していればその値を使う
     */
    private currentMaxTokens(): number {
        const llm = this.config.seriesLlm;
        return this.maxTokens ?? llm?.maxTokens ?? LlmTitleExtractor.DEFAULT_MAX_TOKENS;
    }

    /**
     * 引き上げ後の応答上限。すでに上限に達している場合は null
     */
    private escalatedMaxTokens(): number | null {
        const limit = this.config.seriesLlm?.maxTokensLimit ?? LlmTitleExtractor.DEFAULT_MAX_TOKENS_LIMIT;
        const current = this.currentMaxTokens();
        if (current >= limit) return null;

        return Math.min(current * LlmTitleExtractor.MAX_TOKENS_ESCALATION_RATE, limit);
    }

    /**
     * 直前のリクエストから minIntervalMs 経過するまで待つ。
     * OpenRouter のフリーモデル (概ね 20 req/min) のような分あたり上限で 429 を連発させないために使う
     */
    private async throttle(minIntervalMs?: number): Promise<void> {
        const interval = typeof minIntervalMs === 'number' && minIntervalMs > 0 ? minIntervalMs : 0;
        if (interval === 0) {
            this.lastRequestAt = Date.now();

            return;
        }

        // 待機を直列につなぐことで、同時に走った呼び出しが同じ lastRequestAt を見て一斉送信するのを防ぐ
        const wait = this.throttleChain.then(async () => {
            const rest = this.lastRequestAt + interval - Date.now();
            if (rest > 0) await new Promise<void>(resolve => setTimeout(resolve, rest));
            this.lastRequestAt = Date.now();
        });
        this.throttleChain = wait.catch(() => {});

        return await wait;
    }

    /**
     * レート制限 (429) の応答なら待つべきミリ秒を返す。それ以外のエラーなら null
     */
    private static retryAfterMsOf(err: any): number | null {
        if (err?.response?.status !== 429) return null;
        // Retry-After は秒数指定 (HTTP-date 形式は LLM API では使われないため扱わない)
        const header = err.response?.headers?.['retry-after'];
        const sec = Number(header);
        return Number.isFinite(sec) && sec > 0
            ? Math.min(sec * 1000, LlmTitleExtractor.COOLDOWN_MS)
            : LlmTitleExtractor.DEFAULT_RETRY_AFTER_MS;
    }

    /**
     * LLM の応答文字列から {"title": ...} を取り出す。
     * コードフェンスや前後の説明文が付いていても最初の JSON オブジェクトを拾う
     */
    private parseContent(content: string, finishReason?: string): string | null {
        const json = content.match(/\{[\s\S]*?\}/u);
        if (json === null) {
            // 応答の冒頭を載せる (プロンプト無視・途中切れのどちらかをログだけで判別できるように)
            throw new Error(
                `llm response has no json (finish_reason: ${finishReason ?? 'unknown'}, ` +
                    `content: ${JSON.stringify(content.slice(0, 120))})`,
            );
        }
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
