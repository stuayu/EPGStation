import * as stream from 'stream';
import ILogger from '../ILogger';
import BitParser, { BitSectionInfo } from './BitParser';
import IBroadcastAffiliationCollector from './IBroadcastAffiliationCollector';

/**
 * ライブ配信中の TS から BIT を読み取り、放送局の系列情報を収集する pass-through Transform
 * 入力された TS は加工せずそのまま下流へ流す
 *
 * BIT は数秒周期で繰り返し流れてくるため、同じ内容を何度も保存しないよう
 * 一度収集した内容は記憶しておく。
 *
 * per-stream (配信ごと) に生成するインスタンスであり DI コンテナには登録しない。
 */
export default class BitCollectTransform extends stream.Transform {
    private parser = new BitParser();
    private collector: IBroadcastAffiliationCollector;
    private log: ILogger | null;

    // 収集済みセクションの識別子 (同一内容の重複保存を避ける)
    private collected: Set<string> = new Set();
    private isCollecting = false;

    constructor(collector: IBroadcastAffiliationCollector, logger: ILogger | null = null) {
        super();
        this.collector = collector;
        this.log = logger;
    }

    public _transform(chunk: Buffer, _encoding: string, callback: stream.TransformCallback): void {
        try {
            const sections = this.parser.write(chunk);
            if (sections.length > 0) {
                this.collect(sections);
            }
        } catch (err: any) {
            this.log?.stream.warn(`[BitCollectTransform] BIT 解析に失敗しました: ${err.message}`);
        }

        // 入力はそのまま下流へ流す
        callback(null, chunk);
    }

    public _flush(callback: stream.TransformCallback): void {
        callback();
    }

    /**
     * 未収集のセクションを保存する (配信を止めないため待ち合わせはしない)
     * @param sections: BitSectionInfo[]
     */
    private collect(sections: BitSectionInfo[]): void {
        const newSections = sections.filter(section => {
            const key = BitCollectTransform.getSectionKey(section);
            if (this.collected.has(key) === true) {
                return false;
            }
            this.collected.add(key);

            return true;
        });

        if (newSections.length === 0 || this.isCollecting === true) {
            return;
        }

        this.isCollecting = true;
        this.collector
            .collect(newSections)
            .catch(err => {
                this.log?.stream.warn(`[BitCollectTransform] 系列情報の保存に失敗しました: ${err.message}`);
            })
            .finally(() => {
                this.isCollecting = false;
            });
    }

    /**
     * セクションの内容を表す文字列を返す
     * @param section: BitSectionInfo
     * @return string
     */
    private static getSectionKey(section: BitSectionInfo): string {
        const broadcasters = section.broadcasters
            .map(b => `${b.broadcasterId}:${b.affiliationIds.join('/')}:${b.networkIds.join('/')}`)
            .sort();

        return `${section.originalNetworkId}|${broadcasters.join(',')}`;
    }
}
