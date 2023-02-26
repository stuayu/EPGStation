import { Operation } from 'express-openapi';
import * as apid from '../../../../api';
import IScheduleApiModel from '../../api/schedule/IScheduleApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    const scheduleApiModel = container.get<IScheduleApiModel>('IScheduleApiModel');

    try {
        const option: apid.ScheduleOption = {
            startAt: parseInt(req.query.startAt as any, 10),
            endAt: parseInt(req.query.endAt as any, 10),
            isHalfWidth: req.query.isHalfWidth as any,
            needsRawExtended: req.query.needsRawExtended as any,
            GR: req.query.GR as any,
            BS: req.query.BS as any,
            CS: req.query.CS as any,
            SKY: req.query.SKY as any,
            NW1: req.query.NW1 as any,
            NW2: req.query.NW2 as any,
            NW3: req.query.NW3 as any,
            NW4: req.query.NW4 as any,
            NW5: req.query.NW5 as any,
            NW6: req.query.NW6 as any,
            NW7: req.query.NW7 as any,
            NW8: req.query.NW8 as any,
            NW9: req.query.NW9 as any,
            NW10: req.query.NW10 as any,
            NW11: req.query.NW11 as any,
            NW12: req.query.NW12 as any,
            NW13: req.query.NW13 as any,
            NW14: req.query.NW14 as any,
            NW15: req.query.NW15 as any,
            NW16: req.query.NW16 as any,
            NW17: req.query.NW17 as any,
            NW18: req.query.NW18 as any,
            NW19: req.query.NW19 as any,
            NW20: req.query.NW20 as any,
        };
        if (typeof req.query.isFree === 'boolean') {
            option.isFree = req.query.isFree;
        }
        api.responseJSON(res, 200, await scheduleApiModel.getSchedules(option));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '番組表情報取得',
    tags: ['schedules'],
    description: '番組表情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/StartAt',
        },
        {
            $ref: '#/components/parameters/EndAt',
        },
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
        {
            $ref: '#/components/parameters/NeedsRawExtended',
        },
        {
            $ref: '#/components/parameters/IsFreeProgram',
        },
        {
            $ref: '#/components/parameters/requiredGR',
        },
        {
            $ref: '#/components/parameters/requiredBS',
        },
        {
            $ref: '#/components/parameters/requiredCS',
        },
        {
            $ref: '#/components/parameters/requiredSKY',
        },
        {
            $ref: '#/components/parameters/requiredNW1',
        },
        {
            $ref: '#/components/parameters/requiredNW2',
        },
        {
            $ref: '#/components/parameters/requiredNW3',
        },
        {
            $ref: '#/components/parameters/requiredNW4',
        },
        {
            $ref: '#/components/parameters/requiredNW5',
        },
        {
            $ref: '#/components/parameters/requiredNW6',
        },
        {
            $ref: '#/components/parameters/requiredNW7',
        },
        {
            $ref: '#/components/parameters/requiredNW8',
        },
        {
            $ref: '#/components/parameters/requiredNW9',
        },
        {
            $ref: '#/components/parameters/requiredNW10',
        },
        {
            $ref: '#/components/parameters/requiredNW11',
        },
        {
            $ref: '#/components/parameters/requiredNW12',
        },
        {
            $ref: '#/components/parameters/requiredNW13',
        },
        {
            $ref: '#/components/parameters/requiredNW14',
        },
        {
            $ref: '#/components/parameters/requiredNW15',
        },
        {
            $ref: '#/components/parameters/requiredNW16',
        },
        {
            $ref: '#/components/parameters/requiredNW17',
        },
        {
            $ref: '#/components/parameters/requiredNW18',
        },
        {
            $ref: '#/components/parameters/requiredNW19',
        },
        {
            $ref: '#/components/parameters/requiredNW20',
        },
    ],
    responses: {
        200: {
            description: '番組表情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Schedules',
                    },
                },
            },
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};
