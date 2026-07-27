export default interface ILlmTitleExtractor {
    /**
     * ローカル LLM フォールバックが利用可能か (config.yml の seriesLlm.url / model が設定されているか)
     */
    isEnabled(): boolean;

    /**
     * 録画番組タイトルからアニメの作品名を抽出する。
     * 抽出できない (アニメ以外・判別不能・LLM 利用不可・失敗) 場合は null を返す。
     * 呼び出し側で例外処理は不要 (内部で握りつぶして null を返す)
     * @param recordedTitle: string 録画番組タイトル (生のまま渡してよい)
     * @return Promise<string | null> 抽出された作品名
     */
    extractWorkTitle(recordedTitle: string): Promise<string | null>;
}
