/** BML が video / canvas 要素の移動時に変更する inline style。 */
export const BML_INLINE_STYLE_PROPERTIES = [
    'width',
    'height',
    'transform',
    'transformOrigin',
    'display',
    'visibility',
] as const;

export interface InlineStyledElement {
    style: Pick<CSSStyleDeclaration, (typeof BML_INLINE_STYLE_PROPERTIES)[number]>;
}

export type InlineStyleSnapshot = Map<
    InlineStyledElement,
    Partial<Record<(typeof BML_INLINE_STYLE_PROPERTIES)[number], string>>
>;

/** 指定要素の BML 対象 style 値を保存する。
 * @param elements 保存対象
 * @return 対象プロパティのスナップショット
 */
export const captureInlineStyles = (elements: InlineStyledElement[]): InlineStyleSnapshot =>
    new Map(
        elements.map(element => [
            element,
            Object.fromEntries(BML_INLINE_STYLE_PROPERTIES.map(property => [property, element.style[property]])),
        ]),
    );

/** 移動前の値を復元し、移動中に増えた子要素の対象 style は解除する。
 * @param snapshot 移動前スナップショット
 * @return void
 */
export const restoreInlineStyles = (
    snapshot: InlineStyleSnapshot,
    currentElements: InlineStyledElement[] = [],
): void => {
    for (const [element, styles] of snapshot) {
        for (const property of BML_INLINE_STYLE_PROPERTIES) element.style[property] = styles[property] ?? '';
    }
    for (const element of currentElements) {
        if (snapshot.has(element)) continue;
        for (const property of BML_INLINE_STYLE_PROPERTIES) element.style[property] = '';
    }
};
