import { promises as fs } from 'fs';

/**
 * TS の再生開始時刻算出に必要な最小限の情報。
 * TsInfo / VideoFileTsInfo のどちらからでも渡せるようにする。
 */
export interface TsPlaybackTimeInfo {
    serviceId: number | null;
    videoPid: number | null;
    audioPid: number | null;
    firstTdtAt: number | null;
}

/**
 * TS の先頭で「最初に再生される映像 (無ければ音声) の PTS」が示す実時刻を求める。
 *
 * TsInfoAnalyzer.firstTdtAt は TDT/TOT と PCR から「先頭 PCR の実時刻」を求めた値であり、
 * 再生位置 0 秒 (= 最初の映像 PTS) と必ずしも一致しない。特に tsreplace のように
 * 映像を差し替えて PTS/PCR を再構成した TS では、この差が実況同期のずれになる。
 *
 * そこで対象サービスの PMT から PCR_PID を取り、先頭 PCR と最初の映像/音声 PTS の
 * 差を MPEG-TS の同一システム時刻軸上で求め、firstTdtAt へ加算する。
 */
export default class TsPlaybackTimeResolver {
    private static readonly TS_PACKET_SIZE = 188;
    private static readonly SYNC_BYTE = 0x47;
    private static readonly MAX_READ_BYTES = 32 * 1024 * 1024;
    private static readonly PCR_TICK_HZ = 27_000_000;
    private static readonly PTS_TO_PCR_TICKS = 300;
    private static readonly PCR_WRAP_TICKS = Math.pow(2, 33) * TsPlaybackTimeResolver.PTS_TO_PCR_TICKS;
    // 先頭 PCR と最初の映像 PTS が 5 分以上離れる TS は壊れた時刻とみなす。
    private static readonly MAX_MEDIA_OFFSET_MS = 5 * 60 * 1000;

    /**
     * ファイルの再生位置 0 秒に対応する UNIX 時刻 (ms) を返す。
     * 算出できない場合は null を返し、呼び出し側で firstTdtAt 等へフォールバックする。
     * @param filePath TS ファイルパス
     * @param info TS 解析結果
     * @return Promise<number | null>
     */
    public static async resolve(filePath: string, info: TsPlaybackTimeInfo): Promise<number | null> {
        if (
            info.firstTdtAt === null ||
            info.serviceId === null ||
            (info.videoPid === null && info.audioPid === null)
        ) {
            return null;
        }

        const handle = await fs.open(filePath, 'r');
        try {
            const stat = await handle.stat();
            const readSize = Math.min(stat.size, TsPlaybackTimeResolver.MAX_READ_BYTES);
            if (readSize < TsPlaybackTimeResolver.TS_PACKET_SIZE * 3) {
                return null;
            }

            const buffer = Buffer.allocUnsafe(readSize);
            const { bytesRead } = await handle.read(buffer, 0, readSize, 0);
            const syncOffset = TsPlaybackTimeResolver.findSyncOffset(buffer, bytesRead);
            if (syncOffset === null) {
                return null;
            }

            const targetMediaPid = info.videoPid ?? info.audioPid;
            if (targetMediaPid === null) {
                return null;
            }

            const firstPcrByPid = new Map<number, number>();
            let pcrPid: number | null = null;
            let mediaPts: number | null = null;

            for (
                let offset = syncOffset;
                offset + TsPlaybackTimeResolver.TS_PACKET_SIZE <= bytesRead;
                offset += TsPlaybackTimeResolver.TS_PACKET_SIZE
            ) {
                if (buffer[offset] !== TsPlaybackTimeResolver.SYNC_BYTE) {
                    // 途中で同期が外れた場合は壊れた領域とみなし、誤った時刻を作らない。
                    return null;
                }

                const pid = ((buffer[offset + 1] & 0x1f) << 8) | buffer[offset + 2];
                const payloadUnitStart = (buffer[offset + 1] & 0x40) !== 0;
                const adaptationFieldControl = (buffer[offset + 3] >> 4) & 0x03;
                let payloadOffset = offset + 4;

                if (adaptationFieldControl === 2 || adaptationFieldControl === 3) {
                    const adaptationLength = buffer[offset + 4];
                    const adaptationEnd = offset + 5 + adaptationLength;
                    if (adaptationEnd > offset + TsPlaybackTimeResolver.TS_PACKET_SIZE) {
                        continue;
                    }

                    if (adaptationLength >= 7 && (buffer[offset + 5] & 0x10) !== 0) {
                        const pcr = TsPlaybackTimeResolver.readPcr(buffer, offset + 6);
                        if (pcr !== null && firstPcrByPid.has(pid) === false) {
                            firstPcrByPid.set(pid, pcr);
                        }
                    }

                    payloadOffset = adaptationEnd;
                }

                if (adaptationFieldControl === 0 || adaptationFieldControl === 2) {
                    continue;
                }
                if (payloadOffset >= offset + TsPlaybackTimeResolver.TS_PACKET_SIZE) {
                    continue;
                }

                if (payloadUnitStart === true) {
                    if (pcrPid === null) {
                        pcrPid = TsPlaybackTimeResolver.readPcrPidFromPmt(
                            buffer,
                            payloadOffset,
                            offset + TsPlaybackTimeResolver.TS_PACKET_SIZE,
                            info.serviceId,
                        );
                    }

                    if (pid === targetMediaPid && mediaPts === null) {
                        mediaPts = TsPlaybackTimeResolver.readPesPts(
                            buffer,
                            payloadOffset,
                            offset + TsPlaybackTimeResolver.TS_PACKET_SIZE,
                        );
                    }
                }

                if (mediaPts !== null && pcrPid !== null && firstPcrByPid.has(pcrPid) === true) {
                    break;
                }
            }

            if (mediaPts === null || pcrPid === null) {
                return null;
            }

            // firstTdtAt は TsInfoAnalyzer が「対象サービスの先頭 PCR」に結び付けた実時刻なので、
            // 必ず PMT で確定した同じ PCR_PID を使う。他サービスの PCR からは推測しない。
            const firstPcr = firstPcrByPid.get(pcrPid) ?? null;
            if (firstPcr === null) {
                return null;
            }

            const mediaTicks = mediaPts * TsPlaybackTimeResolver.PTS_TO_PCR_TICKS;
            const deltaTicks = TsPlaybackTimeResolver.normalizeClockDelta(mediaTicks - firstPcr);
            const deltaMs = (deltaTicks / TsPlaybackTimeResolver.PCR_TICK_HZ) * 1000;
            if (
                Number.isFinite(deltaMs) === false ||
                Math.abs(deltaMs) > TsPlaybackTimeResolver.MAX_MEDIA_OFFSET_MS
            ) {
                return null;
            }

            return Math.round(Number(info.firstTdtAt) + deltaMs);
        } finally {
            await handle.close().catch(() => {});
        }
    }

    private static findSyncOffset(buffer: Buffer, bytesRead: number): number | null {
        const searchEnd = Math.min(bytesRead - TsPlaybackTimeResolver.TS_PACKET_SIZE * 2, 4096);
        for (let i = 0; i <= searchEnd; i++) {
            if (
                buffer[i] === TsPlaybackTimeResolver.SYNC_BYTE &&
                buffer[i + TsPlaybackTimeResolver.TS_PACKET_SIZE] === TsPlaybackTimeResolver.SYNC_BYTE &&
                buffer[i + TsPlaybackTimeResolver.TS_PACKET_SIZE * 2] === TsPlaybackTimeResolver.SYNC_BYTE
            ) {
                return i;
            }
        }

        return null;
    }

    private static readPcr(buffer: Buffer, offset: number): number | null {
        if (offset + 6 > buffer.length) {
            return null;
        }

        const base =
            buffer[offset] * Math.pow(2, 25) +
            buffer[offset + 1] * Math.pow(2, 17) +
            buffer[offset + 2] * Math.pow(2, 9) +
            buffer[offset + 3] * 2 +
            ((buffer[offset + 4] & 0x80) >> 7);
        const extension = ((buffer[offset + 4] & 0x01) << 8) | buffer[offset + 5];

        return base * TsPlaybackTimeResolver.PTS_TO_PCR_TICKS + extension;
    }

    private static readPcrPidFromPmt(
        buffer: Buffer,
        payloadOffset: number,
        packetEnd: number,
        serviceId: number,
    ): number | null {
        if (payloadOffset >= packetEnd) {
            return null;
        }

        const pointer = buffer[payloadOffset];
        const section = payloadOffset + 1 + pointer;
        // table_id + section header + program_number + version/section + PCR_PID まで 10 byte 必要。
        if (section + 10 > packetEnd || buffer[section] !== 0x02) {
            return null;
        }

        const programNumber = (buffer[section + 3] << 8) | buffer[section + 4];
        if (programNumber !== serviceId) {
            return null;
        }

        return ((buffer[section + 8] & 0x1f) << 8) | buffer[section + 9];
    }

    private static readPesPts(buffer: Buffer, payloadOffset: number, packetEnd: number): number | null {
        if (payloadOffset + 14 > packetEnd) {
            return null;
        }
        if (
            buffer[payloadOffset] !== 0x00 ||
            buffer[payloadOffset + 1] !== 0x00 ||
            buffer[payloadOffset + 2] !== 0x01
        ) {
            return null;
        }

        const flags = buffer[payloadOffset + 7];
        if ((flags & 0x80) === 0) {
            return null;
        }

        const p = payloadOffset + 9;
        // marker_bit を確認する。壊れた PES の 5 byte を時刻として誤採用しない。
        if ((buffer[p] & 0x01) !== 1 || (buffer[p + 2] & 0x01) !== 1 || (buffer[p + 4] & 0x01) !== 1) {
            return null;
        }

        return (
            (buffer[p] & 0x0e) * Math.pow(2, 29) +
            buffer[p + 1] * Math.pow(2, 22) +
            (buffer[p + 2] & 0xfe) * Math.pow(2, 14) +
            buffer[p + 3] * Math.pow(2, 7) +
            ((buffer[p + 4] & 0xfe) >> 1)
        );
    }

    private static normalizeClockDelta(deltaTicks: number): number {
        const half = TsPlaybackTimeResolver.PCR_WRAP_TICKS / 2;
        let normalized = deltaTicks % TsPlaybackTimeResolver.PCR_WRAP_TICKS;
        if (normalized > half) {
            normalized -= TsPlaybackTimeResolver.PCR_WRAP_TICKS;
        } else if (normalized < -half) {
            normalized += TsPlaybackTimeResolver.PCR_WRAP_TICKS;
        }

        return normalized;
    }
}
