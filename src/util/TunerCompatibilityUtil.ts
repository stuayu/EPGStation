namespace TunerCompatibilityUtil {
    /** 予約の放送波が GR または NW1〜NW40 か返す */
    export const isGroundChannelType = (channelType: string): boolean => {
        return channelType === 'GR' || /^NW(?:[1-9]|[1-3]\d|40)$/.test(channelType);
    };
    /**
     * チューナーが予約の放送波を受信できるか返す
     * @param tunerTypes: チューナーが報告した放送波
     * @param channelType: 予約の放送波
     * @return boolean
     */
    export const isTunerCompatibleWithChannelType = (tunerTypes: string[], channelType: string): boolean => {
        return (
            tunerTypes.includes(channelType) ||
            (tunerTypes.includes('GR') && /^NW(?:[1-9]|[1-3]\d|40)$/.test(channelType))
        );
    };
}

export default TunerCompatibilityUtil;
