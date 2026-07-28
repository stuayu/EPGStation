import * as fs from 'fs';
import { injectable } from 'inversify';
import * as yaml from 'js-yaml';
import * as log4js from 'log4js';
import * as path from 'path';
import ILogger from './ILogger';
import ILoggerModel from './ILoggerModel';

/**
 * ログファイルのファイルパスを生成する
 * @param dir: dir
 * @param filename: file name
 * @return file path
 */
export const createDefaultLogPath = (dir: string, filename: string): string => {
    const logFileFullPath = path.join(__dirname, '..', '..', 'logs', dir, filename);

    return process.platform === 'win32' ? logFileFullPath.replace(/\\/g, '\\\\') : logFileFullPath;
};

/**
 * ログ設定ファイル内のプレースホルダをログファイルパスへ置換する
 * @param str: ログ設定ファイルの中身
 * @return 置換後の文字列
 */
export const replaceLogFilePath = (str: string): string => {
    return str
        .replace('%OperatorSystem%', createDefaultLogPath('Operator', 'system.log'))
        .replace('%OperatorAccess%', createDefaultLogPath('Operator', 'access.log'))
        .replace('%OperatorStream%', createDefaultLogPath('Operator', 'stream.log'))
        .replace('%OperatorEncode%', createDefaultLogPath('Operator', 'encode.log'))
        .replace('%ServiceSystem%', createDefaultLogPath('Service', 'system.log'))
        .replace('%ServiceAccess%', createDefaultLogPath('Service', 'access.log'))
        .replace('%ServiceStream%', createDefaultLogPath('Service', 'stream.log'))
        .replace('%ServiceEncode%', createDefaultLogPath('Service', 'encode.log'))
        .replace('%EPGUpdaterSystem%', createDefaultLogPath('EPGUpdater', 'system.log'))
        .replace('%EPGUpdaterAccess%', createDefaultLogPath('EPGUpdater', 'access.log'))
        .replace('%EPGUpdaterStream%', createDefaultLogPath('EPGUpdater', 'stream.log'))
        .replace('%EPGUpdaterEncode%', createDefaultLogPath('EPGUpdater', 'encode.log'));
};

/**
 * Logger
 */
@injectable()
export default class LoggerModel implements ILoggerModel {
    private logger: ILogger | null = null;

    /**
     * 初期設定
     * @param filePath: log file path
     */
    public initialize(filePath?: string): void {
        if (typeof filePath === 'undefined') {
            log4js.configure({
                appenders: {
                    system: { type: 'console' },
                    access: { type: 'console' },
                    stream: { type: 'console' },
                    encode: { type: 'console' },
                    console: { type: 'console' },
                },
                categories: {
                    default: { appenders: ['console'], level: 'info' },
                    system: { appenders: ['system'], level: 'info' },
                    access: { appenders: ['access'], level: 'info' },
                    stream: { appenders: ['stream'], level: 'info' },
                    encode: { appenders: ['system'], level: 'info' },
                },
            });
        } else {
            // 用意されていない場合は同梱の sample から生成する (config.yml と同じ扱い)
            LoggerModel.ensureLogConfigFile(filePath);

            if (fs.existsSync(filePath) === false) {
                // sample も無い場合はコンソール出力で起動を続ける。
                // ログ設定が無いだけで EPGStation 全体が起動できないのは割に合わない
                console.error(`log config file is not found: ${filePath}`);
                console.error('fallback to console logging');
                this.initialize();

                return;
            }

            try {
                const str = this.readLogFile(filePath);
                const config: log4js.Configuration = yaml.load(str) as any;
                log4js.configure(config);
            } catch (err: any) {
                console.error('log file parse error');
                process.exit(1);
            }
        }

        // set Logger
        this.logger = {
            system: log4js.getLogger('system'),
            access: log4js.getLogger('access'),
            stream: log4js.getLogger('stream'),
            encode: log4js.getLogger('encode'),
        };
    }

    /**
     * ログ設定ファイルが無ければ同梱の sample (<name>.sample.yml) から生成する。
     * Operator / Service / EPGUpdater が同時に起動しても競合しないよう、
     * 排他作成 (COPYFILE_EXCL) を使い EEXIST は正常として扱う
     * @param filePath: string 生成先のログ設定ファイル
     */
    private static ensureLogConfigFile(filePath: string): void {
        if (fs.existsSync(filePath) === true) {
            return;
        }

        const samplePath = filePath.replace(/\.yml$/, '.sample.yml');
        if (fs.existsSync(samplePath) === false) {
            return;
        }

        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.copyFileSync(samplePath, filePath, fs.constants.COPYFILE_EXCL);
            console.log(`log config file generated at ${filePath} from ${samplePath}.`);
        } catch (err: any) {
            if (err?.code === 'EEXIST') {
                // 他プロセスが先に作成した (正常)
                return;
            }
            console.error(`failed to generate log config file from ${samplePath}`);
            console.error(err);
        }
    }

    /**
     * Logger を返す
     * @return Logger
     */
    public getLogger(): ILogger {
        if (this.logger === null) {
            console.error('Logger is not initialized');
            process.exit(1);
        }

        return this.logger;
    }

    /**
     * read lof file
     * @param filePath log file path
     * @return log file
     */
    private readLogFile(filePath: string): string {
        // ログ設定ファイル読み取り
        let str: string = '';
        try {
            str = fs.readFileSync(filePath, 'utf-8');
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                console.error('log file is not found');
            } else {
                console.error(err);
            }
            process.exit(1);
        }

        if (typeof str === 'undefined') {
            console.error('log file read error');
            process.exit(1);
        }

        // replace path
        return replaceLogFilePath(str);
    }
}
