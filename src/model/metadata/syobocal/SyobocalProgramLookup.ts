import { inject, injectable } from 'inversify';
import { resolveBoolean } from '../../AppSettingResolver';
import { isFeatureEnabled } from '../../FeatureFlags';
import IAppSettingDB from '../../db/IAppSettingDB';
import IChannelDB from '../../db/IChannelDB';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IBroadcastAffiliation, { BroadcastAffiliationTarget } from '../../channel/IBroadcastAffiliation';
import IMetadataEndpointResolver from '../IMetadataEndpointResolver';
import IProviderHttpClient from '../IProviderHttpClient';
import ISyobocalChannelMap from './ISyobocalChannelMap';
import ISyobocalProgramLookup, { SyobocalProgramLookupResult, SyobocalProgramMatch } from './ISyobocalProgramLookup';
import { assertSyobocalResponse, parseSyobocalDate, xmlItems } from './SyobocalXml';

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
    // 遅れ放送を探すときにキー局の放送予定を遡る日数。
    // 1〜2 週遅れが大半だが、特番による飛び・3 週遅れも拾えるよう余裕を持たせる
    private static readonly DELAY_LOOKBACK_DAYS = 28;
    // 系列 (BroadcastAffiliation の id) → キー局の しょぼいカレンダー ChID。
    // しょぼいカレンダーに放送データが無い地方局を、系列のキー局の放送予定で代用するために使う。
    // 値は しょぼいカレンダーの ChLookup の実データ (SyobocalChannelMapData と対応)。
    // 番号は放送局の並び順とは無関係なので、変更するときは必ず ChLookup で確認すること。
    // 独立系にキー局は無い
    private static readonly KEY_STATION_CH_ID: Readonly<Record<string, number>> = {
        nhk_g: 1,
        nhk_e: 2,
        // 日本テレビ
        ntv: 4,
        // テレビ朝日
        ex: 6,
        // TBS
        tbs: 5,
        // テレビ東京
        tx: 7,
        // フジテレビ
        cx: 3,
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

    public async lookup(channelId: number, startAt: number): Promise<SyobocalProgramLookupResult> {
        if (Number.isFinite(startAt) === false || startAt <= 0) {
            return { match: null, detail: '放送開始時刻が不正' };
        }
        if ((await this.enabled()) === false) {
            this.log.system.debug('syobocal program lookup: skipped (syobocal integration is disabled)');

            return { match: null, detail: 'しょぼいカレンダー連携が無効' };
        }

        const target = await this.findChId(channelId);
        if (target === null) {
            this.log.system.debug(
                `syobocal program lookup: no ChID for channelId=${channelId} (しょぼいカレンダー未対応かつ系列も不明)`,
            );

            return {
                match: null,
                detail: 'この放送局はしょぼいカレンダー未対応で、代用できる系列キー局も不明',
            };
        }
        // 引き当てた問い合わせ先を必ず添える (どの ChID を引いたか分からないと切り分けができない)
        const via = target.viaKeyStation === true ? `系列キー局 ChID ${target.chId} で代用` : `ChID ${target.chId}`;

        let programs: SyobocalProgramMatch[];
        try {
            programs = await this.getPrograms(target.chId, startAt);
        } catch (err) {
            // 放送予定が引けなくてもシリーズ化そのものは従来経路で成立するため、警告に留める
            const message = err instanceof Error ? err.message : String(err);
            this.log.system.warn(`syobocal program lookup: failed to fetch programs for ChID ${target.chId}`);
            this.log.system.warn(err);

            return { match: null, detail: `${via} の放送予定の取得に失敗: ${message}` };
        }

        const picked = SyobocalProgramLookup.pick(programs, startAt, target.viaKeyStation);
        if (picked === null) {
            this.log.system.debug(
                `syobocal program lookup: no program at ${new Date(startAt).toLocaleString()}` +
                    ` (ChID ${target.chId}, その日の放送予定 ${programs.length} 件, viaKeyStation=${target.viaKeyStation})`,
            );

            return {
                match: null,
                detail:
                    `${via}、その日の放送予定 ${programs.length} 件に開始時刻の一致なし` +
                    (target.viaKeyStation === true ? ' (キー局代用時は開始時刻がほぼ一致する放送のみ採用)' : ''),
            };
        }
        this.log.system.debug(
            `syobocal program lookup: ChID ${target.chId} ${new Date(startAt).toLocaleString()}` +
                ` => TID ${picked.tid} 第${picked.count ?? '?'}話 subTitle=${picked.subTitle ?? 'なし'}` +
                ` comment=${picked.comment === null ? 'なし' : `${picked.comment.length}文字`}`,
        );

        return {
            match: { ...picked, viaKeyStation: target.viaKeyStation },
            detail: `${via}、その日の放送予定 ${programs.length} 件から特定`,
        };
    }

    /**
     * 遅れ放送の話数を、系列キー局の放送予定から引く。
     * 作品 (TID) が確定していることが前提なので、キー局の放送予定をその TID に絞って追える
     * @param channelId: number
     * @param startAt: number 録画の放送開始時刻
     * @param tid: number 確定済みの しょぼいカレンダー作品 ID
     * @return Promise<SyobocalProgramMatch | null>
     */
    public async lookupDelayed(channelId: number, startAt: number, tid: number): Promise<SyobocalProgramMatch | null> {
        if (Number.isFinite(startAt) === false || startAt <= 0) return null;
        if (Number.isFinite(tid) === false || tid <= 0) return null;
        if ((await this.enabled()) === false) return null;

        const target = await this.findChId(channelId);
        // その局自身の放送予定が引ける場合は lookup() で決まるので、ここでは何もしない
        if (target === null || target.viaKeyStation === false) return null;

        let programs: SyobocalProgramMatch[];
        try {
            programs = await this.getProgramsByTid(target.chId, tid, startAt);
        } catch (err) {
            this.log.system.warn(
                `syobocal program lookup: failed to fetch delayed programs for ChID ${target.chId} TID ${tid}`,
            );
            this.log.system.warn(err);

            return null;
        }

        // 録画時刻より前で最も近いキー局の放送を、その録画に対応する回とみなす。
        // 遅れ日数が一定でなくても (2 週遅れ等) 同じ考え方で対応が取れる
        let picked: SyobocalProgramMatch | null = null;
        for (const program of programs) {
            if (program.tid !== tid) continue;
            // キー局より先に流れる (先行放送) ことは無い前提。わずかな時刻ずれは許容する
            if (program.startAt > startAt + SyobocalProgramLookup.START_TOLERANCE_MS) continue;
            if (picked === null || program.startAt > picked.startAt) picked = program;
        }
        if (picked === null) {
            this.log.system.debug(
                `syobocal program lookup: no delayed broadcast for TID ${tid}` +
                    ` (キー局 ChID ${target.chId}, ${new Date(startAt).toLocaleString()} 以前, 候補 ${programs.length} 件)`,
            );

            return null;
        }

        const delayDays = Math.round((startAt - picked.startAt) / (24 * 60 * 60 * 1000));
        this.log.system.debug(
            `syobocal program lookup: delayed broadcast TID ${tid} 第${picked.count ?? '?'}話` +
                ` (キー局 ChID ${target.chId} の ${new Date(picked.startAt).toLocaleString()} 放送、${delayDays} 日遅れ)`,
        );

        return { ...picked, exactStart: false, viaKeyStation: true };
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
        // Cloudflare のレート制限などで XML 以外が返った場合は、正常な「該当なし」と区別して失敗させる
        assertSyobocalResponse(xml, 'ProgLookupResponse');
        const programs = xmlItems(xml, 'ProgItem')
            .map(row => SyobocalProgramLookup.toMatch(row))
            .filter((x): x is SyobocalProgramMatch => x !== null);

        this.log.system.info(
            `syobocal program lookup: fetched ${programs.length} programs (ChID ${chId}, ${range.from}-${range.to}, ${xml.length} bytes)`,
        );

        this.cacheResult(cacheKey, programs, now);

        return programs;
    }

    /**
     * 指定 ChID・指定作品の放送予定を「録画日から遡って DELAY_LOOKBACK_DAYS 日分」取得する
     * (取得済みならキャッシュを返す)。
     * 1 作品分に絞るため応答は小さく、遅れ日数が分からなくても 1 リクエストで追える
     * @param chId: number キー局の しょぼいカレンダー放送局 ID
     * @param tid: number 作品 ID
     * @param startAt: number 録画の放送開始時刻 (ms)
     * @return Promise<SyobocalProgramMatch[]>
     */
    private async getProgramsByTid(chId: number, tid: number, startAt: number): Promise<SyobocalProgramMatch[]> {
        // 録画日の「放送日」を基準に遡る (キャッシュを日単位で共有できるようにするため)
        const range = SyobocalProgramLookup.dayRange(startAt);
        const from = SyobocalProgramLookup.shiftRangeDays(range.from, -SyobocalProgramLookup.DELAY_LOOKBACK_DAYS);
        const cacheKey = `tid:${chId}:${tid}:${range.from}`;
        const now = Date.now();
        const cached = this.cache.get(cacheKey);
        if (typeof cached !== 'undefined' && cached.expiresAt > now) return cached.programs;

        const url = await this.url({ ChID: String(chId), TID: String(tid), Range: `${from}-${range.to}` });
        const xml = (await this.http.get(url, { timeoutMs: SyobocalProgramLookup.FETCH_TIMEOUT_MS })).text;
        assertSyobocalResponse(xml, 'ProgLookupResponse');
        const programs = xmlItems(xml, 'ProgItem')
            .map(row => SyobocalProgramLookup.toMatch(row))
            .filter((x): x is SyobocalProgramMatch => x !== null);

        this.log.system.info(
            `syobocal program lookup: fetched ${programs.length} delayed-broadcast candidates` +
                ` (ChID ${chId}, TID ${tid}, ${from}-${range.to}, ${xml.length} bytes)`,
        );

        this.cacheResult(cacheKey, programs, now);

        return programs;
    }

    /**
     * 取得結果をキャッシュする。
     * **0 件はキャッシュしない**: 正常な「その日は該当なし」と、一時的な取得失敗で空になった
     * ケースを完全には見分けられないため、空を数時間持ち回って復旧を遅らせるより
     * 次回引き直す方が安全 (1 件でも取れていれば通信は成立している)
     * @param cacheKey: string
     * @param programs: SyobocalProgramMatch[]
     * @param now: number
     */
    private cacheResult(cacheKey: string, programs: SyobocalProgramMatch[], now: number): void {
        if (programs.length === 0) return;
        this.cache.set(cacheKey, { programs, expiresAt: now + SyobocalProgramLookup.CACHE_TTL_MS });
        this.evictCache(now);
    }

    /**
     * しょぼいカレンダーの Range 形式 (YYYYMMDD_HHMMSS) の日付部分を days 日ずらす
     * @param value: string
     * @param days: number
     * @return string
     */
    private static shiftRangeDays(value: string, days: number): string {
        const matched = value.match(/^(\d{4})(\d{2})(\d{2})_(\d{6})$/u);
        if (matched === null) return value;
        const shifted = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]) + days));
        const pad = (x: number, length: number): string => String(x).padStart(length, '0');

        return `${pad(shifted.getUTCFullYear(), 4)}${pad(shifted.getUTCMonth() + 1, 2)}${pad(shifted.getUTCDate(), 2)}_${matched[4]}`;
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

        const keyStation = await this.findKeyStationChId({
            networkId: channel.networkId,
            channelType: channel.channelType,
            name: channel.halfWidthName ?? channel.name,
        });

        return keyStation === null ? null : { chId: keyStation, viaKeyStation: true };
    }

    /**
     * 放送局が属する系列のキー局の ChID を返す。
     * 系列は BIT (受動収集) を最優先に、未受信の局は同梱データ (networkId / 局名) で補う。
     * どちらでも分からない局・独立系はキー局が無いので null
     * @param target: BroadcastAffiliationTarget
     * @return Promise<number | null>
     */
    private async findKeyStationChId(target: BroadcastAffiliationTarget): Promise<number | null> {
        try {
            await this.affiliation.updateCache();
            const item = this.affiliation.getAffiliation(target);
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
