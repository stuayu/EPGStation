export default interface ISecretCrypto {
    /**
     * 用途ごとに分けた署名鍵を鍵ファイルから導出する (セッション Cookie の署名などに使う)。
     * 鍵ファイルが無い / 読めない場合は null
     * @param purpose: string 用途を表す文字列 (異なる用途で同じ鍵を使い回さないための分離子)
     * @return string | null
     */
    getSigningKey(purpose: string): string | null;
    encrypt(value: string): string;
    decrypt(value: string): string;
    isEncrypted(value: string): boolean;
    mask(value: string): string;
}
