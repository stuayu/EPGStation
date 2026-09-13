'use strict';

const result = (name, passed, metrics = {}, reason = null) => {
    const value = { scenario: name, passed, ...metrics, ...(reason === null ? {} : { reason }) };
    console.log(`RESULT ${name} ${passed ? 'PASS' : 'FAIL'} ${JSON.stringify(value)}`);
    return value;
};

module.exports = { result };
