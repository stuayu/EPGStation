export default interface IConnectionCheckModel {
    checkMirakurun(): Promise<boolean>;
    checkDB(): Promise<void>;
}
