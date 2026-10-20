import { spawn } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import ChapterFileUtil from '../../../util/ChapterFileUtil';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import { IPromiseQueue } from '../../IPromiseQueue';
import IVideoUtil from '../../api/video/IVideoUtil';
import {
    CM_DETECT_PARAMETERS,
    createChapterText,
    detectCmIntervals,
    parseSilenceDetectOutput,
} from '../../../util/CmDetectUtil';
import ICmDetectionManageModel from './ICmDetectionManageModel';

@injectable()
export default class CmDetectionManageModel implements ICmDetectionManageModel {
    private static readonly TIMEOUT_MS = 60 * 60 * 1000;
    private log: ILogger;
    private config: IConfiguration;
    private queue: IPromiseQueue;
    private videoDB: IVideoFileDB;
    private videoUtil: IVideoUtil;
    private queued = new Set<apid.VideoFileId>();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') config: IConfiguration,
        @inject('IPromiseQueue') queue: IPromiseQueue,
        @inject('IVideoFileDB') videoDB: IVideoFileDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
    ) {
        this.log = logger.getLogger();
        this.config = config;
        this.queue = queue;
        this.videoDB = videoDB;
        this.videoUtil = videoUtil;
    }

    public add(videoFileId: apid.VideoFileId): void {
        if (this.config.getConfig().cmDetection?.enabled !== true || this.queued.has(videoFileId)) return;
        this.queued.add(videoFileId);
        this.queue.add<void>(() =>
            this.detect(videoFileId)
                .catch(err => {
                    this.log.system.warn(`CM chapter detection failed: videoFileId=${videoFileId}`);
                    this.log.system.warn(err);
                })
                .finally(() => this.queued.delete(videoFileId)),
        );
    }

    private async detect(videoFileId: apid.VideoFileId): Promise<void> {
        if (this.config.getConfig().cmDetection?.enabled !== true) return;
        const video = await this.videoDB.findId(videoFileId);
        if (video === null || video.type !== 'ts') return;
        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (filePath === null) return;
        const chapterPath = ChapterFileUtil.getChapterFilePath(filePath);
        const evidencePath = filePath.replace(/\.[^.]+$/, '.cm-detection.json');
        if (fs.existsSync(chapterPath)) return;
        const ffmpeg = this.config.getConfig().ffmpeg;
        const embedded = await this.run(this.config.getConfig().ffprobe, [
            '-v',
            '0',
            '-show_chapters',
            '-of',
            'json',
            filePath,
        ]);
        if (JSON.parse(embedded).chapters?.length > 0) return;
        const stderr = await this.run(ffmpeg, [
            '-hide_banner',
            '-nostats',
            '-i',
            filePath,
            '-map',
            '0:a:0',
            '-vn',
            '-af',
            `silencedetect=noise=${CM_DETECT_PARAMETERS.silenceNoiseDb}dB:d=${CM_DETECT_PARAMETERS.minSilenceSeconds}`,
            '-f',
            'null',
            '-',
        ]);
        const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (durationMatch === null) throw new Error('DurationNotFound');
        const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
        const silences = parseSilenceDetectOutput(stderr);
        const commercials = detectCmIntervals(duration, silences);
        const text = createChapterText(duration, commercials);
        try {
            await fs.promises.writeFile(chapterPath, text, 'utf8');
            await fs.promises.writeFile(
                evidencePath,
                JSON.stringify(
                    { version: 1, duration, parameters: CM_DETECT_PARAMETERS, silences, commercials },
                    null,
                    2,
                ),
                'utf8',
            );
        } catch (err) {
            this.log.system.warn(`cannot write CM chapters: ${chapterPath}`);
            this.log.system.warn(err);
        }
    }

    private run(command: string, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, { windowsHide: true });
            let stderr = '';
            let stdout = '';
            child.stdout?.on('data', data => {
                stdout += data.toString();
            });
            const timer = setTimeout(() => child.kill(), CmDetectionManageModel.TIMEOUT_MS);
            child.stderr?.on('data', data => {
                stderr += data.toString();
            });
            child.on('error', err => {
                clearTimeout(timer);
                reject(err);
            });
            child.on('close', code => {
                clearTimeout(timer);
                if (code === 0 || code === 1) resolve(stdout.length > 0 ? stdout : stderr);
                else reject(new Error(`process exited ${code}: ${stderr.slice(-1000)}`));
            });
        });
    }
}
