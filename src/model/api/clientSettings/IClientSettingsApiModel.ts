import * as apid from '../../../../api';

export default interface IClientSettingsApiModel {
    get(userId: number | null): Promise<apid.ClientSettingsResponse>;
    put(
        userId: number | null,
        settings: Record<string, unknown>,
        baseUpdatedAt: number,
    ): Promise<apid.ClientSettingsResponse>;
}
