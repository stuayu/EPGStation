import { inject, injectable } from 'inversify';
import IChannelAffiliationDB from '../db/IChannelAffiliationDB';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import { BitSectionInfo } from './BitParser';
import IBroadcastAffiliationCollector from './IBroadcastAffiliationCollector';

/**
 * BIT から取り出した系列情報を DB へ保存する
 *
 * BIT は録画・ライブ視聴で流れてきた TS からのみ収集する (受動収集)。
 * BIT には自局だけでなく同一ネットワークで受信できる他局の情報も載るため、
 * 1 局分の受信で複数の放送局の系列が埋まることがある。
 */
@injectable()
export default class BroadcastAffiliationCollector implements IBroadcastAffiliationCollector {
    private channelAffiliationDB: IChannelAffiliationDB;
    private log: ILogger;

    constructor(
        @inject('IChannelAffiliationDB') channelAffiliationDB: IChannelAffiliationDB,
        @inject('ILoggerModel') logger: ILoggerModel,
    ) {
        this.channelAffiliationDB = channelAffiliationDB;
        this.log = logger.getLogger();
    }

    /**
     * BIT の解析結果を保存する
     * @param sections: BitSectionInfo[]
     * @return Promise<void>
     */
    public async collect(sections: BitSectionInfo[]): Promise<void> {
        const affiliations = BroadcastAffiliationCollector.toNetworkAffiliations(sections);

        for (const networkId of Object.keys(affiliations)) {
            const id = parseInt(networkId, 10);
            try {
                const updated = await this.channelAffiliationDB.replace(id, affiliations[id]);
                if (updated === true) {
                    this.log.system.info(`update channel affiliation: networkId=${id} [${affiliations[id].join(',')}]`);
                }
            } catch (err: any) {
                this.log.system.error(`update channel affiliation error: networkId=${id}`);
                this.log.system.error(err.message);
            }
        }
    }

    /**
     * BIT の解析結果を networkId → 系列識別の一覧へ変換する
     * @param sections: BitSectionInfo[]
     * @return { [networkId: number]: number[] }
     */
    private static toNetworkAffiliations(sections: BitSectionInfo[]): { [networkId: number]: number[] } {
        const result: { [networkId: number]: number[] } = {};

        for (const section of sections) {
            for (const broadcaster of section.broadcasters) {
                if (broadcaster.affiliationIds.length === 0) {
                    continue;
                }

                // extended_broadcaster_descriptor が示す original_network_id を対象にする。
                // 記述子に含まれない場合は、そのセクションに事業者が 1 つしか無いときのみ
                // セクションの original_network_id を対象にする (誤った割り当てを避けるため)
                const networkIds =
                    broadcaster.networkIds.length > 0
                        ? broadcaster.networkIds
                        : section.broadcasters.length === 1
                          ? [section.originalNetworkId]
                          : [];

                for (const networkId of networkIds) {
                    if (typeof result[networkId] === 'undefined') {
                        result[networkId] = [];
                    }
                    for (const affiliationId of broadcaster.affiliationIds) {
                        if (result[networkId].indexOf(affiliationId) === -1) {
                            result[networkId].push(affiliationId);
                        }
                    }
                }
            }
        }

        return result;
    }
}
