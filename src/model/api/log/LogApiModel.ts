import * as fs from 'fs';
import { injectable } from 'inversify';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as apid from '../../../../api';
import { replaceLogFilePath } from '../../LoggerModel';
import ILogApiModel, { GetLogContentOption } from './ILogApiModel';

interface LogSource {
    process: apid.LogProcessType;
    configFileName: string;
}

interface ResolvedLogFile {
    item: apid.LogFileItem;
    filePath: string;
}

/**
 * LogApiModel
 * log4js の設定ファイルを元に実際に出力されているログファイルを列挙し、内容を末尾から読み取る
 */
@injectable()
class LogApiModel implements ILogApiModel {
    /**
     * ログファイル一覧を返す
     * @return Promise<apid.LogFiles>
     */
    public async getFiles(): Promise<apid.LogFiles> {
        const files = await this.resolveLogFiles();

        return {
            items: files.map(f => f.item),
        };
    }

    /**
     * 指定されたログファイルの内容を末尾から返す
     * @param logFileId: ログファイル id
     * @param option: GetLogContentOption
     * @return Promise<apid.LogFileContent | null> 存在しない場合は null
     */
    public async getContent(logFileId: string, option: GetLogContentOption = {}): Promise<apid.LogFileContent | null> {
        const target = await this.findLogFile(logFileId);
        if (target === null) {
            return null;
        }

        const maxLines =
            typeof option.lines === 'undefined' || isNaN(option.lines) === true || option.lines <= 0
                ? LogApiModel.DEFAULT_LINES
                : Math.min(option.lines, LogApiModel.MAX_LINES);

        const tail = await this.readTail(target.filePath, LogApiModel.MAX_READ_SIZE);

        let lines = tail.text.split(/\r?\n/);
        // 途中から読み込んだ場合、先頭行は欠けている可能性があるため除去する
        if (tail.isPartial === true && lines.length > 1) {
            lines.shift();
        }
        // 末尾の空行を除去
        while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
            lines.pop();
        }

        // キーワード絞り込み
        const keyword = typeof option.keyword === 'string' ? option.keyword.trim() : '';
        if (keyword.length > 0) {
            const lowerKeyword = keyword.toLowerCase();
            lines = lines.filter(line => line.toLowerCase().indexOf(lowerKeyword) !== -1);
        }

        const isTruncated = tail.isPartial === true || lines.length > maxLines;
        if (lines.length > maxLines) {
            lines = lines.slice(lines.length - maxLines);
        }

        return {
            id: target.item.id,
            process: target.item.process,
            category: target.item.category,
            name: target.item.name,
            size: target.item.size,
            updatedAt: target.item.updatedAt,
            isTruncated: isTruncated,
            lines: lines,
        };
    }

    /**
     * ダウンロード用にログファイルのフルパスを返す
     * @param logFileId: ログファイル id
     * @return Promise<string | null> 存在しない場合は null
     */
    public async getFilePath(logFileId: string): Promise<string | null> {
        const target = await this.findLogFile(logFileId);

        return target === null ? null : target.filePath;
    }

    /**
     * id からログファイル情報を探す
     * 列挙結果との突き合わせで解決するため、パストラバーサルは成立しない
     * @param logFileId: ログファイル id
     * @return Promise<ResolvedLogFile | null>
     */
    private async findLogFile(logFileId: string): Promise<ResolvedLogFile | null> {
        const files = await this.resolveLogFiles();

        return files.find(f => f.item.id === logFileId) ?? null;
    }

    /**
     * log4js 設定から出力先ログファイル (ローテート済みを含む) を列挙する
     * @return Promise<ResolvedLogFile[]>
     */
    private async resolveLogFiles(): Promise<ResolvedLogFile[]> {
        const result: ResolvedLogFile[] = [];

        for (const source of LogApiModel.LOG_SOURCES) {
            const baseFiles = this.getConfiguredLogFiles(source);

            for (const base of baseFiles) {
                const dir = path.dirname(base.filePath);
                const baseName = path.basename(base.filePath);

                let dirents: string[];
                try {
                    dirents = await fs.promises.readdir(dir);
                } catch (err: any) {
                    // ログディレクトリが存在しない場合はスキップ
                    continue;
                }

                // ローテートファイル (system.log.-2026-07-25.1 など) も含めて収集する
                const targets = dirents.filter(name => name === baseName || name.startsWith(`${baseName}.`));

                for (const name of targets) {
                    const filePath = path.join(dir, name);

                    let stat: fs.Stats;
                    try {
                        stat = await fs.promises.stat(filePath);
                    } catch (err: any) {
                        continue;
                    }

                    if (stat.isFile() === false) {
                        continue;
                    }

                    const id = `${source.process}/${name}`;
                    if (result.some(r => r.item.id === id) === true) {
                        continue;
                    }

                    result.push({
                        filePath: filePath,
                        item: {
                            id: id,
                            process: source.process,
                            category: base.category,
                            name: name,
                            size: stat.size,
                            updatedAt: stat.mtime.getTime(),
                            isRotated: name !== baseName,
                        },
                    });
                }
            }
        }

        // プロセス -> カテゴリ -> 最新順で並べる
        result.sort((a, b) => {
            if (a.item.process !== b.item.process) {
                return (
                    LogApiModel.LOG_SOURCES.findIndex(s => s.process === a.item.process) -
                    LogApiModel.LOG_SOURCES.findIndex(s => s.process === b.item.process)
                );
            }
            if (a.item.category !== b.item.category) {
                return a.item.category < b.item.category ? -1 : 1;
            }
            if (a.item.isRotated !== b.item.isRotated) {
                return a.item.isRotated === false ? -1 : 1;
            }

            return b.item.updatedAt - a.item.updatedAt;
        });

        return result;
    }

    /**
     * ログ設定ファイルを読み取り、file 系 appender の出力先を返す
     * @param source: LogSource
     * @return Array<{ category: string; filePath: string }>
     */
    private getConfiguredLogFiles(source: LogSource): Array<{ category: string; filePath: string }> {
        const configPath = path.join(LogApiModel.CONFIG_DIR, source.configFileName);

        let config: any;
        try {
            const str = replaceLogFilePath(fs.readFileSync(configPath, 'utf-8'));
            config = yaml.load(str);
        } catch (err: any) {
            return [];
        }

        if (config === null || typeof config !== 'object' || typeof config.appenders !== 'object') {
            return [];
        }

        const files: Array<{ category: string; filePath: string }> = [];
        for (const category in config.appenders) {
            const appender = config.appenders[category];
            if (
                appender === null ||
                typeof appender !== 'object' ||
                LogApiModel.FILE_APPENDER_TYPES.indexOf(appender.type) === -1 ||
                typeof appender.filename !== 'string'
            ) {
                continue;
            }

            files.push({
                category: category,
                // win32 向けにエスケープされたパスを元に戻す
                filePath: path.resolve(appender.filename.replace(/\\\\/g, '\\')),
            });
        }

        return files;
    }

    /**
     * ファイル末尾を指定バイト数分読み取る
     * @param filePath: file path
     * @param maxSize: 読み取る最大バイト数
     * @return Promise<{ text: string; isPartial: boolean }>
     */
    private async readTail(filePath: string, maxSize: number): Promise<{ text: string; isPartial: boolean }> {
        const stat = await fs.promises.stat(filePath);
        const readSize = Math.min(stat.size, maxSize);
        const position = stat.size - readSize;

        const handle = await fs.promises.open(filePath, 'r');
        try {
            const buffer = Buffer.alloc(readSize);
            await handle.read(buffer, 0, readSize, position);

            return {
                text: buffer.toString('utf-8'),
                isPartial: position > 0,
            };
        } finally {
            await handle.close();
        }
    }
}

namespace LogApiModel {
    export const CONFIG_DIR = path.join(__dirname, '..', '..', '..', '..', 'config');

    export const LOG_SOURCES: LogSource[] = [
        { process: 'Operator', configFileName: 'operatorLogConfig.yml' },
        { process: 'Service', configFileName: 'serviceLogConfig.yml' },
        { process: 'EPGUpdater', configFileName: 'epgUpdaterLogConfig.yml' },
    ];

    export const FILE_APPENDER_TYPES = ['file', 'fileSync', 'dateFile'];

    // 一度に返す行数の既定値と上限
    export const DEFAULT_LINES = 500;
    export const MAX_LINES = 5000;

    // ログは大きくなりやすいため、末尾から読むバイト数を制限する (8MB)
    export const MAX_READ_SIZE = 8 * 1024 * 1024;
}

export default LogApiModel;
