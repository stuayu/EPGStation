export function createTimeSpecificationSearchOption(option: any, convertTimepickerStrToNum: (value: string) => number, convertWeekToRuleWeek: (week: any) => number): any;
export function createTimeReserveOption(searchOption: any, convertMinutesToTimepickerStr: (minutes: number) => string, convertRuleWeekToWeek: (week: number) => any): any;
export function getRuleOptionMode(isTimeSpecification: boolean): 'time' | 'search';
