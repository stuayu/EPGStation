import { inject, injectable } from 'inversify';
import { FindOptionsWhere } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import * as apid from '../../../api';
import * as mapid from '../../../node_modules/mirakurun/api';
import Channel from '../../db/entities/Channel';
import StrUtil from '../../util/StrUtil';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IPromiseRetry from '../IPromiseRetry';
import IChannelDB, { ChannelUpdateValues } from './IChannelDB';
import IDBOperator from './IDBOperator';

@injectable()
export default class ChannelDB implements IChannelDB {
    private log: ILogger;
    private configuration: IConfiguration;
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IDBOperator') op: IDBOperator,
        @inject('IPromiseRetry') promieRetry: IPromiseRetry,
    ) {
        this.log = logger.getLogger();
        this.configuration = configuration;
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * Mirakurun から取得した channel 情報を DB へ全件挿入する
     * @param channels: Service[]
     * @return Promise<void>
     */
    public async insert(channels: mapid.Service[]): Promise<void> {
        const values: QueryDeepPartialEntity<Channel>[] = [];

        // 挿入データ作成
        try {
            for (const channel of channels) {
                if (typeof channel.channel === 'undefined') {
                    return;
                }

                const name = StrUtil.toDBStr(channel.name);
                values.push({
                    id: channel.id,
                    serviceId: channel.serviceId,
                    networkId: channel.networkId,
                    name: name,
                    halfWidthName: StrUtil.toHalf(name),
                    remoteControlKeyId:
                        typeof channel.remoteControlKeyId === 'undefined' ? null : channel.remoteControlKeyId,
                    hasLogoData: !!channel.hasLogoData,
                    channelTypeId: this.getChannelTypeId(channel.channel[0].type),
                    channelType: channel.channel[0].type,
                    channel: channel.channel[0].channel,
                    type: typeof (channel as any)['type'] !== 'number' ? null : (channel as any)['type'],
                });
            }
        } catch (error) {
            this.log.system.error('Failed to create insert values for channels', error);
        }

        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        await queryRunner.startTransaction();

        const hasError = false;
        try {
            for (const value of values) {
                try {
                    // DBに挿入処理を実行
                    this.log.system.debug(`insert Channel: ${value.id} Name: ${value.halfWidthName}`);
                    await queryRunner.manager.insert(Channel, value);
                } catch (err) {
                    try {
                        // おそらくすでにデータが存在すため、IDを用いて更新処理を実施
                        await queryRunner.manager.update(Channel, value.id, value);
                    } catch (serr) {
                        this.log.system
                            .info(`Failed to insert Channel with ID: ${value.id} Name: ${value.halfWidthName} \
                            ChannelType: ${value.channelType}. Attempting to update. Error: ${err}`);
                        this.log.system
                            .info(`Failed to update Channel with ID: ${value.id} Name: ${value.halfWidthName} \
                            ChannelType: ${value.channelType}. Attempting to delete and re-insert. Error: ${serr}`);

                        try {
                            // IDを用いても更新処理が実施できない場合の苦肉の策として、削除と挿入を実施
                            await queryRunner.manager.delete(Channel, value.id);
                            await queryRunner.manager.insert(Channel, value);
                        } catch (error) {
                            this.log.system
                                .error(`Failed to delete and re-insert Channel with ID: ${value.id} Name: ${value.halfWidthName} \
                                ChannelType: ${value.channelType}. Error: ${error}`);
                        }
                    }
                }
            }
            await queryRunner.commitTransaction();
        } catch (transactionErr) {
            await queryRunner.rollbackTransaction();
            this.log.system.error('transaction error');
            this.log.system.error(transactionErr);
        } finally {
            await queryRunner.release();
        }
        if (hasError) {
            throw new Error('insert error');
        }
    }

    /**
     * ChannelTypeId を取得する
     * @paramChannelTypeId
     */
    private getChannelTypeId(type: mapid.ChannelType): number {
        switch (type) {
            case 'GR':
                return 0;
            case 'BS':
                return 1;
            case 'CS':
                return 2;
            case 'SKY':
                return 3;
            case 'NW1':
                return 4;
            case 'NW2':
                return 5;
            case 'NW3':
                return 6;
            case 'NW4':
                return 7;
            case 'NW5':
                return 8;
            case 'NW6':
                return 9;
            case 'NW7':
                return 10;
            case 'NW8':
                return 11;
            case 'NW9':
                return 12;
            case 'NW10':
                return 13;
            case 'NW11':
                return 14;
            case 'NW12':
                return 15;
            case 'NW13':
                return 16;
            case 'NW14':
                return 17;
            case 'NW15':
                return 18;
            case 'NW16':
                return 19;
            case 'NW17':
                return 20;
            case 'NW18':
                return 21;
            case 'NW19':
                return 22;
            case 'NW20':
                return 23;
            case 'NW21':
                return 24;
            case 'NW22':
                return 25;
            case 'NW23':
                return 26;
            case 'NW24':
                return 27;
            case 'NW25':
                return 28;
            case 'NW26':
                return 29;
            case 'NW27':
                return 30;
            case 'NW28':
                return 31;
            case 'NW29':
                return 32;
            case 'NW30':
                return 33;
            case 'NW31':
                return 34;
            case 'NW32':
                return 35;
            case 'NW33':
                return 36;
            case 'NW34':
                return 37;
            case 'NW35':
                return 38;
            case 'NW36':
                return 39;
            case 'NW37':
                return 40;
            case 'NW38':
                return 41;
            case 'NW39':
                return 42;
            case 'NW40':
                return 43;

            default:
                return 44;
        }
    }

    /**
     * event stream 用更新
     * @param values ChannelUpdateValues
     * @return Promise<void>
     */
    public async update(values: ChannelUpdateValues): Promise<void> {
        const channels: mapid.Service[] = [];
        Array.prototype.push.apply(channels, values.insert);
        Array.prototype.push.apply(channels, values.update);

        await this.insert(channels);
    }

    /**
     * channel id を指定して検索
     * @param channelId: channel id
     * @return Promise<Channel | null>
     */
    public async findId(channelId: apid.ChannelId): Promise<Channel | null> {
        const connection = await this.op.getConnection();

        const repository = connection.getRepository(Channel);
        const result = await this.promieRetry.run(() => {
            return repository.findOne({
                where: [{ id: channelId }],
            });
        });

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * channelType を指定して検索
     * @param types: apid.ChannelType[]
     * @param needSort: boolean ソートが必要か default: false
     * @return Promise<Channel[]>
     */
    public async findChannleTypes(types: apid.ChannelType[], needSort: boolean = false): Promise<Channel[]> {
        const connection = await this.op.getConnection();

        const queryOption: FindOptionsWhere<Channel>[] = [];
        for (const type of types) {
            queryOption.push({
                channelType: type,
            });
        }

        const repository = connection
            .getRepository(Channel)
            .createQueryBuilder('channel')
            .where(queryOption)
            .orderBy(
                'CASE WHEN channel.remoteControlKeyId IS NULL THEN 1 ELSE 0 END, channel.remoteControlKeyId',
                'ASC',
            )
            .addOrderBy('channel.id', 'ASC');

        const result = await this.promieRetry.run(() => {
            return repository.getMany();
        });

        return needSort === true ? this.sortChannels(result) : result;
    }

    /**
     * 全件取得
     * @param needSort: boolean ソートが必要か default: false
     * @return Promise<Channel[]>
     */
    public async findAll(needSort: boolean = false): Promise<Channel[]> {
        let connection;
        try {
            connection = await this.op.getConnection();
        } catch (connectionError) {
            this.log.system.error('Failed to get database connection', connectionError);
            throw new Error('Database connection error');
        }

        const queryBuilder = connection
            .getRepository(Channel)
            .createQueryBuilder('channel')
            .orderBy(
                'CASE WHEN channel.remoteControlKeyId IS NULL THEN 1 ELSE 0 END, channel.remoteControlKeyId',
                'ASC',
            )
            .addOrderBy('channel.id', 'ASC');

        let result: Channel[];
        try {
            result = await this.promieRetry.run(() => {
                return queryBuilder.getMany();
            });
        } catch (queryError) {
            this.log.system.error('Failed to execute query', queryError);
            throw new Error('Query execution error');
        }

        try {
            return needSort === true ? this.sortChannels(result) : result;
        } catch (sortError) {
            this.log.system.error('Failed to sort channels', sortError);
            throw new Error('Sorting error');
        }
    }

    /**
     * Channel[] を config.yml に従ってソートして返す
     * @return Channel[]
     */
    private sortChannels(channels: Channel[]): Channel[] {
        const config = this.configuration.getConfig();

        let order: number[] = [];
        let key: string;
        if (typeof config.channelOrder !== 'undefined') {
            order = config.channelOrder;
            key = 'id';
        } else if (typeof config.sidOrder !== 'undefined') {
            order = config.sidOrder;
            key = 'serviceId';
        } else {
            return channels;
        }

        let cnt = 0;
        order.forEach(id => {
            const i = channels.findIndex(c => {
                return (c as any)[key] === id;
            });

            if (i === -1) {
                return;
            }

            const [channel] = channels.splice(i, 1);
            channels.splice(cnt, 0, channel);
            cnt += 1;
        });

        return channels;
    }
}
