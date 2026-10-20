import { spawn } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import ChapterFileUtil from '../../../util/ChapterFileUtil';
import CmDetectionFileUtil from '../../../util/CmDetectionFileUtil';
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
        const evidencePath = CmDetectionFileUtil.getEvidencePath(filePath);
        if (fs.existsSync(chapterPath)) return;
        if (fs.existsSync(evidencePath)) {
            try {
                const previous = JSON.parse(await fs.promises.readFile(evidencePath, 'utf8'));
                if (previous.videoFileName === filePath.split(/[\\/]/).pop() && previous.chapterWritten === true)
                    return;
            } catch {
                // 不正/古い判定JSONは再検出可能にする
            }
        }
        const ffmpeg = this.config.getConfig().ffmpeg;
        const embeddedResult = await this.run(this.config.getConfig().ffprobe, [
            '-v',
            '0',
            '-show_chapters',
            '-of',
            'json',
            filePath,
        ]);
        if (JSON.parse(embeddedResult.output).chapters?.length > 0) return;
        const detection = await this.run(ffmpeg, [
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
        const durationMatch = detection.output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (durationMatch === null) throw new Error('DurationNotFound');
        const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
        const silences = parseSilenceDetectOutput(detection.output);
        const commercials = detectCmIntervals(duration, silences);
        const evidence = JSON.stringify(
            {
                version: 1,
                videoFileName: filePath.split(/[\\/]/).pop(),
                chapterWritten: silences.length > 0 || commercials.length > 0,
                duration,
                parameters: CM_DETECT_PARAMETERS,
                silences,
                commercials,
            },
            null,
            2,
        );
        const chapterWritten = silences.length > 0 || commercials.length > 0;
        const text = chapterWritten ? createChapterText(duration, commercials) : null;
        const suffix = `.tmp-${process.pid}-${Date.now()}`;
        const evidenceTempPath = `${evidencePath}${suffix}`;
        const chapterTempPath = `${chapterPath}${suffix}`;
        let chapterCommitted = false;
        try {
            await fs.promises.writeFile(evidenceTempPath, evidence, 'utf8');
            if (text !== null) {
                await fs.promises.writeFile(chapterTempPath, text, 'utf8');
                await fs.promises.rename(chapterTempPath, chapterPath);
                chapterCommitted = true;
            }
            await fs.promises.rename(evidenceTempPath, evidencePath);
        } catch (err) {
            await fs.promises.unlink(evidenceTempPath).catch(() => {});
            await fs.promises.unlink(chapterTempPath).catch(() => {});
            if (chapterCommitted) await fs.promises.unlink(chapterPath).catch(() => {});
            this.log.system.warn(`cannot write CM chapters: ${chapterPath}`);
            this.log.system.warn(err);
        }
    }

    private run(command: string, args: string[]): Promise<{ output: string; code: number }> {
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
                if (code === 0) resolve({ output: stdout.length > 0 ? stdout : stderr, code });
                else reject(new Error(`process exited ${code}: ${stderr.slice(-1000)}`));
            });
        });
    }
}
