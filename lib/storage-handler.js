'use strict';


class StorageHandler {
    constructor(options) {
        this.driverName = options.config.default;
        const SelectedDriver =  require(`./storage/${this.driverName}`);
        this.driver = new SelectedDriver(options);
    }

    async add(user, options) {
        return this.driver.add(user, options);
    }

    async get(user, file) {
        return this.driver.get(user, file);
    }

    async delete(user, file) {
        return this.driver.delete(user, file);
    }
}

module.exports = StorageHandler;
