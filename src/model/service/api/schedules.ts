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
            NW21: req.query.NW21 as any,
            NW22: req.query.NW22 as any,
            NW23: req.query.NW23 as any,
            NW24: req.query.NW24 as any,
            NW25: req.query.NW25 as any,
            NW26: req.query.NW26 as any,
            NW27: req.query.NW27 as any,
            NW28: req.query.NW28 as any,
            NW29: req.query.NW29 as any,
            NW30: req.query.NW30 as any,
            NW31: req.query.NW31 as any,
            NW32: req.query.NW32 as any,
            NW33: req.query.NW33 as any,
            NW34: req.query.NW34 as any,
            NW35: req.query.NW35 as any,
            NW36: req.query.NW36 as any,
            NW37: req.query.NW37 as any,
            NW38: req.query.NW38 as any,
            NW39: req.query.NW39 as any,
            NW40: req.query.NW40 as any,
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
        {
            $ref: '#/components/parameters/requiredNW21',
        },
        {
            $ref: '#/components/parameters/requiredNW22',
        },
        {
            $ref: '#/components/parameters/requiredNW23',
        },
        {
            $ref: '#/components/parameters/requiredNW24',
        },
        {
            $ref: '#/components/parameters/requiredNW25',
        },
        {
            $ref: '#/components/parameters/requiredNW26',
        },
        {
            $ref: '#/components/parameters/requiredNW27',
        },
        {
            $ref: '#/components/parameters/requiredNW28',
        },
        {
            $ref: '#/components/parameters/requiredNW29',
        },
        {
            $ref: '#/components/parameters/requiredNW30',
        },
        {
            $ref: '#/components/parameters/requiredNW31',
        },
        {
            $ref: '#/components/parameters/requiredNW32',
        },
        {
            $ref: '#/components/parameters/requiredNW33',
        },
        {
            $ref: '#/components/parameters/requiredNW34',
        },
        {
            $ref: '#/components/parameters/requiredNW35',
        },
        {
            $ref: '#/components/parameters/requiredNW36',
        },
        {
            $ref: '#/components/parameters/requiredNW37',
        },
        {
            $ref: '#/components/parameters/requiredNW38',
        },
        {
            $ref: '#/components/parameters/requiredNW39',
        },
        {
            $ref: '#/components/parameters/requiredNW40',
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
