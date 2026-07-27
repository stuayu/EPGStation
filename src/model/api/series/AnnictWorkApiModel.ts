import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IAnnictWorkDictionary, {
    AnnictWorkDictionaryStatus,
    AnnictWorkSyncResult,
} from '../../metadata/annict/IAnnictWorkDictionary';
import IAnnictWorkApiModel from './IAnnictWorkApiModel';

/**
 * Annict 作品辞書の状態取得・手動同期 API
 */
@injectable()
export default class AnnictWorkApiModel implements IAnnictWorkApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IAnnictWorkDictionary') private dictionary: IAnnictWorkDictionary,
    ) {}

    public async getStatus(): Promise<AnnictWorkDictionaryStatus> {
        this.enabled();
        return await this.dictionary.getStatus();
    }

    public async sync(): Promise<AnnictWorkSyncResult> {
        this.enabled();
        return await this.dictionary.sync();
    }

    private enabled(): void {
        if (isFeatureEnabled(this.config.getConfig(), 'metadataProviders') === false) {
            throw new Error('MetadataProvidersFeatureIsDisabled');
        }
    }
}
