export interface SyobocalProgramMatch {
    // しょぼいカレンダー作品 ID
    tid: number;
    // 通し話数 (放送予定に話数が入っていない特番などでは null)
    count: number | null;
    // サブタイトル (放送予定に無ければ null)
    subTitle: string | null;
    // 放送回コメント (ProgComment。「定刻放送」「30分繰り下げ」等の覚え書き。無ければ null)
    comment: string | null;
    // 放送開始時刻 (ms)
    startAt: number;
    // 放送終了時刻 (ms)。取得できない場合は null
    endAt: number | null;
    // 放送開始時刻がほぼ一致した (= 録画が番組の頭から始まっている) 場合 true。
    // false の場合は「放送時間帯に含まれる番組」として拾ったもので、録画マージンが大きい環境や
    // 分割録画では隣の番組を指している可能性がある
    exactStart: boolean;
    // しょぼいカレンダー未登録局のため、系列のキー局の放送予定で代用した場合 true。
    // 遅れ放送では別番組を拾いうるため、呼び出し側は作品の確定には使わず
    // 「作品が既に確定していて TID が一致する場合の話数・サブタイトル」にのみ使うこと
    viaKeyStation: boolean;
}

/**
 * 放送予定照会の結果。引けなかった場合でも「なぜ引けなかったか」を返す
 * (どの ChID を引いたのか、何件返ったのかが分からないと切り分けができないため)
 */
export interface SyobocalProgramLookupResult {
    match: SyobocalProgramMatch | null;
    // 画面・ログ表示用の説明
    detail: string;
}

export default interface ISyobocalProgramLookup {
    /**
     * 録画の放送局と放送開始時刻から、しょぼいカレンダーの放送予定 (ProgLookup) を引いて
     * 作品 ID・話数・サブタイトルを確定する。
     *
     * 録画タイトルの表記に一切依存しないため、話数表記もサブタイトルも持たないタイトルでも
     * 話数を確定できる (SCRename と同じ考え方)。
     * しょぼいカレンダー連携が無効、局がマッピング表に無い、該当する放送が無い場合は null を返す
     * @param channelId: number EPGStation の放送局 ID
     * @param startAt: number 放送開始時刻 (ms)
     * @return Promise<SyobocalProgramLookupResult> 引けなかった場合も理由を含めて返す
     */
    lookup(channelId: number, startAt: number): Promise<SyobocalProgramLookupResult>;

    /**
     * 遅れ放送の話数を、系列キー局の放送予定から引く。
     *
     * しょぼいカレンダー未登録の県域局は、キー局の数日後に同じ作品を流す (遅れネット) ことが多い。
     * その場合キー局の「同時刻」の放送予定は別番組なので lookup() では拾えないが、
     * **作品 (TID) が既に確定していれば**キー局の放送予定をその TID に絞って追える。
     * 録画時刻より前で最も近い放送を、その録画に対応する回とみなす
     * @param channelId: number EPGStation の放送局 ID
     * @param startAt: number 録画の放送開始時刻 (ms)
     * @param tid: number 確定済みの しょぼいカレンダー作品 ID
     * @return Promise<SyobocalProgramMatch | null> キー局が分からない・該当放送が無い場合は null
     */
    lookupDelayed(channelId: number, startAt: number, tid: number): Promise<SyobocalProgramMatch | null>;
}
