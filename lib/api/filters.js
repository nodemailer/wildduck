'use strict';

const log = require('npmlog');
const Joi = require('joi');
const ObjectId = require('mongodb').ObjectId;
const MongoPaging = require('mongo-cursor-pagination');
const urllib = require('url');
const tools = require('../tools');
const roles = require('../roles');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema, booleanSchema } = require('../schemas');
const { publish, FILTER_DELETED, FILTER_CREATED, FORWARD_ADDED } = require('../events');

module.exports = (db, server, userHandler) => {
    server.get(
        { name: 'filters', path: '/filters' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                forward: Joi.string().trim().empty('').max(255),
                limit: Joi.number().default(20).min(1).max(250),
                next: nextPageCursorSchema,
                previous: previousPageCursorSchema,
                page: pageNrSchema,
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true,
                allowUnknown: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            let permission;
            let ownOnly = false;
            permission = roles.can(req.role).readAny('filters');
            if (!permission.granted && req.user && ObjectId.isValid(req.user)) {
                permission = roles.can(req.role).readOwn('filters');
                if (permission.granted) {
                    ownOnly = true;
                }
            }
            // permissions check
            req.validate(permission);

            let query = result.value.query;
            let forward = result.value.forward;
            let limit = result.value.limit;
            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;

            let filter = {};

            if (forward) {
                filter['action.targets.value'] = {
                    $regex: tools.escapeRegexStr(forward),
                    $options: ''
                };
            }

            if (ownOnly) {
                filter.user = new ObjectId(req.user);
            }

            let total = await db.database.collection('filters').countDocuments(filter);
            let opts = {
                limit,
                query: filter,
                paginatedField: '_id',
                sortAscending: true
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.database.collection('filters'), opts);
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!listing.hasPrevious) {
                page = 1;
            }

            let mailboxList = Array.from(
                new Set(
                    (listing.results || [])
                        .map(filterData => {
                            if (filterData.action && filterData.action.mailbox) {
                                return filterData.action.mailbox.toString();
                            }
                            return false;
                        })
                        .filter(mailbox => mailbox)
                )
            ).map(mailbox => new ObjectId(mailbox));

            let mailboxes = [];
            if (mailboxList.length) {
                try {
                    mailboxes = await db.database
                        .collection('mailboxes')
                        .find({
                            _id: { $in: mailboxList }
                        })
                        .project({ _id: 1, path: 1 })
                        .sort({ _id: 1 })
                        .toArray();
                } catch (err) {
                    res.status(500);
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }
            }

            let response = {
                success: true,
                query,
                total,
                page,
                previousCursor: listing.hasPrevious ? listing.previous : false,
                nextCursor: listing.hasNext ? listing.next : false,
                results: (listing.results || []).map(filterData => {
                    let descriptions = getFilterStrings(filterData, mailboxes);

                    return {
                        id: filterData._id.toString(),
                        user: filterData.user.toString(),
                        name: filterData.name,
                        query: descriptions.query,
                        action: descriptions.action,
                        disabled: !!filterData.disabled,
                        created: filterData.created,
                        targets: filterData.action && filterData.action.targets && filterData.action.targets.map(t => t.value)
                    };
                })
            };

            res.json(response);
            return next();
        })
    );

    server.get(
        '/users/:user/filters',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('filters'));
            } else {
                req.validate(roles.can(req.role).readAny('filters'));
            }

            let user = new ObjectId(result.value.user);

            let userData;
            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            address: true
                        }
                    }
                );
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            let mailboxes;
            try {
                mailboxes = await db.database
                    .collection('mailboxes')
                    .find({
                        user
                    })
                    .project({ _id: 1, path: 1 })
                    .sort({ _id: 1 })
                    .toArray();
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!mailboxes) {
                mailboxes = [];
            }

            let filters;
            try {
                filters = await db.database
                    .collection('filters')
                    .find({
                        user
                    })
                    .sort({
                        _id: 1
                    })
                    .toArray();
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!filters) {
                filters = [];
            }

            res.json({
                success: true,

                results: filters.map(filterData => {
                    let descriptions = getFilterStrings(filterData, mailboxes);

                    return {
                        id: filterData._id.toString(),
                        name: filterData.name,
                        query: descriptions.query,
                        action: descriptions.action,
                        disabled: !!filterData.disabled,
                        created: filterData.created
                    };
                })
            });

            return next();
        })
    );

    server.get(
        '/users/:user/filters/:filter',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                filter: Joi.string().hex().lowercase().length(24).required(),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('filters'));
            } else {
                req.validate(roles.can(req.role).readAny('filters'));
            }

            let user = new ObjectId(result.value.user);
            let filter = new ObjectId(result.value.filter);

            let filterData;
            try {
                filterData = await db.database.collection('filters').findOne({
                    _id: filter,
                    user
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!filterData) {
                res.status(404);
                res.json({
                    error: 'This filter does not exist',
                    code: 'FilterNotFound'
                });
                return next();
            }

            let mailboxes;
            try {
                mailboxes = await db.database
                    .collection('mailboxes')
                    .find({
                        user
                    })
                    .project({ _id: 1, path: 1 })
                    .sort({ _id: 1 })
                    .toArray();
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!mailboxes) {
                mailboxes = [];
            }

            let response = {
                success: true,
                id: filterData._id.toString(),
                name: filterData.name,
                query: {},
                action: {},
                disabled: !!filterData.disabled,
                created: filterData.created
            };

            Object.keys((filterData.query && filterData.query.headers) || {}).forEach(key => {
                response.query[key] = filterData.query.headers[key];
            });

            Object.keys(filterData.query || {}).forEach(key => {
                if (key !== 'headers') {
                    response.query[key] = filterData.query[key];
                }
            });

            Object.keys(filterData.action || {}).forEach(key => {
                if (key === 'targets') {
                    response.action.targets = filterData.action.targets.map(target => target.value);
                    return;
                }
                response.action[key] = filterData.action[key];
            });

            res.json(response);

            return next();
        })
    );

    server.del(
        '/users/:user/filters/:filter',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                filter: Joi.string().hex().lowercase().length(24).required(),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).deleteOwn('filters'));
            } else {
                req.validate(roles.can(req.role).deleteAny('filters'));
            }

            let user = new ObjectId(result.value.user);
            let filter = new ObjectId(result.value.filter);

            let r;

            try {
                r = await db.database.collection('filters').deleteOne({
                    _id: filter,
                    user
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!r.deletedCount) {
                res.status(404);
                res.json({
                    error: 'Filter was not found',
                    code: 'FilterNotFound'
                });
                return next();
            }

            await publish(db.redis, {
                ev: FILTER_DELETED,
                user,
                filter
            });

            res.json({
                success: true
            });
            return next();
        })
    );

    server.post(
        '/users/:user/filters',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),

                name: Joi.string().trim().max(255).empty(''),

                query: Joi.object()
                    .keys({
                        from: Joi.string().trim().max(255).empty(''),
                        to: Joi.string().trim().max(255).empty(''),
                        subject: Joi.string().trim().max(255).empty(''),
                        listId: Joi.string().trim().max(255).empty(''),
                        text: Joi.string().trim().max(255).empty(''),
                        ha: booleanSchema,
                        size: Joi.number().empty('')
                    })
                    .default({}),
                action: Joi.object()
                    .keys({
                        seen: booleanSchema,
                        flag: booleanSchema,
                        delete: booleanSchema,
                        spam: booleanSchema,
                        mailbox: Joi.string().hex().lowercase().length(24).empty(''),
                        targets: Joi.array()
                            .items(
                                Joi.string().email({ tlds: false }),
                                Joi.string().uri({
                                    scheme: [/smtps?/, /https?/],
                                    allowRelative: false,
                                    relativeOnly: false
                                })
                            )
                            .empty('')
                    })
                    .default({}),

                disabled: booleanSchema.default(false),

                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).createOwn('filters'));
            } else {
                req.validate(roles.can(req.role).createAny('filters'));
            }

            let values = result.value;

            let user = new ObjectId(values.user);
            let filterData = {
                _id: new ObjectId(),
                user,
                query: {
                    headers: {}
                },
                action: {},
                disabled: values.disabled,
                created: new Date()
            };

            if (values.name) {
                filterData.name = values.name;
            }

            ['from', 'to', 'subject', 'listId'].forEach(key => {
                if (values.query[key]) {
                    filterData.query.headers[key] = values.query[key].replace(/\s+/g, ' ');
                }
            });

            if (values.query.text) {
                filterData.query.text = values.query.text.replace(/\s+/g, ' ');
            }

            if (typeof values.query.ha === 'boolean') {
                filterData.query.ha = values.query.ha;
            }

            if (values.query.size) {
                filterData.query.size = values.query.size;
            }

            ['seen', 'flag', 'delete', 'spam'].forEach(key => {
                if (typeof values.action[key] === 'boolean') {
                    filterData.action[key] = values.action[key];
                }
            });

            let targets = values.action.targets;
            if (targets) {
                for (let i = 0, len = targets.length; i < len; i++) {
                    let target = targets[i];
                    if (!/^smtps?:/i.test(target) && !/^https?:/i.test(target) && target.indexOf('@') >= 0) {
                        // email
                        targets[i] = {
                            id: new ObjectId(),
                            type: 'mail',
                            value: target
                        };
                    } else if (/^smtps?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectId(),
                            type: 'relay',
                            value: target
                        };
                    } else if (/^https?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectId(),
                            type: 'http',
                            value: target
                        };
                    } else {
                        res.status(400);
                        res.json({
                            error: 'Unknown target type "' + target + '"',
                            code: 'InputValidationError'
                        });
                        return next();
                    }
                }

                filterData.action.targets = targets;
            }

            if (values.action.mailbox) {
                let mailboxData;
                try {
                    mailboxData = await db.database.collection('mailboxes').findOne({
                        _id: new ObjectId(values.action.mailbox),
                        user
                    });
                } catch (err) {
                    res.status(500);
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }

                if (!mailboxData) {
                    res.status(404);
                    res.json({
                        error: 'This mailbox does not exist',
                        code: 'NoSuchMailbox'
                    });
                    return next();
                }

                filterData.action.mailbox = mailboxData._id;
            }

            let userData;
            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            _id: true
                        }
                    }
                );
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            let r;
            try {
                r = await db.database.collection('filters').insertOne(filterData);
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (r.acknowledged) {
                await publish(db.redis, {
                    ev: FILTER_CREATED,
                    user,
                    filter: filterData._id
                });
            }

            if (targets) {
                for (let target of targets) {
                    // log as new redirect targets
                    try {
                        await userHandler.logAuthEvent(user, {
                            action: 'filter forward added',
                            result: 'success',
                            target: target.value,
                            filter: filterData._id,
                            protocol: 'API',
                            sess: values.sess,
                            ip: values.ip
                        });
                    } catch (err) {
                        log.error('API', err);
                    }

                    await publish(db.redis, {
                        ev: FORWARD_ADDED,
                        user,
                        type: 'filter',
                        filter: filterData._id,
                        target: target.value
                    });
                }
            }

            res.json({
                success: r.acknowledged,
                id: filterData._id.toString()
            });

            return next();
        })
    );

    server.put(
        '/users/:user/filters/:filter',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                filter: Joi.string().hex().lowercase().length(24).required(),

                name: Joi.string().trim().max(255).empty(''),

                query: Joi.object()
                    .keys({
                        from: Joi.string().trim().max(255).empty(''),
                        to: Joi.string().trim().max(255).empty(''),
                        subject: Joi.string().trim().max(255).empty(''),
                        listId: Joi.string().trim().max(255).empty(''),
                        text: Joi.string().trim().max(255).empty(''),
                        ha: booleanSchema,
                        size: Joi.number().empty('')
                    })
                    .default({}),
                action: Joi.object()
                    .keys({
                        seen: booleanSchema,
                        flag: booleanSchema,
                        delete: booleanSchema,
                        spam: booleanSchema,
                        mailbox: Joi.string().hex().lowercase().length(24).empty(''),
                        targets: Joi.array()
                            .items(
                                Joi.string().email({ tlds: false }),
                                Joi.string().uri({
                                    scheme: [/smtps?/, /https?/],
                                    allowRelative: false,
                                    relativeOnly: false
                                })
                            )
                            .empty('')
                    })
                    .default({}),

                disabled: booleanSchema,

                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).updateOwn('filters'));
            } else {
                req.validate(roles.can(req.role).updateAny('filters'));
            }

            let values = result.value;

            let user = new ObjectId(values.user);
            let filter = new ObjectId(values.filter);

            let $set = {};
            let $unset = {};

            let hasChanges = false;

            if (values.name) {
                $set.name = values.name;
                hasChanges = true;
            }

            if (typeof values.disabled === 'boolean') {
                $set.disabled = values.disabled;
                hasChanges = true;
            }

            if (req.params.query) {
                ['from', 'to', 'subject', 'listId'].forEach(key => {
                    if (values.query[key]) {
                        $set['query.headers.' + key] = values.query[key].replace(/\s+/g, ' ');
                        hasChanges = true;
                    } else if (key in req.params.query) {
                        // delete empty values
                        $unset['query.headers.' + key] = true;
                        hasChanges = true;
                    }
                });

                if (values.query.text) {
                    $set['query.text'] = values.query.text.replace(/\s+/g, ' ');
                    hasChanges = true;
                } else if ('text' in req.params.query) {
                    $unset['query.text'] = true;
                    hasChanges = true;
                }

                if (typeof values.query.ha === 'boolean') {
                    $set['query.ha'] = values.query.ha;
                    hasChanges = true;
                } else if ('ha' in req.params.query) {
                    $unset['query.ha'] = true;
                    hasChanges = true;
                }

                if (values.query.size) {
                    $set['query.size'] = values.query.size;
                    hasChanges = true;
                } else if ('size' in req.params.query) {
                    $unset['query.size'] = true;
                    hasChanges = true;
                }
            }

            let targets;

            if (req.params.action) {
                ['seen', 'flag', 'delete', 'spam'].forEach(key => {
                    if (typeof values.action[key] === 'boolean') {
                        $set['action.' + key] = values.action[key];
                        hasChanges = true;
                    } else if (key in req.params.action) {
                        $unset['action.' + key] = true;
                        hasChanges = true;
                    }
                });

                targets = values.action.targets;

                if (targets) {
                    for (let i = 0, len = targets.length; i < len; i++) {
                        let target = targets[i];
                        if (!/^smtps?:/i.test(target) && !/^https?:/i.test(target) && target.indexOf('@') >= 0) {
                            // email
                            targets[i] = {
                                id: new ObjectId(),
                                type: 'mail',
                                value: target
                            };
                        } else if (/^smtps?:/i.test(target)) {
                            targets[i] = {
                                id: new ObjectId(),
                                type: 'relay',
                                value: target
                            };
                        } else if (/^https?:/i.test(target)) {
                            targets[i] = {
                                id: new ObjectId(),
                                type: 'http',
                                value: target
                            };
                        } else {
                            res.status(400);
                            res.json({
                                error: 'Unknown target type "' + target + '"',
                                code: 'InputValidationError'
                            });
                            return next();
                        }
                    }

                    $set['action.targets'] = targets;
                    hasChanges = true;
                } else if ('targets' in req.params.action) {
                    $unset['action.targets'] = true;
                    hasChanges = true;
                }

                if (values.action) {
                    if (!values.action.mailbox) {
                        if ('mailbox' in req.params.action) {
                            // clear target mailbox
                            $unset['action.mailbox'] = true;
                            hasChanges = true;
                        }
                    } else {
                        let mailboxData;
                        try {
                            mailboxData = await db.database.collection('mailboxes').findOne({
                                _id: new ObjectId(values.action.mailbox),
                                user
                            });
                        } catch (err) {
                            res.status(500);
                            res.json({
                                error: 'MongoDB Error: ' + err.message,
                                code: 'InternalDatabaseError'
                            });
                            return next();
                        }

                        if (!mailboxData) {
                            res.status(404);
                            res.json({
                                error: 'This mailbox does not exist',
                                code: 'NoSuchMailbox'
                            });
                            return next();
                        }

                        $set['action.mailbox'] = mailboxData._id;
                        hasChanges = true;
                    }
                }
            }

            if (!hasChanges) {
                res.json({
                    success: true
                });
                return next();
            }

            let update = {};

            if (Object.keys($set).length) {
                update.$set = $set;
            }

            if (Object.keys($unset).length) {
                update.$unset = $unset;
            }

            let r;
            try {
                r = await db.database.collection('filters').findOneAndUpdate(
                    {
                        _id: filter,
                        user
                    },
                    update,
                    { returnDocument: 'before' }
                );
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!r || !r.value || !r.value._id) {
                res.status(404);
                res.json({
                    error: 'Filter was not found',
                    code: 'FilterNotFound'
                });
                return next();
            }

            let existingFilterData = r.value;
            let existingTargets = ((existingFilterData.action && existingFilterData.action.targets) || []).map(target => target.value);
            // compare new forwards against existing ones
            if (targets) {
                for (let target of targets) {
                    if (!existingTargets.includes(target.value)) {
                        // found new forward
                        try {
                            await userHandler.logAuthEvent(user, {
                                action: 'filter forward added',
                                result: 'success',
                                target: target.value,
                                filter: existingFilterData._id,
                                protocol: 'API',
                                sess: values.sess,
                                ip: values.ip
                            });
                        } catch (err) {
                            log.error('API', err);
                        }

                        await publish(db.redis, {
                            ev: FORWARD_ADDED,
                            user,
                            type: 'filter',
                            filter: existingFilterData._id,
                            target: target.value
                        });
                    }
                }
            }

            res.json({
                success: true
            });
            return next();
        })
    );
};

function getFilterStrings(filter, mailboxes) {
    let query = Object.keys(filter.query.headers || {}).map(key => [key, '(' + filter.query.headers[key] + ')']);

    if (filter.query.ha && filter.query.ha > 0) {
        query.push(['has attachment']);
    } else if (filter.query.ha && filter.query.ha < 0) {
        query.push(['no attachments']);
    }

    if (filter.query.text) {
        query.push([false, '"' + filter.query.text + '"']);
    }

    if (filter.query.size) {
        // let unit = 'B';
        let size = Math.abs(filter.query.size || 0);
        if (filter.query.size > 0) {
            query.push(['larger', size /*+ unit*/]);
        } else if (filter.query.size < 0) {
            query.push(['smaller', size /*+ unit*/]);
        }
    }

    // process actions
    let action = Object.keys(filter.action || {})
        .map(key => {
            switch (key) {
                case 'seen':
                    if (filter.action[key]) {
                        return ['mark as read'];
                    } else {
                        return ['do not mark as read'];
                    }
                case 'flag':
                    if (filter.action[key]) {
                        return ['flag it'];
                    } else {
                        return ['do not flag it'];
                    }
                case 'spam':
                    if (filter.action[key]) {
                        return ['mark it as spam'];
                    } else {
                        return ['do not mark it as spam'];
                    }
                case 'delete':
                    if (filter.action[key]) {
                        return ['delete it'];
                    } else {
                        return ['do not delete it'];
                    }
                case 'mailbox':
                    if (filter.action[key]) {
                        let target = mailboxes && mailboxes.find(mailbox => mailbox._id.toString() === filter.action[key].toString());
                        return ['move to folder', target ? '"' + target.path + '"' : filter.action[key].toString()];
                    } else {
                        return ['keep in INBOX'];
                    }
                case 'targets':
                    if (filter.action[key]) {
                        return [
                            'forward to',
                            filter.action[key]
                                .map(target => {
                                    switch (target.type) {
                                        case 'http': {
                                            let parsed = urllib.parse(target.value);
                                            return parsed.hostname || parsed.host;
                                        }

                                        default:
                                            return target.value;
                                    }
                                })
                                .join(', ')
                        ];
                    }
                    break;
            }
            return false;
        })
        .filter(str => str);
    return {
        query,
        action
    };
}
