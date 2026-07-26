import { inject, injectable } from 'inversify';
import ProgramSeriesLink from '../../db/entities/ProgramSeriesLink';
import IDBOperator from './IDBOperator';
import IProgramSeriesDB, { SaveProgramSeriesLink } from './IProgramSeriesDB';
@injectable()
export default class ProgramSeriesDB implements IProgramSeriesDB {
    constructor(@inject('IDBOperator') private op: IDBOperator) {}
    public async get(programId: number): Promise<ProgramSeriesLink | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(ProgramSeriesLink).findOne({ where: { programId } });
    }
    public async save(value: SaveProgramSeriesLink): Promise<ProgramSeriesLink> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(ProgramSeriesLink);
        const current = await repo.findOne({ where: { programId: value.programId } });
        return await repo.save(repo.create({ ...current, ...value }));
    }
}
