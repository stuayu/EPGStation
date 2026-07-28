import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 外部 ID プロバイダ (Google / GitHub) とログインユーザーの紐付け。
 * 1 ユーザーが複数のプロバイダを紐付けられるよう user とは別テーブルにする
 */
@Entity({ name: 'user_identity' })
@Index('IDX_user_identity_provider', ['provider', 'providerUserId'], { unique: true })
@Index('IDX_user_identity_user', ['userId'])
export default class UserIdentity extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'integer' }) userId!: number;
    // 'google' | 'github'
    @Column({ type: 'varchar', length: 32 }) provider!: string;
    // プロバイダ側のユーザー ID (メールアドレスは変わりうるので ID を主キーにする)
    @Column({ type: 'varchar', length: 191 }) providerUserId!: string;
    // 表示用。変わることがあるのでログイン時に更新する
    @Column({ type: 'text', nullable: true }) email!: string | null;
    @Column({ type: 'bigint' }) createdAt!: number;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
