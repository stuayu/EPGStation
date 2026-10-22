export type BmlVideoMoveAction = 'none' | 'moveToBml' | 'moveToDPlayer';

/** 現在の BML 文書と映像要素の状態から必要な移動を決める。 */
export const getBmlVideoMoveAction = (
    isMovedToBml: boolean,
    currentVideoElementContainsMedia: boolean,
    hasCurrentVideoElement: boolean,
): BmlVideoMoveAction => {
    if (hasCurrentVideoElement === false) return isMovedToBml === true ? 'moveToDPlayer' : 'none';
    if (currentVideoElementContainsMedia === true) return 'none';
    return 'moveToBml';
};
