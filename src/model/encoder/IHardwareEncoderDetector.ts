import { HardwareEncoderSetting } from '../IConfigFile';
import { StreamEncoderCapability } from '../../util/StreamArgsUtil';

export type HardwareEncoderId = Exclude<HardwareEncoderSetting, 'auto'>;
export type HardwareEncoderProvider = 'software' | 'ffmpeg' | 'qsvencc' | 'nvencc' | 'vceencc';

export interface HardwareEncoderInfo {
    id: HardwareEncoderId;
    provider: HardwareEncoderProvider;
    command?: string;
    codecs: Array<'h264' | 'hevc'>;
}

export interface HardwareEncoderDetectionResult {
    configured: HardwareEncoderSetting;
    selected: HardwareEncoderId;
    available: HardwareEncoderId[];
    encoders: HardwareEncoderInfo[];
}

export default interface IHardwareEncoderDetector {
    detect(): Promise<HardwareEncoderDetectionResult>;
    getResult(): HardwareEncoderDetectionResult;
    getStreamEncoder(codec: 'h264' | 'hevc'): StreamEncoderCapability;
    getAvailableIds(): HardwareEncoderId[];
}
