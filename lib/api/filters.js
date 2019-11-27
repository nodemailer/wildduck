'use strict';

const Joi = require('@hapi/joi');
const ObjectID = require('mongodb').ObjectID;
const urllib = require('url');
const tools = require('../tools');
const roles = require('../roles');

module.exports = (db, server) => {
    /**
     * @api {get} /users/:user/filters List Filters for a User
     * @apiName GetFilters
     * @apiGroup Filters
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Object[]} results Filter description
     * @apiSuccess {String} results.id Filter ID
     * @apiSuccess {String} results.name Name for the filter
     * @apiSuccess {String} results.created Datestring of the time the filter was created
     * @apiSuccess {Array[]} results.query A list of query descriptions
     * @apiSuccess {Array[]} results.action A list of action descriptions
     * @apiSuccess {Boolean} results.disabled If true, then this filter is ignored
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/users/5a1bda70bfbd1442cd96c6f0/filters
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "results": [
     *         {
     *           "id": "5a1c0ee490a34c67e266931c",
     *           "query": [
     *             [
     *               "from",
     *               "(Mäger)"
     *             ]
     *           ],
     *           "action": [
     *             [
     *               "mark as read"
     *             ]
     *           ],
     *           "disabled": false,
     *           "created": "2017-11-27T13:11:00.835Z"
     *         }
     *       ]
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This user does not exist"
     *     }
     */
    server.get(
        '/users/:user/filters',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            const result = Joi.validate(req.params, schema, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('filters'));
            } else {
                req.validate(roles.can(req.role).readAny('filters'));
            }

            let user = new ObjectID(result.value.user);

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
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
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
                        id: filterData._id,
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

    /**
     * @api {get} /users/:user/filters/:filter Request Filter information
     * @apiName GetFilter
     * @apiGroup Filters
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID.
     * @apiParam {String} filter Filters unique ID.
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID for the Filter
     * @apiSuccess {String} name Name of the Filter
     * @apiSuccess {Object} query Rules that a message must match
     * @apiSuccess {String} query.from Partial match for the From: header (case insensitive)
     * @apiSuccess {String} query.to Partial match for the To:/Cc: headers (case insensitive)
     * @apiSuccess {String} query.subject Partial match for the Subject: header (case insensitive)
     * @apiSuccess {String} query.listId Partial match for the List-ID: header (case insensitive)
     * @apiSuccess {String} query.text Fulltext search against message text
     * @apiSuccess {Boolean} query.ha Does a message have to have an attachment or not
     * @apiSuccess {Number} query.size Message size in bytes. If the value is a positive number then message needs to be larger, if negative then message needs to be smaller than abs(size) value
     * @apiSuccess {Object} action Action to take with a matching message
     * @apiSuccess {Boolean} action.seen If true then mark matching messages as Seen
     * @apiSuccess {Boolean} action.flag If true then mark matching messages as Flagged
     * @apiSuccess {Boolean} action.delete If true then do not store matching messages
     * @apiSuccess {Boolean} action.spam If true then store matching messags to Junk Mail folder
     * @apiSuccess {String} action.mailbox Mailbox ID to store matching messages to
     * @apiSuccess {String[]} action.targets A list of email addresses / HTTP URLs to forward the message to
     * @apiSuccess {Boolean} disabled If true, then this filter is ignored
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/users/59fc66a03e54454869460e45/filters/5a1c0ee490a34c67e266931c
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "5a1c0ee490a34c67e266931c",
     *       "created": "2017-11-27T13:11:00.835Z",
     *       "query": {
     *         "from": "Mäger"
     *       },
     *       "action": {
     *          "seen": true
     *       },
     *       "disabled": false
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This filter does not exist"
     *     }
     */
    server.get(
        '/users/:user/filters/:filter',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                filter: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            const result = Joi.validate(req.params, schema, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('filters'));
            } else {
                req.validate(roles.can(req.role).readAny('filters'));
            }

            let user = new ObjectID(result.value.user);
            let filter = new ObjectID(result.value.filter);

            let filterData;
            try {
                filterData = await db.database.collection('filters').findOne({
                    _id: filter,
                    user
                });
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!filterData) {
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
                id: filterData._id,
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

    /**
     * @api {delete} /users/:user/filters/:filter Delete a Filter
     * @apiName DeleteFilter
     * @apiGroup Filters
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID
     * @apiParam {String} filter Filters unique ID
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE http://localhost:8080/users/59fc66a03e54454869460e45/filters/5a1c0ee490a34c67e266931c
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This filter does not exist"
     *     }
     */
    server.del(
        '/users/:user/filters/:filter',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                filter: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            const result = Joi.validate(req.params, schema, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).deleteOwn('filters'));
            } else {
                req.validate(roles.can(req.role).deleteAny('filters'));
            }

            let user = new ObjectID(result.value.user);
            let filter = new ObjectID(result.value.filter);

            let r;

            try {
                r = await db.database.collection('filters').deleteOne({
                    _id: filter,
                    user
                });
            } catch (err) {
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

            res.json({
                success: true
            });
            return next();
        })
    );

    /**
     * @api {post} /users/:user/filters Create new Filter
     * @apiName PostFilter
     * @apiGroup Filters
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID.
     * @apiParam {String} [name] Name of the Filter
     * @apiParam {Object} query Rules that a message must match
     * @apiParam {String} [query.from] Partial match for the From: header (case insensitive)
     * @apiParam {String} [query.to] Partial match for the To:/Cc: headers (case insensitive)
     * @apiParam {String} [query.subject] Partial match for the Subject: header (case insensitive)
     * @apiParam {String} [query.listId] Partial match for the List-ID: header (case insensitive)
     * @apiParam {String} [query.text] Fulltext search against message text
     * @apiParam {Boolean} [query.ha] Does a message have to have an attachment or not
     * @apiParam {Number} [query.size] Message size in bytes. If the value is a positive number then message needs to be larger, if negative then message needs to be smaller than abs(size) value
     * @apiParam {Object} action Action to take with a matching message
     * @apiParam {Boolean} [action.seen] If true then mark matching messages as Seen
     * @apiParam {Boolean} [action.flag] If true then mark matching messages as Flagged
     * @apiParam {Boolean} [action.delete] If true then do not store matching messages
     * @apiParam {Boolean} [action.spam] If true then store matching messags to Junk Mail folder
     * @apiParam {String} [action.mailbox] Mailbox ID to store matching messages to
     * @apiParam {String[]} [action.targets] An array of forwarding targets. The value could either be an email address or a relay url to next MX server ("smtp://mx2.zone.eu:25") or an URL where mail contents are POSTed to
     * @apiParam {Boolean} [disabled] If true then this filter is ignored
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID for the created Filter
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/users/5a1bda70bfbd1442cd96c6f0/filters \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "query": {
     *         "from": "Mäger"
     *       },
     *       "action": {
     *         "seen": true
     *       }
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "5a1c0ee490a34c67e266931c"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Empty filter query"
     *     }
     */
    server.post(
        '/users/:user/filters',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),

                name: Joi.string()
                    .trim()
                    .max(255)
                    .empty(''),

                query: Joi.object()
                    .keys({
                        from: Joi.string()
                            .trim()
                            .max(255)
                            .empty(''),
                        to: Joi.string()
                            .trim()
                            .max(255)
                            .empty(''),
                        subject: Joi.string()
                            .trim()
                            .max(255)
                            .empty(''),
                        listId: Joi.string()
                            .trim()
                            .max(255)
                            .empty(''),
                        text: Joi.string()
                            .trim()
                            .max(255)
                            .empty(''),
                        ha: Joi.boolean()
                            .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                            .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                            .empty(''),
                        size: Joi.number().empty('')
                    })
                    .default({}),
                action: Joi.object()
                    .keys({
                        seen: Joi.boolean()
                            .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                            .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                            .empty(''),
                        flag: Joi.boolean()
                            .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                            .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                            .empty(''),
                        delete: Joi.boolean()
                            .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                            .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                            .empty(''),
                        spam: Joi.boolean()
                            .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                            .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                            .empty(''),
                        mailbox: Joi.string()
                            .hex()
                            .lowercase()
                            .length(24)
                            .empty(''),
                        targets: Joi.array()
                            .items(
                                Joi.string().email(),
                                Joi.string().uri({
                                    scheme: [/smtps?/, /https?/],
                                    allowRelative: false,
                                    relativeOnly: false
                                })
                            )
                            .empty('')
                    })
                    .default({}),

                disabled: Joi.boolean()
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                    .default(false),

                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            const result = Joi.validate(req.params, schema, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).createOwn('filters'));
            } else {
                req.validate(roles.can(req.role).createAny('filters'));
            }

            let user = new ObjectID(result.value.user);
            let filterData = {
                _id: new ObjectID(),
                user,
                query: {
                    headers: {}
                },
                action: {},
                disabled: result.value.disabled,
                created: new Date()
            };

            if (result.value.name) {
                filterData.name = result.value.name;
            }

            ['from', 'to', 'subject', 'listId'].forEach(key => {
                if (result.value.query[key]) {
                    filterData.query.headers[key] = result.value.query[key].replace(/\s+/g, ' ');
                }
            });

            if (result.value.query.text) {
                filterData.query.text = result.value.query.text.replace(/\s+/g, ' ');
            }

            if (typeof result.value.query.ha === 'boolean') {
                filterData.query.ha = result.value.query.ha;
            }

            if (result.value.query.size) {
                filterData.query.size = result.value.query.size;
            }

            ['seen', 'flag', 'delete', 'spam'].forEach(key => {
                if (typeof result.value.action[key] === 'boolean') {
                    filterData.action[key] = result.value.action[key];
                }
            });

            let targets = result.value.action.targets;

            if (targets) {
                for (let i = 0, len = targets.length; i < len; i++) {
                    let target = targets[i];
                    if (!/^smtps?:/i.test(target) && !/^https?:/i.test(target) && target.indexOf('@') >= 0) {
                        // email
                        targets[i] = {
                            id: new ObjectID(),
                            type: 'mail',
                            value: target
                        };
                    } else if (/^smtps?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectID(),
                            type: 'relay',
                            value: target
                        };
                    } else if (/^https?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectID(),
                            type: 'http',
                            value: target
                        };
                    } else {
                        res.json({
                            error: 'Unknown target type "' + target + '"',
                            code: 'InputValidationError'
                        });
                        return next();
                    }
                }

                filterData.action.targets = targets;
            }

            if (result.value.action.mailbox) {
                let mailboxData;
                try {
                    mailboxData = await db.database.collection('mailboxes').findOne({
                        _id: new ObjectID(result.value.action.mailbox),
                        user
                    });
                } catch (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }

                if (!mailboxData) {
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
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
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
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            res.json({
                success: !!r.insertedCount,
                id: filterData._id
            });

            return next();
        })
    );

    /**
     * @api {put} /users/:user/filters/:filter Update Filter information
     * @apiName PutFilter
     * @apiGroup Filters
     * @apiDescription This method updates Filter data. To unset a value, use empty strings
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID.
     * @apiParam {String} filter Filters unique ID.
     * @apiParam {String} [name] Name of the Filter
     * @apiParam {Object} query Rules that a message must match
     * @apiParam {String} [query.from] Partial match for the From: header (case insensitive)
     * @apiParam {String} [query.to] Partial match for the To:/Cc: headers (case insensitive)
     * @apiParam {String} [query.subject] Partial match for the Subject: header (case insensitive)
     * @apiParam {String} [query.listId] Partial match for the List-ID: header (case insensitive)
     * @apiParam {String} [query.text] Fulltext search against message text
     * @apiParam {Boolean} [query.ha] Does a message have to have an attachment or not
     * @apiParam {Number} [query.size] Message size in bytes. If the value is a positive number then message needs to be larger, if negative then message needs to be smaller than abs(size) value
     * @apiParam {Object} action Action to take with a matching message
     * @apiParam {Boolean} [action.seen] If true then mark matching messages as Seen
     * @apiParam {Boolean} [action.flag] If true then mark matching messages as Flagged
     * @apiParam {Boolean} [action.delete] If true then do not store matching messages
     * @apiParam {Boolean} [action.spam] If true then store matching messags to Junk Mail folder
     * @apiParam {String} [action.mailbox] Mailbox ID to store matching messages to
     * @apiParam {String[]} [action.targets] An array of forwarding targets. The value could either be an email address or a relay url to next MX server ("smtp://mx2.zone.eu:25") or an URL where mail contents are POSTed to
     * @apiParam {Boolean} [disabled] If true then this filter is ignored
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID for the created Filter
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45/filters/5a1c0ee490a34c67e266931c \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "action": {
     *         "seen": "",
     *         "flag": true
     *       }
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Empty filter query"
     *     }
     */
    server.put(
        '/users/:user/filters/:filter',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                filter: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),

                name: Joi.string()
                    .trim()
                    .max(255)
                    .empty(''),

                query: Joi.object()
                    .keys({
                        from: Joi.string()
                            .trim()
                            .max(255)
                            .empty(''),
                        to: Joi.string()
                            .trim()
                            .max(255)
                            .empty(''),
                        subject: Joi.string()
                            .trim()
                            .max(255)
                            .empty(''),
                        listId: Joi.string()
                            .trim()
                            .max(255)
                            .empty(''),
                        text: Joi.string()
                            .trim()
                            .max(255)
                            .empty(''),
                        ha: Joi.boolean()
                            .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                            .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                            .empty(''),
                        size: Joi.number().empty('')
                    })
                    .default({}),
                action: Joi.object()
                    .keys({
                        seen: Joi.boolean()
                            .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                            .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                            .empty(''),
                        flag: Joi.boolean()
                            .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                            .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                            .empty(''),
                        delete: Joi.boolean()
                            .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                            .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                            .empty(''),
                        spam: Joi.boolean()
                            .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                            .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                            .empty(''),
                        mailbox: Joi.string()
                            .hex()
                            .lowercase()
                            .length(24)
                            .empty(''),
                        targets: Joi.array()
                            .items(
                                Joi.string().email(),
                                Joi.string().uri({
                                    scheme: [/smtps?/, /https?/],
                                    allowRelative: false,
                                    relativeOnly: false
                                })
                            )
                            .empty('')
                    })
                    .default({}),

                disabled: Joi.boolean()
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                    .empty(''),

                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            const result = Joi.validate(req.params, schema, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).updateOwn('filters'));
            } else {
                req.validate(roles.can(req.role).updateAny('filters'));
            }

            let user = new ObjectID(result.value.user);
            let filter = new ObjectID(result.value.filter);

            let $set = {};
            let $unset = {};

            let hasChanges = false;

            if (result.value.name) {
                $set.name = result.value.name;
                hasChanges = true;
            }

            if (typeof result.value.disabled === 'boolean') {
                $set.disabled = result.value.disabled;
                hasChanges = true;
            }

            ['from', 'to', 'subject', 'listId'].forEach(key => {
                if (result.value.query[key]) {
                    $set['query.headers.' + key] = result.value.query[key].replace(/\s+/g, ' ');
                    hasChanges = true;
                } else if (key in req.params.query) {
                    // delete empty values
                    $unset['query.headers.' + key] = true;
                    hasChanges = true;
                }
            });

            if (result.value.query.text) {
                $set['query.text'] = result.value.query.text.replace(/\s+/g, ' ');
                hasChanges = true;
            } else if ('text' in req.params.query) {
                $unset['query.text'] = true;
                hasChanges = true;
            }

            if (typeof result.value.query.ha === 'boolean') {
                $set['query.ha'] = result.value.query.ha;
                hasChanges = true;
            } else if ('ha' in req.params.query) {
                $unset['query.ha'] = true;
                hasChanges = true;
            }

            if (result.value.query.size) {
                $set['query.size'] = result.value.query.size;
                hasChanges = true;
            } else if ('size' in req.params.query) {
                $unset['query.size'] = true;
                hasChanges = true;
            }

            ['seen', 'flag', 'delete', 'spam'].forEach(key => {
                if (typeof result.value.action[key] === 'boolean') {
                    $set['action.' + key] = result.value.action[key];
                    hasChanges = true;
                } else if (key in req.params.action) {
                    $unset['action.' + key] = true;
                    hasChanges = true;
                }
            });

            let targets = result.value.action.targets;

            if (targets) {
                for (let i = 0, len = targets.length; i < len; i++) {
                    let target = targets[i];
                    if (!/^smtps?:/i.test(target) && !/^https?:/i.test(target) && target.indexOf('@') >= 0) {
                        // email
                        targets[i] = {
                            id: new ObjectID(),
                            type: 'mail',
                            value: target
                        };
                    } else if (/^smtps?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectID(),
                            type: 'relay',
                            value: target
                        };
                    } else if (/^https?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectID(),
                            type: 'http',
                            value: target
                        };
                    } else {
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

            if (result.value.action) {
                if (!result.value.action.mailbox) {
                    if ('mailbox' in req.params.action) {
                        // clear target mailbox
                        $unset['action.mailbox'] = true;
                        hasChanges = true;
                    }
                } else {
                    let mailboxData;
                    try {
                        mailboxData = await db.database.collection('mailboxes').findOne({
                            _id: new ObjectID(result.value.action.mailbox),
                            user
                        });
                    } catch (err) {
                        res.json({
                            error: 'MongoDB Error: ' + err.message,
                            code: 'InternalDatabaseError'
                        });
                        return next();
                    }

                    if (!mailboxData) {
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

            if (!hasChanges) {
                res.json({
                    error: 'No changes'
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
                r = await db.database.collection('filters').findOneAndUpdate({ _id: filter, user }, update);
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!r || !r.value || !r.value._id) {
                res.json({
                    error: 'Filter was not found',
                    code: 'FilterNotFound'
                });
                return next();
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
                        let target = mailboxes.find(mailbox => mailbox._id.toString() === filter.action[key].toString());
                        return ['move to folder', target ? '"' + target.path + '"' : '?'];
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
