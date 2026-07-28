import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Web UI のログインユーザー。
 * config.yml の `auth.enabled` が true のときのみ使われる。
 * パスワードは scrypt でソルト付きハッシュにして保存し、平文は一切保持しない
 */
@Entity({ name: 'user' })
@Index('IDX_user_name', ['name'], { unique: true })
export default class User extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'varchar', length: 191 }) name!: string;
    // 'scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>' 形式。将来アルゴリズムを差し替えられるよう自己記述的にする。
    // SSO だけで作られたユーザーはパスワードを持たないため空文字になる
    @Column({ type: 'text', default: '' }) passwordHash!: string;
    // 'admin': システム管理者 (設定変更・ユーザー管理が可能) / 'user': 一般
    @Column({ type: 'varchar', length: 16, default: 'user' }) role: string = 'user';
    // パスワード変更時に加算し、発行済みセッションを一括で無効にする
    @Column({ type: 'integer', default: 1 }) tokenVersion: number = 1;
    @Column({ type: 'bigint' }) createdAt!: number;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
