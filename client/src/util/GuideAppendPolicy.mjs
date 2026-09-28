export const resolveSingleStationAppend = ({ startAt, days, added }) => {
    if (added <= 0) return null;
    return { endAt: startAt + days * 24 * 60 * 60 * 1000, timeLength: 24 };
};
