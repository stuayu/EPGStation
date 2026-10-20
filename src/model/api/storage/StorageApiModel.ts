import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import DiskSpaceUtil from '../../../util/DiskSpaceUtil';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IReserveDB from '../../db/IReserveDB';
import IProgramDB from '../../db/IProgramDB';
import Reserve from '../../../db/entities/Reserve';
import { resolveEndAt } from '../../../util/ProgramDuration';
import { resolveRecordingTimingConfig } from '../../operator/recording/RecordingTimingConfig';
import {
    DirCandidate,
    resolveStorageFallbackConfig,
    simulateRecordedDirCapacity,
} from '../../operator/recording/RecordedDirCapacity';
import IStorageApiModel from './IStorageApiModel';

@injectable()
export default class StorageApiModel implements IStorageApiModel {
    private config: IConfigFile;
    private reserveDB: IReserveDB;
    private programDB: IProgramDB;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IReserveDB') reserveDB: IReserveDB,
        @inject('IProgramDB') programDB: IProgramDB,
    ) {
        this.config = configuration.getConfig();
        this.reserveDB = reserveDB;
        this.programDB = programDB;
    }

    /**
     * recorded のディスク情報を返す
     * @return Promise<apid.StorageInfo>
     */
    public async getInfo(): Promise<apid.StorageInfo> {
        const now = Date.now();
        const future = (await this.reserveDB.findFutureForStorage(now)).filter(r => r.isSkip === false && r.isConflict === false);
        const programIds = [...new Set(future.map(r => r.programId).filter((id): id is number => id !== null))];
        const programs = programIds.length > 0 ? await this.programDB.findIds(programIds) : [];
        const programsById = new Map(programs.map(program => [program.id, program]));
        const items: apid.StorageItem[] = [];
        const candidates: DirCandidate[] = [];

        for (const r of this.config.recorded) {
            const info = await this.getDiskInfo(r.path);
            candidates.push({ dir: r, freeBytes: info.available });
            items.push({ ...info, name: r.name });
        }

        const simulationReserves = await Promise.all(
            future.map(async (reserve: Reserve) => {
                const program = reserve.programId === null ? null : programsById.get(reserve.programId) ?? null;
                const reserveTiming = resolveRecordingTimingConfig(
                    this.config.recording,
                    this.config.timeSpecifiedStartMargin,
                    this.config.timeSpecifiedEndMargin,
                    reserve,
                );
                return {
                    id: reserve.id,
                    name: reserve.name,
                    startAt: reserve.startAt,
                    endAt: program === null ? reserve.endAt : resolveEndAt(reserve.startAt, program.duration),
                    channelType: reserve.channelType,
                    isSkip: reserve.isSkip,
                    isConflict: reserve.isConflict,
                    plannedTunerIndex: reserve.plannedTunerIndex,
                    startMarginMs: reserveTiming.startMarginMs,
                    endMarginMs: reserveTiming.endMarginMs,
                    parentDirectoryName: reserve.parentDirectoryName,
                };
            }),
        );
        const simulation = simulateRecordedDirCapacity(
            simulationReserves,
            candidates,
            resolveStorageFallbackConfig(this.config.recording),
        );
        for (const item of items) {
            item.reservedEstimatedSize = simulation.reservedEstimatedSize[item.name] ?? 0;
            const shortfall = simulation.firstInsufficientReserveByDir[item.name];
            if (shortfall !== undefined) {
                item.firstShortfallReserveId = shortfall.id;
                item.firstShortfallReserveStartAt = shortfall.startAt;
                item.firstShortfallReserveName = shortfall.name;
            }
        }

        return {
            items: items,
        };
    }

    /**
     * 指定したディレクトリのディスク使用情報を取得する
     * @param dirPath ディスクディレクトリ
     */
    private async getDiskInfo(dirPath: string): Promise<apid.DiskUsage> {
        const usage = await DiskSpaceUtil.get(dirPath);

        return {
            available: usage.available,
            used: usage.used,
            total: usage.total,
        };
    }
}
