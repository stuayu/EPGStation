import { Readable } from 'stream';
import {
    createOfflineEndRecord,
    createOfflineInitRecord,
    createOfflineMasterRecord,
    createOfflineSegmentRecord,
    OfflineStreamRole,
} from '../../../../util/OfflineStreamProtocol';
import Mp4CodecUtil from './Mp4CodecUtil';
import IFmp4Packager, { Fmp4PackagerSegment, Fmp4PackagerTrackRole } from './IFmp4Packager';

const roleMap: Record<Fmp4PackagerTrackRole, OfflineStreamRole> = {
    video: 'video',
    audio0: 'audio0',
    audio1: 'audio1',
};

/** fMP4 パッケージャの完成イベントを、オフライン保存用の逐次レコードへ変換する Readable。 */
export default class OfflineFmp4RecordStream extends Readable {
    private readonly source: Readable;
    private readonly packager: IFmp4Packager;
    private initialRecords = new Map<OfflineStreamRole, Buffer>();
    private multiTrackRoles: Fmp4PackagerTrackRole[] | null = null;
    private initialFlushed = false;
    private recordCount = 0;
    private sourcePaused = false;

    public constructor(source: Readable, packager: IFmp4Packager) {
        super({ highWaterMark: 1 });
        this.source = source;
        this.packager = packager;
        packager.on('init', data => {
            this.initialRecords.set('single', data);
            this.flushInitial();
        });
        packager.on('multiTrack', roles => {
            this.multiTrackRoles = roles;
        });
        packager.on('trackInit', (role, data) => {
            this.initialRecords.set(roleMap[role], data);
            this.flushInitial();
        });
        packager.on('segment', segment => this.pushSegment('single', segment));
        packager.on('trackSegment', (role, segment) => this.pushSegment(roleMap[role], segment));
        packager.on('halted', message => this.destroy(new Error(message)));
        packager.on('finish', () => {
            this.flushInitial();
            if (this.destroyed === false) {
                this.push(createOfflineEndRecord(this.recordCount));
                this.push(null);
            }
        });
        source.on('error', error => this.destroy(error));
        source.pipe(packager);
    }

    public override _read(): void {
        if (this.sourcePaused === true) {
            this.sourcePaused = false;
            this.source.resume();
        }
    }

    private flushInitial(): void {
        if (this.initialFlushed === true) return;
        if (
            this.multiTrackRoles !== null &&
            this.multiTrackRoles.some(role => this.initialRecords.has(roleMap[role]) === false)
        )
            return;
        if (this.multiTrackRoles === null && this.initialRecords.has('single') === false) return;

        const roles =
            this.multiTrackRoles === null
                ? (['single'] as OfflineStreamRole[])
                : this.multiTrackRoles.map(role => roleMap[role]);
        for (const role of roles) {
            const init = this.initialRecords.get(role);
            if (typeof init === 'undefined') throw new Error(`offline init is missing: ${role}`);
            this.pushRecord(createOfflineInitRecord(role, init));
        }
        const master = this.createMasterPlaylist(roles);
        this.pushRecord(createOfflineMasterRecord(Buffer.from(master, 'utf8')));
        this.initialFlushed = true;
    }

    private createMasterPlaylist(roles: OfflineStreamRole[]): string {
        const videoRole = roles.includes('video') ? 'video' : 'single';
        const videoInit = this.initialRecords.get(videoRole);
        if (typeof videoInit === 'undefined') throw new Error('offline video init is missing');
        const videoCodec = Mp4CodecUtil.parseCodec(videoInit);
        if (videoCodec === null) throw new Error('OfflineVideoCodecIsUndefined');
        const audioRoles = roles.filter(role => role === 'audio0' || role === 'audio1');
        const audioCodecs = audioRoles
            .map(role => Mp4CodecUtil.parseCodec(this.initialRecords.get(role) as Buffer))
            .filter((codec): codec is string => codec !== null);
        const codecs = roles.includes('single')
            ? Mp4CodecUtil.parseCodecs(videoInit)
            : [...new Set([videoCodec, ...audioCodecs])];
        const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
        if (audioRoles.length > 0) {
            for (const [index, role] of audioRoles.entries()) {
                lines.push(
                    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${index === 0 ? '主音声' : '副音声'}",DEFAULT=${index === 0 ? 'YES' : 'NO'},AUTOSELECT=${index === 0 ? 'YES' : 'NO'},URI="${role}.m3u8"`,
                );
            }
        }
        const audioAttr = audioRoles.length > 0 ? ',AUDIO="audio"' : '';
        lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=3000000,CODECS="${codecs.join(',')}"${audioAttr}`);
        lines.push(`${videoRole}.m3u8`);
        return `${lines.join('\n')}\n`;
    }

    private pushSegment(role: OfflineStreamRole, segment: Fmp4PackagerSegment): void {
        if (this.initialFlushed === false) this.flushInitial();
        const record = createOfflineSegmentRecord(
            role,
            this.getNextSequence(role),
            Math.max(1, Math.round(segment.duration * 1000)),
            segment.data,
        );
        this.pushRecord(record);
    }

    private nextSequences = new Map<OfflineStreamRole, number>();

    private getNextSequence(role: OfflineStreamRole): number {
        const sequence = this.nextSequences.get(role) ?? 0;
        this.nextSequences.set(role, sequence + 1);
        return sequence;
    }

    private pushRecord(record: Buffer): void {
        this.recordCount += 1;
        if (this.push(record) === false) {
            this.sourcePaused = true;
            this.source.pause();
        }
    }

    public override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        this.source.unpipe(this.packager);
        if (error !== null) this.packager.destroy(error);
        callback(error);
    }
}
