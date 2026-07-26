export default interface ISecretCrypto {
    encrypt(value: string): string;
    decrypt(value: string): string;
    isEncrypted(value: string): boolean;
    mask(value: string): string;
}
