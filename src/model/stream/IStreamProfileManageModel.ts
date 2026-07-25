import { StreamContainer, StreamProfile } from '../IConfigFile';

// resolveLegacyMode 用の対象スコープ
export type StreamProfileKind = 'live' | 'recordedTs' | 'recordedEncoded';

export default interface IStreamProfileManageModel {
    getProfile(id: string): StreamProfile | null;
    getLiveProfiles(): StreamProfile[];
    getRecordedProfiles(type: 'ts' | 'encoded'): StreamProfile[];
    resolveLegacyMode(kind: StreamProfileKind, container: StreamContainer, mode: number): StreamProfile | null;
}
