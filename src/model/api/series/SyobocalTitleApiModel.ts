import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import ISyobocalTitleDictionary, {
    SyobocalTitleDictionaryStatus,
    SyobocalTitleSyncResult,
} from '../../metadata/syobocal/ISyobocalTitleDictionary';
import ISyobocalTitleApiModel from './ISyobocalTitleApiModel';

/**
 * しょぼいカレンダー アニメ作品タイトル辞書の状態取得・手動同期 API
 */
@injectable()
export default class SyobocalTitleApiModel implements ISyobocalTitleApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISyobocalTitleDictionary') private dictionary: ISyobocalTitleDictionary,
    ) {}

    public async getStatus(): Promise<SyobocalTitleDictionaryStatus> {
        this.enabled();
        return await this.dictionary.getStatus();
    }

    public async sync(full: boolean): Promise<SyobocalTitleSyncResult> {
        this.enabled();
        return await this.dictionary.sync({ full });
    }

    private enabled(): void {
        if (isFeatureEnabled(this.config.getConfig(), 'metadataProviders') === false) {
            throw new Error('MetadataProvidersFeatureIsDisabled');
        }
    }
}
