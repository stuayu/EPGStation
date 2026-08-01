import { inject, injectable } from 'inversify';
import { resolveBoolean } from '../../AppSettingResolver';
import { isFeatureEnabled } from '../../FeatureFlags';
import IAppSettingDB from '../../db/IAppSettingDB';
import IChannelDB from '../../db/IChannelDB';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IBroadcastAffiliation from '../../channel/IBroadcastAffiliation';
import IMetadataEndpointResolver from '../IMetadataEndpointResolver';
import IProviderHttpClient from '../IProviderHttpClient';
import ISyobocalChannelMap from './ISyobocalChannelMap';
import ISyobocalProgramLookup, { SyobocalProgramMatch } from './ISyobocalProgramLookup';
import { parseSyobocalDate, xmlItems } from './SyobocalXml';

interface CacheEntry {
    programs: SyobocalProgramMatch[];
    expiresAt: number;
}

/**
 * しょぼいカレンダーの放送予定 (ProgLookup) を「放送局 + 放送開始時刻」で引き、
 * 作品 ID・通し話数・サブタイトルを確定するモデル。
 *
 * 話数の判定は従来「録画タイトルの表記 (第1話 / #1 / break1 …)」と
 * 「サブタイトル一覧との照合」に頼っていたが、どちらも持たないタイトル
 * (局が話数もサブタイトルも送出しない番組) では話数が付かなかった。
 * 放送予定は放送局と時刻だけで引けるためタイトル表記に一切依存せず、
 * これらのタイトルでも話数を確定できる (SCRename と同じ考え方)。
 *
 * 1 回の問い合わせで「その放送日 1 日分」を取得してメモリに保持するため、
 * 同じ局・同じ日の録画が続いても外部への問い合わせは 1 回で済む
 */
@injectable()
export default class SyobocalProgramLookup implements ISyobocalProgramLookup {
    // 放送開始時刻の許容誤差 (ms)。EPG と しょぼいカレンダーの時刻のずれを吸収する
    private static readonly START_TOLERANCE_MS = 5 * 60 * 1000;
    // 1 日分の放送予定をまとめて取得する際の日付境界 (JST 5 時。深夜アニメを同じ日として扱う)
    private static readonly DAY_BOUNDARY_HOUR = 5;
    // JST のオフセット (ms)。しょぼいカレンダーの Range は JST 前提
    private static readonly JST_OFFSET_MS = 9 * 60 * 60 * 1000;
    private static readonly CACHE_TTL_MS = 6 * 60 * 60 * 1000;
    // 保持するキャッシュ数の上限 (局数 × 日数)。取り込み時に古い録画を大量に処理しても膨らませない
    private static readonly CACHE_MAX_ENTRIES = 256;
    private static readonly FETCH_TIMEOUT_MS = 30 * 1000;
    // 系列 (BroadcastAffiliation の id) → キー局の しょぼいカレンダー ChID。
    // しょぼいカレンダーに放送データが無い地方局を、系列のキー局の放送予定で代用するために使う
    // (ChID の値は SyobocalChannelMapData の同梱データと対応する)。独立系にキー局は無い
    private static readonly KEY_STATION_CH_ID: Readonly<Record<string, number>> = {
        nhk_g: 1,
        nhk_e: 2,
        ntv: 3,
        ex: 5,
        tbs: 6,
        tx: 7,
        cx: 8,
    };

    private log: ILogger;
    private cache: Map<string, CacheEntry> = new Map();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IProviderHttpClient') private http: IProviderHttpClient,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('IChannelDB') private channels: IChannelDB,
        @inject('ISyobocalChannelMap') private channelMap: ISyobocalChannelMap,
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IMetadataEndpointResolver') private endpoints: IMetadataEndpointResolver,
        @inject('IBroadcastAffiliation') private affiliation: IBroadcastAffiliation,
    ) {
        this.log = logger.getLogger();
    }

    public async lookup(channelId: number, startAt: number): Promise<SyobocalProgramMatch | null> {
        if (Number.isFinite(startAt) === false || startAt <= 0) return null;
        if ((await this.enabled()) === false) return null;

        const target = await this.findChId(channelId);
        if (target === null) return null;

        let programs: SyobocalProgramMatch[];
        try {
            programs = await this.getPrograms(target.chId, startAt);
        } catch (err) {
            // 放送予定が引けなくてもシリーズ化そのものは従来経路で成立するため、警告に留める
            this.log.system.warn(`syobocal program lookup: failed to fetch programs for ChID ${target.chId}`);
            this.log.system.warn(err);
            return null;
        }

        const picked = SyobocalProgramLookup.pick(programs, startAt, target.viaKeyStation);
        return picked === null ? null : { ...picked, viaKeyStation: target.viaKeyStation };
    }

    /**
     * 放送予定の一覧から、指定した開始時刻に対応する 1 件を選ぶ。
     * 開始時刻がほぼ一致するものを最優先し、無ければ放送時間帯に含まれるものを採用する
     * (録画開始が番組途中になっている場合を救う)。
     *
     * キー局で代用した場合は放送そのものが別物 (遅れ放送・番組差し替え) でありうるため、
     * 時間帯の包含では拾わず、開始時刻がほぼ一致する = 同時ネットとみなせる場合だけ採る
     * @param programs: SyobocalProgramMatch[]
     * @param startAt: number
     * @param viaKeyStation: boolean キー局の放送予定で代用しているか
     * @return SyobocalProgramMatch | null
     */
    private static pick(
        programs: SyobocalProgramMatch[],
        startAt: number,
        viaKeyStation: boolean,
    ): SyobocalProgramMatch | null {
        let nearest: { program: SyobocalProgramMatch; diff: number } | null = null;
        for (const program of programs) {
            const diff = Math.abs(program.startAt - startAt);
            if (diff > SyobocalProgramLookup.START_TOLERANCE_MS) continue;
            if (nearest === null || diff < nearest.diff) nearest = { program, diff };
        }
        if (nearest !== null) return { ...nearest.program, exactStart: true };
        if (viaKeyStation === true) return null;

        const contained =
            programs.find(program => program.endAt !== null && program.startAt <= startAt && startAt < program.endAt) ??
            null;

        return contained === null ? null : { ...contained, exactStart: false };
    }

    /**
     * 指定 ChID の「放送日 1 日分」の放送予定を取得する (取得済みならキャッシュを返す)
     * @param chId: number しょぼいカレンダーの放送局 ID
     * @param startAt: number 放送開始時刻 (ms)
     * @return Promise<SyobocalProgramMatch[]>
     */
    private async getPrograms(chId: number, startAt: number): Promise<SyobocalProgramMatch[]> {
        const range = SyobocalProgramLookup.dayRange(startAt);
        const cacheKey = `${chId}:${range.from}`;
        const now = Date.now();
        const cached = this.cache.get(cacheKey);
        if (typeof cached !== 'undefined' && cached.expiresAt > now) return cached.programs;

        const url = await this.url({ ChID: String(chId), Range: `${range.from}-${range.to}` });
        const xml = (await this.http.get(url, { timeoutMs: SyobocalProgramLookup.FETCH_TIMEOUT_MS })).text;
        const programs = xmlItems(xml, 'ProgItem')
            .map(row => SyobocalProgramLookup.toMatch(row))
            .filter((x): x is SyobocalProgramMatch => x !== null);

        this.cache.set(cacheKey, { programs, expiresAt: now + SyobocalProgramLookup.CACHE_TTL_MS });
        this.evictCache(now);
        return programs;
    }

    /**
     * ProgItem 1 件を SyobocalProgramMatch へ変換する。TID か開始時刻が取れない行は捨てる
     */
    private static toMatch(row: Record<string, string>): SyobocalProgramMatch | null {
        const tid = Number(row.TID);
        const startAt = parseSyobocalDate(row.StTime ?? '');
        if (Number.isFinite(tid) === false || tid <= 0 || typeof startAt !== 'number') return null;

        const count = Number(row.Count);
        const subTitle = (row.SubTitle ?? '').trim();
        const comment = (row.ProgComment ?? '').trim();
        return {
            tid,
            count: row.Count && Number.isFinite(count) && count > 0 ? count : null,
            subTitle: subTitle === '' ? null : subTitle,
            comment: comment === '' ? null : comment,
            startAt,
            endAt: parseSyobocalDate(row.EdTime ?? '') ?? null,
            // 開始時刻の一致は pick()、問い合わせ先の ChID は lookup() が知っているのでそちらで上書きする
            exactStart: false,
            viaKeyStation: false,
        };
    }

    /**
     * 放送開始時刻を含む「放送日」の範囲を しょぼいカレンダーの Range 形式で返す。
     * 深夜番組を前日の放送として扱うため、日付の境界は JST 5 時に置く
     * @param startAt: number
     * @return { from: string; to: string } YYYYMMDD_HHMMSS 形式
     */
    private static dayRange(startAt: number): { from: string; to: string } {
        const jst = new Date(startAt + SyobocalProgramLookup.JST_OFFSET_MS);
        const shifted = new Date(jst.getTime() - SyobocalProgramLookup.DAY_BOUNDARY_HOUR * 60 * 60 * 1000);
        const pad = (value: number, length: number): string => String(value).padStart(length, '0');
        const date = `${pad(shifted.getUTCFullYear(), 4)}${pad(shifted.getUTCMonth() + 1, 2)}${pad(shifted.getUTCDate(), 2)}`;
        const next = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1));
        const nextDate = `${pad(next.getUTCFullYear(), 4)}${pad(next.getUTCMonth() + 1, 2)}${pad(next.getUTCDate(), 2)}`;
        const boundary = `${pad(SyobocalProgramLookup.DAY_BOUNDARY_HOUR, 2)}0000`;
        return { from: `${date}_${boundary}`, to: `${nextDate}_${boundary}` };
    }

    /**
     * EPGStation の放送局 ID から問い合わせ先の ChID を決める。
     *
     * しょぼいカレンダーに放送データが無い局 (地方局など) は、その局が属する系列の
     * キー局の ChID で代用する。同時ネットの番組であれば同じ時刻に同じ作品が並ぶため、
     * 地方局の録画でも作品・話数を引ける。系列が分からない局 (BIT 未受信・独立系) は null
     * @param channelId: number
     * @return Promise<{ chId: number; viaKeyStation: boolean } | null>
     */
    private async findChId(channelId: number): Promise<{ chId: number; viaKeyStation: boolean } | null> {
        const channel = await this.channels.findId(channelId).catch(() => null);
        if (channel === null) return null;

        const mapping = this.channelMap.find(channel.networkId, channel.serviceId);
        if (typeof mapping !== 'undefined' && mapping.syobocal === true) {
            return { chId: mapping.chId, viaKeyStation: false };
        }

        const keyStation = await this.findKeyStationChId(channel.networkId, channel.channelType);
        return keyStation === null ? null : { chId: keyStation, viaKeyStation: true };
    }

    /**
     * 放送局が属する系列のキー局の ChID を返す。
     * 系列は BIT (受動収集) から判定するため、まだ受信していない局・独立系は null になる
     * @param networkId: number
     * @param channelType: string
     * @return Promise<number | null>
     */
    private async findKeyStationChId(networkId: number, channelType: string): Promise<number | null> {
        try {
            await this.affiliation.updateCache();
            const item = this.affiliation.getAffiliation({ networkId, channelType });
            if (item === null) return null;
            return SyobocalProgramLookup.KEY_STATION_CH_ID[item.id] ?? null;
        } catch {
            return null;
        }
    }

    /**
     * 期限切れエントリを捨て、それでも上限を超える場合は古いものから捨てる
     */
    private evictCache(now: number): void {
        for (const [key, entry] of this.cache) {
            if (entry.expiresAt <= now) this.cache.delete(key);
        }
        while (this.cache.size > SyobocalProgramLookup.CACHE_MAX_ENTRIES) {
            const oldest = this.cache.keys().next();
            if (oldest.done === true) break;
            this.cache.delete(oldest.value);
        }
    }

    /**
     * しょぼいカレンダー連携が有効か (機能フラグ + 連携の有効設定)
     */
    private async enabled(): Promise<boolean> {
        const config = this.config.getConfig();
        if (isFeatureEnabled(config, 'metadataProviders') === false) return false;
        const all = await this.settings.getAll();
        // 優先順位: DB (設定画面) > config.yml (metadataDefaults) > 既定 (無効)
        return resolveBoolean(
            (all.metadata as any)?.syobocal?.enabled,
            config.metadataDefaults?.syobocal?.enabled,
            false,
        );
    }

    private async url(params: Record<string, string>): Promise<string> {
        const query = new URLSearchParams({ Command: 'ProgLookup', ...params });
        return `${await this.endpoints.resolve('syobocal')}?${query.toString()}`;
    }
}
