import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type SnsAccountProvider = 'bluesky' | 'misskey';

/**
 * 視聴画面から SNS (Bluesky / Misskey) へ投稿するための連携アカウント。
 * ログインユーザーごとに分離する (`userId`)。認証無効時・匿名アクセス時は
 * `userId = null` の共有枠にフォールバックする
 */
@Entity({ name: 'sns_account' })
@Index('IDX_sns_account_user', ['userId'])
@Index('IDX_sns_account_unique', ['provider', 'userId', 'remoteUserId', 'instanceUrl'], { unique: true })
export default class SnsAccount extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    // 'bluesky' | 'misskey'
    @Column({ type: 'varchar', length: 16 }) provider!: SnsAccountProvider;
    // ログインユーザー。匿名・認証無効時は null (共有枠)
    @Column({ type: 'integer', nullable: true }) userId!: number | null;
    // Bluesky: DID / Misskey: Misskey 側の user id
    @Column({ type: 'varchar', length: 191 }) remoteUserId!: string;
    // Misskey のホスト名 (misskey.io) / Bluesky は PDS ホスト
    @Column({ type: 'varchar', length: 191, nullable: true }) instanceUrl!: string | null;
    // 表示用ハンドル
    @Column({ type: 'text' }) handle!: string;
    // 表示名
    @Column({ type: 'text' }) displayName!: string;
    @Column({ type: 'text', nullable: true }) avatarUrl!: string | null;
    // 暗号化された JSON 文字列 (ISecretCrypto.encrypt() 済み)
    @Column({ type: 'text' }) credential!: string;
    // トークン発行 (MiAuth 完了) 時点で要求した権限一覧 (JSON 文字列の配列)。
    // MiAuth は発行時の permission がトークンに固定されるため、後から要求権限を増やしても
    // 既存トークンには反映されない。現在の要求権限と比較して再連携が必要かを判定するために保持する。
    // Bluesky は概念が無いため null
    @Column({ type: 'text', nullable: true }) grantedPermissions!: string | null;
    // Misskey: 'public' | 'home' | 'followers' | 'specified'
    @Column({ type: 'varchar', length: 16, nullable: true }) defaultVisibility!: string | null;
    // Misskey のチャンネル投稿先
    @Column({ type: 'varchar', length: 191, nullable: true }) defaultChannelId!: string | null;
    @Column({ type: 'text', nullable: true }) defaultChannelName!: string | null;
    @Column({ type: 'boolean', default: false }) isDefaultLocalOnly: boolean = false;
    @Column({ type: 'bigint' }) createdAt!: number;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
