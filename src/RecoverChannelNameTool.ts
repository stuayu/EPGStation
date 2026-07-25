import minimist from 'minimist';
import * as path from 'path';
import 'reflect-metadata';
import { install } from 'source-map-support';
import Recorded from './db/entities/Recorded';
import IChannelDB from './model/db/IChannelDB';
import IDBOperator from './model/db/IDBOperator';
import IConfiguration from './model/IConfiguration';
import ILoggerModel from './model/ILoggerModel';
import container from './model/ModelContainer';
import * as containerSetter from './model/ModelContainerSetter';
import StrUtil from './util/StrUtil';

install();

containerSetter.set(container);

/**
 * 録画番組の放送局名 (recorded.channelName) を復元するツール
 *
 * 転居や受信環境の変更で channel テーブルから放送局情報が失われると、
 * 過去の録画番組の放送局名が表示できなくなる。
 * このツールは以下の順で放送局名を復元する。
 *
 * 1. channel テーブル (放送局情報がまだ残っているもの)
 * 2. 録画ファイル名 (%CHNAME% / %HALF_WIDTH_CHNAME% を含む命名規則から放送局名を切り出す)
 *
 * ファイル名は録画した時点の recordedFormat で作られているため、現在の config の
 * recordedFormat とは異なる場合がある。その場合は --format で当時の命名規則を指定する。
 *
 * 既定では変更内容の表示のみを行う。内容を確認した上で --apply を付けると DB を更新する。
 *
 * 例:
 *   npm run recover-channel-name
 *   npm run recover-channel-name -- --format '%YEAR%%MONTH%%DAY%%HOUR%%MIN%_%TITLE%_%CHNAME%'
 *   npm run recover-channel-name -- --format '...' --apply
 */
namespace RecoverChannelNameTool {
    interface RecoverResult {
        recordedId: number;
        channelId: number;
        channelName: string;
        halfWidthChannelName: string;
        from: 'channel' | 'fileName';
    }

    /**
     * recordedFormat から放送局名を切り出す正規表現を生成する
     * @param format: string config の recordedFormat
     * @return RegExp | null %CHNAME% / %HALF_WIDTH_CHNAME% を含まない場合は null
     */
    export const createChannelNameRegExp = (format: string): RegExp | null => {
        if (/%(HALF_WIDTH_)?CHNAME%/.test(format) === false) {
            return null;
        }

        // 正規表現のメタ文字をエスケープする (% は後段で置換するため残す)
        let pattern = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // 日時系は桁数が決まっている
        pattern = pattern
            .replace(/%YEAR%/g, '\\d{4}')
            .replace(/%SHORTYEAR%/g, '\\d{2}')
            .replace(/%MONTH%/g, '\\d{2}')
            .replace(/%DAY%/g, '\\d{2}')
            .replace(/%HOUR%/g, '\\d{2}')
            .replace(/%MIN%/g, '\\d{2}')
            .replace(/%SEC%/g, '\\d{2}')
            .replace(/%DOW%/g, '.')
            .replace(/%CHID%/g, '\\d+')
            .replace(/%SID%/g, '\\d+')
            .replace(/%ID%/g, '\\d+');

        // 放送局名を捕捉する (他のトークンは最短一致で読み飛ばす)
        pattern = pattern.replace(/%(HALF_WIDTH_)?CHNAME%/g, '(?<chname>.+?)');
        pattern = pattern.replace(/%[A-Z_]+%/g, '(?:.+?)');

        // ファイル名末尾には重複回避の連番 ( (1) など) が付くことがある
        return new RegExp(`^${pattern}(?:\\(\\d+\\))?$`);
    };

    /**
     * 復元対象を洗い出す
     * @param regexp: RegExp | null ファイル名から放送局名を切り出す正規表現
     * @return Promise<RecoverResult[]>
     */
    const collect = async (regexp: RegExp | null): Promise<RecoverResult[]> => {
        const op = container.get<IDBOperator>('IDBOperator');
        const channelDB = container.get<IChannelDB>('IChannelDB');
        const connection = await op.getConnection();

        // 放送局名が未設定の録画番組を取得する
        const recordeds = await connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
            .where('recorded.channelName IS NULL')
            .getMany();

        const results: RecoverResult[] = [];
        for (const recorded of recordeds) {
            // 1. channel テーブルから復元する
            const channel = await channelDB.findId(recorded.channelId);
            if (channel !== null) {
                results.push({
                    recordedId: recorded.id,
                    channelId: recorded.channelId,
                    channelName: channel.name,
                    halfWidthChannelName: channel.halfWidthName,
                    from: 'channel',
                });

                continue;
            }

            // 2. 録画ファイル名から復元する
            if (regexp === null || typeof recorded.videoFiles === 'undefined') {
                continue;
            }

            for (const videoFile of recorded.videoFiles) {
                const fileName = path.basename(videoFile.filePath, path.extname(videoFile.filePath));
                const matched = fileName.match(regexp);
                const chname = matched?.groups?.chname;
                if (typeof chname !== 'string' || chname.length === 0) {
                    continue;
                }

                const name = StrUtil.toDBStr(chname);
                results.push({
                    recordedId: recorded.id,
                    channelId: recorded.channelId,
                    channelName: name,
                    halfWidthChannelName: StrUtil.toHalf(name),
                    from: 'fileName',
                });

                break;
            }
        }

        return results;
    };

    /**
     * 復元結果を DB へ書き込む
     * @param results: RecoverResult[]
     * @return Promise<void>
     */
    const apply = async (results: RecoverResult[]): Promise<void> => {
        const op = container.get<IDBOperator>('IDBOperator');
        const connection = await op.getConnection();
        const repository = connection.getRepository(Recorded);

        for (const result of results) {
            await repository.update(result.recordedId, {
                channelName: result.channelName,
                halfWidthChannelName: result.halfWidthChannelName,
            });
        }
    };

    /**
     * 実行
     * @param isApply: boolean true で DB を更新する
     * @param format: string | undefined ファイル名の命名規則 (省略時は config の recordedFormat)
     * @return Promise<void>
     */
    export const run = async (isApply: boolean, format?: string): Promise<void> => {
        const config = container.get<IConfiguration>('IConfiguration').getConfig();
        const targetFormat = typeof format === 'string' && format.length > 0 ? format : config.recordedFormat;
        const regexp = createChannelNameRegExp(targetFormat);

        if (regexp === null) {
            console.log(
                '命名規則に %CHNAME% / %HALF_WIDTH_CHNAME% が含まれていないため、ファイル名からの復元は行いません',
            );
        } else {
            console.log(`ファイル名の命名規則: ${targetFormat}`);
        }

        const results = await collect(regexp);
        if (results.length === 0) {
            console.log('復元対象の録画番組はありませんでした');

            return;
        }

        const fromChannel = results.filter(r => r.from === 'channel').length;
        const fromFileName = results.length - fromChannel;
        console.log(`復元対象: ${results.length} 件 (放送局情報から: ${fromChannel}, ファイル名から: ${fromFileName})`);

        // 放送局ごとの内訳を表示する
        const summary: { [key: string]: number } = {};
        for (const result of results) {
            const key = `${result.channelId} -> ${result.channelName} (${result.from})`;
            summary[key] = (summary[key] || 0) + 1;
        }
        for (const key of Object.keys(summary).sort()) {
            console.log(`  ${key}: ${summary[key]} 件`);
        }

        if (isApply === false) {
            console.log('');
            console.log('DB を更新するには --apply を指定して再実行してください');

            return;
        }

        await apply(results);
        console.log('DB を更新しました');
    };
}

// 直接実行された場合のみ処理を開始する (テスト等からの import では実行しない)
if (require.main === module) {
    const args = minimist(process.argv.slice(2), {
        boolean: ['apply'],
        string: ['format'],
    });

    container.get<ILoggerModel>('ILoggerModel').initialize();

    (async () => {
        try {
            await RecoverChannelNameTool.run(args.apply === true, args.format);
            process.exit(0);
        } catch (err: any) {
            console.error(err);
            process.exit(1);
        }
    })();
}

export default RecoverChannelNameTool;
