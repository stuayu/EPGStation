/** mediaElement と video の間にある要素を含め、サイズを合わせる対象を返す。 */
export interface BmlVideoElementNode {
    parentElement: BmlVideoElementNode | null;
}

/** video から mediaElement までの祖先をたどり、video とラッパーを返す。
 * @param mediaElement BML 側へ移動する映像コンテナ
 * @param videoElement 対象 video
 * @return サイズ調整する video とラッパー。video が配下に無い場合は空配列
 */
export const getBmlVideoResizeElements = (
    mediaElement: BmlVideoElementNode,
    videoElement: BmlVideoElementNode,
): BmlVideoElementNode[] => {
    const elements: BmlVideoElementNode[] = [];
    let current: BmlVideoElementNode | null = videoElement;
    while (current !== null && current !== mediaElement) {
        elements.push(current);
        current = current.parentElement;
    }
    return current === mediaElement ? elements.reverse() : [];
};
