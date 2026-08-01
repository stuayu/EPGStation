import { BitSectionInfo } from './BitParser';

export default interface IBroadcastAffiliationCollector {
    collect(sections: BitSectionInfo[]): Promise<void>;
}
