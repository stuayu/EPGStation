export const createTimeSpecificationSearchOption = (option, convertTimepickerStrToNum, convertWeekToRuleWeek) => {
    if (option.keyword === null || option.channels.length === 0 || option.times.length === 0) {
        throw new Error('TimeReserveOptionIsInvalidValue');
    }
    const times = option.times.map(time => {
        if (time.startTime === null || time.endTime === null) throw new Error('TimeReserveOptionIsInvalidValue');
        const start = convertTimepickerStrToNum(time.startTime) / 60;
        const end = convertTimepickerStrToNum(time.endTime) / 60;
        const range = end >= start ? end - start : 24 * 60 - start + end;
        return {
            start: Math.floor(start / 60) * 3600,
            startMinute: start % 60,
            range: Math.floor(range / 60) * 3600,
            rangeMinute: range % 60,
            week: convertWeekToRuleWeek(time.week),
        };
    });
    return { keyword: option.keyword, channelIds: option.channels.slice(), times };
};

export const createTimeReserveOption = (searchOption, convertMinutesToTimepickerStr, convertRuleWeekToWeek) => {
    if (typeof searchOption.keyword === 'undefined') throw new Error('keywordIsUndefined');
    if (!searchOption.channelIds || searchOption.channelIds.length === 0) throw new Error('channelIdsIsUndefined');
    if (!searchOption.times || searchOption.times.length === 0) throw new Error('timesIsUndefined');
    const times = searchOption.times.map(time => {
        if (typeof time.start === 'undefined' || typeof time.range === 'undefined') throw new Error('TimeOptionError');
        const startMinutes = Math.floor(time.start / 3600) * 60 + (time.startMinute ?? Math.floor((time.start % 3600) / 60));
        const rangeMinutes = Math.floor(time.range / 3600) * 60 + (time.rangeMinute ?? Math.floor((time.range % 3600) / 60));
        return {
            startTime: convertMinutesToTimepickerStr(startMinutes),
            endTime: convertMinutesToTimepickerStr(startMinutes + rangeMinutes),
            week: convertRuleWeekToWeek(time.week),
        };
    });
    return { keyword: searchOption.keyword, channels: searchOption.channelIds.slice(), times };
};

export const getRuleOptionMode = isTimeSpecification => (isTimeSpecification ? 'time' : 'search');
