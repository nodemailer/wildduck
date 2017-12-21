'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;
const urllib = require('url');

module.exports = (db, server) => {
    /**
     * @api {get} /users/:user/filters List Filters for an User
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
    server.get('/users/:user/filters', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required()
        });

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);

        db.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    address: true
                }
            },
            (err, userData) => {
                if (err) {
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

                db.database
                    .collection('mailboxes')
                    .find({
                        user
                    })
                    .project({ _id: 1, path: 1 })
                    .sort({ _id: 1 })
                    .toArray((err, mailboxes) => {
                        if (err) {
                            res.json({
                                error: 'MongoDB Error: ' + err.message,
                                code: 'InternalDatabaseError'
                            });
                            return next();
                        }

                        if (!mailboxes) {
                            mailboxes = [];
                        }

                        db.database
                            .collection('filters')
                            .find({
                                user
                            })
                            .sort({
                                _id: 1
                            })
                            .toArray((err, filters) => {
                                if (err) {
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

                                    results: filters.map(filter => {
                                        let descriptions = getFilterStrings(filter, mailboxes);
                                        return {
                                            id: filter._id,
                                            name: filter.name,
                                            query: descriptions.query,
                                            action: descriptions.action,
                                            created: filter.created
                                        };
                                    })
                                });

                                return next();
                            });
                    });
            }
        );
    });

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
     * @apiSuccess {String} query_from Partial match for the From: header (case insensitive)
     * @apiSuccess {String} query_to Partial match for the To:/Cc: headers (case insensitive)
     * @apiSuccess {String} query_subject Partial match for the Subject: header (case insensitive)
     * @apiSuccess {String} query_text Fulltext search against message text
     * @apiSuccess {Bolean} query_ha Does a message have to have an attachment or not
     * @apiSuccess {Number} query_size Message size in bytes. If the value is a positive number then message needs to be larger, if negative then message needs to be smaller than abs(size) value
     * @apiSuccess {Bolean} action_seen If true then mark matching messages as Seen
     * @apiSuccess {Bolean} action_flag If true then mark matching messages as Flagged
     * @apiSuccess {Bolean} action_delete If true then do not store matching messages
     * @apiSuccess {Bolean} action_spam If true then store matching messags to Junk Mail folder
     * @apiSuccess {String} action_mailbox Mailbox ID to store matching messages to
     * @apiSuccess {String} action_forward An email address where matching messages should be forwarded to
     * @apiSuccess {String} action_targetUrl An URL where matching messages should be POSTed to
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
     *       "query_from": "Mäger",
     *       "action_seen": true
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This filter does not exist"
     *     }
     */
    server.get('/users/:user/filters/:filter', (req, res, next) => {
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
                .required()
        });

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let filter = new ObjectID(result.value.filter);

        db.database.collection('filters').findOne(
            {
                _id: filter,
                user
            },
            (err, filterData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }
                if (!filterData) {
                    res.json({
                        error: 'This filter does not exist'
                    });
                    return next();
                }

                db.database
                    .collection('mailboxes')
                    .find({
                        user
                    })
                    .project({ _id: 1, path: 1 })
                    .sort({ _id: 1 })
                    .toArray((err, mailboxes) => {
                        if (err) {
                            res.json({
                                error: 'MongoDB Error: ' + err.message,
                                code: 'InternalDatabaseError'
                            });
                            return next();
                        }

                        if (!mailboxes) {
                            mailboxes = [];
                        }

                        let result = {
                            success: true,
                            id: filterData._id,
                            name: filterData.name,
                            created: filterData.created
                        };

                        Object.keys((filterData.query && filterData.query.headers) || {}).forEach(key => {
                            result['query_' + key] = filterData.query.headers[key];
                        });

                        Object.keys(filterData.query || {}).forEach(key => {
                            if (key !== 'headers') {
                                result['query_' + key] = filterData.query[key];
                            }
                        });

                        Object.keys(filterData.action || {}).forEach(key => {
                            result['action_' + key] = filterData.action[key];
                        });

                        res.json(result);

                        return next();
                    });
            }
        );
    });

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
    server.del('/users/:user/filters/:filter', (req, res, next) => {
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
                .required()
        });

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let filter = new ObjectID(result.value.filter);

        db.database.collection('filters').deleteOne(
            {
                _id: filter,
                user
            },
            (err, r) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }

                if (!r.deletedCount) {
                    res.status(404);
                    res.json({
                        error: 'Filter was not found'
                    });
                    return next();
                }

                res.json({
                    success: true
                });
                return next();
            }
        );
    });

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
     * @apiParam {String} [query_from] Partial match for the From: header (case insensitive)
     * @apiParam {String} [query_to] Partial match for the To:/Cc: headers (case insensitive)
     * @apiParam {String} [query_subject] Partial match for the Subject: header (case insensitive)
     * @apiParam {String} [query_text] Fulltext search against message text
     * @apiParam {Bolean} [query_ha] Does a message have to have an attachment or not
     * @apiParam {Number} [query_size] Message size in bytes. If the value is a positive number then message needs to be larger, if negative then message needs to be smaller than abs(size) value
     * @apiParam {Bolean} [action_seen] If true then mark matching messages as Seen
     * @apiParam {Bolean} [action_flag] If true then mark matching messages as Flagged
     * @apiParam {Bolean} [action_delete] If true then do not store matching messages
     * @apiParam {Bolean} [action_spam] If true then store matching messags to Junk Mail folder
     * @apiParam {String} [action_mailbox] Mailbox ID to store matching messages to
     * @apiParam {String} [action_forward] An email address where matching messages should be forwarded to
     * @apiParam {String} [action_targetUrl] An URL where matching messages should be POSTed to
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
     *       "query_from": "Mäger",
     *       "action_seen": true
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
    server.post('/users/:user/filters', (req, res, next) => {
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

            query_from: Joi.string()
                .trim()
                .max(255)
                .empty(''),
            query_to: Joi.string()
                .trim()
                .max(255)
                .empty(''),
            query_subject: Joi.string()
                .trim()
                .max(255)
                .empty(''),
            query_text: Joi.string()
                .trim()
                .max(255)
                .empty(''),
            query_ha: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .empty(''),
            query_size: Joi.number().empty(''),

            action_seen: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .empty(''),
            action_flag: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .empty(''),
            action_delete: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .empty(''),
            action_spam: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .empty(''),

            action_mailbox: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .empty(''),
            action_forward: Joi.string()
                .email()
                .empty(''),
            action_targetUrl: Joi.string()
                .uri({
                    scheme: ['http', 'https'],
                    allowRelative: false,
                    relativeOnly: false
                })
                .empty('')
        });

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let filterData = {
            _id: new ObjectID(),
            user,
            query: {
                headers: {}
            },
            action: {},
            created: new Date()
        };

        if (result.value.name) {
            filterData.name = result.value.name;
        }

        let hasQuery = false;
        let hasAction = false;

        ['from', 'to', 'subject'].forEach(key => {
            if (result.value['query_' + key]) {
                filterData.query.headers[key] = result.value['query_' + key].replace(/\s+/g, ' ');
                hasQuery = true;
            }
        });

        if (result.value.query_text) {
            filterData.query.text = result.value.query_text.replace(/\s+/g, ' ');
            hasQuery = true;
        }

        if (typeof result.value.query_ha === 'boolean') {
            filterData.query.ha = result.value.query_ha;
            hasQuery = true;
        }

        if (result.value.query_size) {
            filterData.query.size = result.value.query_size;
            hasQuery = true;
        }

        ['seen', 'flag', 'delete', 'spam'].forEach(key => {
            if (typeof result.value['action_' + key] === 'boolean') {
                filterData.action[key] = result.value['action_' + key];
                hasAction = true;
            }
        });

        ['forward', 'targetUrl'].forEach(key => {
            if (result.value['action_' + key]) {
                filterData.action[key] = result.value['action_' + key];
                hasAction = true;
            }
        });

        let checkFilterMailbox = done => {
            if (!result.value.action_mailbox) {
                return done();
            }
            db.database.collection('mailboxes').findOne(
                {
                    _id: new ObjectID(result.value.action_mailbox),
                    user
                },
                (err, mailboxData) => {
                    if (err) {
                        res.json({
                            error: 'MongoDB Error: ' + err.message,
                            code: 'InternalDatabaseError'
                        });
                        return next();
                    }
                    if (!mailboxData) {
                        res.json({
                            error: 'This mailbox does not exist'
                        });
                        return next();
                    }
                    filterData.action.mailbox = mailboxData._id;
                    hasAction = true;
                    done();
                }
            );
        };

        checkFilterMailbox(() => {
            if (!hasQuery) {
                res.json({
                    error: 'Empty filter query'
                });
                return next();
            }

            if (!hasAction) {
                res.json({
                    error: 'Empty filter action'
                });
                return next();
            }

            db.users.collection('users').findOne(
                {
                    _id: user
                },
                {
                    fields: {
                        address: true
                    }
                },
                (err, userData) => {
                    if (err) {
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

                    db.database.collection('filters').insertOne(filterData, (err, r) => {
                        if (err) {
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
                    });
                }
            );
        });
    });

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
     * @apiParam {String} [query_from] Partial match for the From: header (case insensitive)
     * @apiParam {String} [query_to] Partial match for the To:/Cc: headers (case insensitive)
     * @apiParam {String} [query_subject] Partial match for the Subject: header (case insensitive)
     * @apiParam {String} [query_text] Fulltext search against message text
     * @apiParam {Bolean} [query_ha] Does a message have to have an attachment or not
     * @apiParam {Number} [query_size] Message size in bytes. If the value is a positive number then message needs to be larger, if negative then message needs to be smaller than abs(size) value
     * @apiParam {Bolean} [action_seen] If true then mark matching messages as Seen
     * @apiParam {Bolean} [action_flag] If true then mark matching messages as Flagged
     * @apiParam {Bolean} [action_delete] If true then do not store matching messages
     * @apiParam {Bolean} [action_spam] If true then store matching messags to Junk Mail folder
     * @apiParam {String} [action_mailbox] Mailbox ID to store matching messages to
     * @apiParam {String} [action_forward] An email address where matching messages should be forwarded to
     * @apiParam {String} [action_targetUrl] An URL where matching messages should be POSTed to
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
     *       "action_seen": "",
     *       "action_flag": true
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
    server.put('/users/:user/filters/:filter', (req, res, next) => {
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

            query_from: Joi.string()
                .trim()
                .max(255)
                .empty(''),
            query_to: Joi.string()
                .trim()
                .max(255)
                .empty(''),
            query_subject: Joi.string()
                .trim()
                .max(255)
                .empty(''),
            query_text: Joi.string()
                .trim()
                .max(255)
                .empty(''),
            query_ha: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .empty(''),
            query_size: Joi.number().empty(''),

            action_seen: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .empty(''),
            action_flag: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .empty(''),
            action_delete: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .empty(''),
            action_spam: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .empty(''),

            action_mailbox: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .empty(''),
            action_forward: Joi.string()
                .email()
                .empty(''),
            action_targetUrl: Joi.string()
                .uri({
                    scheme: ['http', 'https'],
                    allowRelative: false,
                    relativeOnly: false
                })
                .empty('')
        });

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let filter = new ObjectID(result.value.filter);

        let $set = {};
        let $unset = {};

        if (result.value.name) {
            $set.name = result.value.name;
        }

        let hasQuery = false;
        let hasAction = false;

        ['from', 'to', 'subject'].forEach(key => {
            if (result.value['query_' + key]) {
                $set['query.headers.' + key] = result.value['query_' + key].replace(/\s+/g, ' ');
                hasQuery = true;
            } else if ('query_' + key in req.params) {
                $unset['query.headers.' + key] = true;
                hasQuery = true;
            }
        });

        if (result.value.query_text) {
            $set['query.text'] = result.value.query_text.replace(/\s+/g, ' ');
            hasQuery = true;
        } else if ('query_text' in req.params) {
            $unset['query.text'] = true;
            hasQuery = true;
        }

        if (typeof result.value.query_ha === 'boolean') {
            $set['query.ha'] = result.value.query_ha;
            hasQuery = true;
        } else if ('query_ha' in req.params) {
            $unset['query.ha'] = true;
            hasQuery = true;
        }

        if (result.value.query_size) {
            $set['query.size'] = result.value.query_size;
            hasQuery = true;
        } else if ('query_size' in req.params) {
            $unset['query.size'] = true;
            hasQuery = true;
        }

        ['seen', 'flag', 'delete', 'spam'].forEach(key => {
            if (typeof result.value['action_' + key] === 'boolean') {
                $set['action.' + key] = result.value['action_' + key];
                hasAction = true;
            } else if ('action_' + key in req.params) {
                $unset['action.' + key] = true;
                hasAction = true;
            }
        });

        ['forward', 'targetUrl'].forEach(key => {
            if (result.value['action_' + key]) {
                $set['action.' + key] = result.value['action_' + key];
                hasAction = true;
            } else if ('action_' + key in req.params) {
                $unset['action.' + key] = true;
                hasAction = true;
            }
        });

        let checkFilterMailbox = done => {
            if (!result.value.action_mailbox) {
                if ('action_mailbox' in req.params) {
                    $unset['action.mailbox'] = true;
                    hasAction = true;
                }
                return done();
            }
            db.database.collection('mailboxes').findOne(
                {
                    _id: new ObjectID(result.value.action_mailbox),
                    user
                },
                (err, mailboxData) => {
                    if (err) {
                        res.json({
                            error: 'MongoDB Error: ' + err.message,
                            code: 'InternalDatabaseError'
                        });
                        return next();
                    }
                    if (!mailboxData) {
                        res.json({
                            error: 'This mailbox does not exist'
                        });
                        return next();
                    }
                    $set['action.mailbox'] = mailboxData._id;
                    hasAction = true;
                    done();
                }
            );
        };

        checkFilterMailbox(() => {
            if (!hasQuery && !hasAction) {
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

            db.database.collection('filters').findOneAndUpdate({ _id: filter, user }, update, (err, r) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }

                if (!r || !r.value || !r.value._id) {
                    res.status(404);
                    res.json({
                        error: 'Filter was not found'
                    });
                    return next();
                }

                res.json({
                    success: true
                });
                return next();
            });
        });
    });
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
        let unit = 'B';
        let size = Math.abs(filter.query.size || 0);
        if (size) {
            if (filter.query.size % (1024 * 1024) === 0) {
                unit = 'MB';
                size = Math.round(size / (1024 * 1024));
            } else if (filter.query.size % 1024 === 0) {
                unit = 'kB';
                size = Math.round(size / 1024);
            }
        }
        if (filter.query.size > 0) {
            query.push(['larger', size + unit]);
        } else if (filter.query.size < 0) {
            query.push(['smaller', size + unit]);
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
                case 'mailbox':
                    if (filter.action[key]) {
                        let target = mailboxes.find(mailbox => mailbox._id.toString() === filter.action[key].toString());
                        return ['move to folder', target ? '"' + target.path + '"' : '?'];
                    } else {
                        return ['keep in INBOX'];
                    }
                case 'forward':
                    if (filter.action[key]) {
                        return ['forward to', filter.action[key]];
                    }
                    break;
                case 'targetUrl':
                    if (filter.action[key]) {
                        let url = filter.action[key];
                        let parsed = urllib.parse(url);
                        return ['upload to', parsed.hostname || parsed.host];
                    }
                    break;
                case 'spam':
                    if (filter.action[key] > 0) {
                        return ['mark it as spam'];
                    } else if (filter.action[key] < 0) {
                        return ['do not mark it as spam'];
                    }
                    break;
                case 'delete':
                    if (filter.action[key]) {
                        return ['delete it'];
                    } else {
                        return ['do not delete it'];
                    }
            }
            return false;
        })
        .filter(str => str);
    return {
        query,
        action
    };
}
