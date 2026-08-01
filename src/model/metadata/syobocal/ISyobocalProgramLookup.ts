export interface SyobocalProgramMatch {
    // しょぼいカレンダー作品 ID
    tid: number;
    // 通し話数 (放送予定に話数が入っていない特番などでは null)
    count: number | null;
    // サブタイトル (放送予定に無ければ null)
    subTitle: string | null;
    // 放送開始時刻 (ms)
    startAt: number;
    // 放送終了時刻 (ms)。取得できない場合は null
    endAt: number | null;
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
     * @return Promise<SyobocalProgramMatch | null>
     */
    lookup(channelId: number, startAt: number): Promise<SyobocalProgramMatch | null>;
}
