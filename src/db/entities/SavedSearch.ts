import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'saved_search' })
export default class SavedSearch extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'text',
    })
    public name!: string; // 保存検索名

    @Column({
        type: 'text',
    })
    public query!: string; // 検索条件 (JSON 文字列)

    @Column()
    public isPinned!: boolean; // ピン留めするか

    @Column({
        type: 'bigint',
    })
    public createdAt!: number;

    @Column({
        type: 'bigint',
    })
    public updatedAt!: number;
}
