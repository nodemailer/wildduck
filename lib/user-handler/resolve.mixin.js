'use strict';
const tools = require('../tools');
const consts = require('../consts');

const AddrResolveMixin = superclass => class extends superclass {

    _checkAlias(ctx, done) {
        ctx.done = done;
        this.users.collection('domainaliases').findOne(
            { alias: ctx.domain },
            {
                maxTimeMS: consts.DB_MAX_TIME_USERS
            },
            this._aliasMatchCB.bind(this, ctx)
        );
    }

    /**
     * Callback method for checking found alias domains.
     *
     * @see {@link _exactMatchCB}
     */
    _aliasDomainMatchCB(ctx, err, aliasData) {
        if (err) {
            return ctx.done(err);
        }
        if (!aliasData) {
            return ctx.done();
        }

        ctx.aliasDomain = aliasData.domain;
        this.users.collection('addresses').findOne(
            {
                addrview: ctx.username + '@' + ctx.aliasDomain
            },
            {
                projection: ctx.projection,
                maxTimeMS: consts.DB_MAX_TIME_USERS
            },
            ctx.done
        );
    }

    /**
     * Callback method for checking found alias addresses.
     *
     * @see {@link _exactMatchCB}
     */
    _aliasMatchCB(ctx, err, addressData) {
        if (err) {
            err.code = 'InternalDatabaseError';
            return ctx.callback(err);
        }

        if (addressData) {
            return ctx.callback(null, addressData);
        }

        if (!ctx.enableWildcard) {
            return ctx.callback(null, false);
        }

        let query = {
            addrview: '*@' + ctx.domain
        };

        if (ctx.aliasDomain) {
            // search for alias domain as well
            query.addrview = { $in: [query.addrview, '*@' + ctx.aliasDomain] };
        }

        // try to find a catch-all address
        this.users.collection('addresses').findOne(
            query,
            {
                projection: ctx.projection,
                maxTimeMS: consts.DB_MAX_TIME_USERS
            },
            this._wildcardMatchCB.bind(this, ctx)
        );
    }

    /**
     * Callback method for checking wildcard addresses (wildcard address
     * part).
     *
     * @see {@link _exactMatchCB}
     */
    _wildcardMatchCB(ctx, err, addressData) {
        if (err) {
            err.code = 'InternalDatabaseError';
            return ctx.callback(err);
        }

        if (addressData) {
            return ctx.callback(null, addressData);
        }

        // try to find a catch-all user (eg. "postmaster@*")
        this.users.collection('addresses').findOne(
            {
                addrview: ctx.username + '@*'
            },
            {
                projection: ctx.projection,
                maxTimeMS: consts.DB_MAX_TIME_USERS
            },
            this._catchAllUserMatchCB.bind(this, ctx)
        );
    }

    /**
     * Callback method for checking catch all users (user with a wildcard
     * domain).
     *
     * @see {@link _exactMatchCB}
     */
    _catchAllUserMatchCB(ctx, err, addressData) {
        if (err) {
            err.code = 'InternalDatabaseError';
            return ctx.callback(err);
        }

        if (!addressData) {
            return ctx.callback(null, false);
        }

        return ctx.callback(null, addressData);
    }

    /**
     * Callback method for checking exact (i.e. only normalized but not
     * further edited) address matches in the database.
     *
     * @param {Object} The ctx object contains:
     *                   - username: the username part of the address
     *                   - domain: the domain part of the address
     *                   - address: the whole addres
     *                   - projection: the projection fields
     * @see {@link http://mongodb.github.io/node-mongodb-native/3.1/api/Collection.html#~resultCallback}
     */
    _exactMatchCB(ctx, err, addressData) {
        if (err) {
            err.code = 'InternalDatabaseError';
            return ctx.callback(err);
        }

        if (addressData) {
            return ctx.callback(null, addressData);
        }

        this._checkAlias.bind(this, ctx)(this._aliasMatchCB.bind(this, ctx));
    }

    /**
     * Resolve the requested 'to' address.
     */
    resolveAddress(address, options, callback) {
        const ctx = { callback }
        options = options || {}
        ctx.enableWildcard = !!options.wildcard

        ctx.address = tools.normalizeAddress(address, false, {
            removeLabel: true,
            removeDots: true
        })

        let _posOfAtSign = ctx.address.indexOf('@')
        ctx.username = ctx.address.substr(0, _posOfAtSign)
        ctx.domain = ctx.address.substr(_posOfAtSign + 1)

        ctx.projection = {
            user: true,
            targets: true
        }

        Object.assign(ctx.projection, options.projection || {})
        
        // try exact match
        this.users.collection('addresses').findOne(
            {
                addrview: ctx.address
            },
            {
                projection: ctx.projection,
                maxTimeMS: consts.DB_MAX_TIME_USERS
            },
            this._exactMatchCB.bind(this, ctx)
        );
    }
}

module.exports = AddrResolveMixin
