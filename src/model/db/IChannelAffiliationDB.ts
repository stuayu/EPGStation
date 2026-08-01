import ChannelAffiliation from '../../db/entities/ChannelAffiliation';

export default interface IChannelAffiliationDB {
    findAll(): Promise<ChannelAffiliation[]>;
    replace(networkId: number, affiliationIds: number[]): Promise<boolean>;
}
