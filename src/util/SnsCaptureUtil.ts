/**
 * SNS 添付パネルがキャプチャを引き取るべきか判定する。
 * @param isSidePanelOpen 右パネルが開いているか
 * @param selectedTab 選択中の右パネルタブ
 * @return boolean
 */
export const shouldClaimSnsCapture = (isSidePanelOpen: boolean, selectedTab: string): boolean =>
    isSidePanelOpen && selectedTab === 'sns';
