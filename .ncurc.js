module.exports = {
    upgrade: true,
    reject: [
        // FIXME: v4.x.x throws if not maxRetriesPerRequest: null, enableReadyCheck: false
        // https://github.com/OptimalBits/bull/blob/develop/CHANGELOG.md#breaking-changes
        'bull'
    ]
};
