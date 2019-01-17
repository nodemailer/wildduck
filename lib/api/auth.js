'use strict';

const Joi = require('../joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const util = require('util');
const roles = require('../roles');

module.exports = (db, server, userHandler) => {
    const authenticate = util.promisify((...args) => {
        let callback = args.pop();
        userHandler.authenticate(...args, (err, authData, user) => {
            if (err) {
                return callback(err);
            }
            return callback(null, { authData, user });
        });
    });

    /**
     * @api {post} /authenticate Authenticate an User
     * @apiName PostAuth
     * @apiGroup Authentication
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} username Username or E-mail address
     * @apiParam {String} password Password
     * @apiParam {String} [protocol] Application identifier for security logs
     * @apiParam {String} [scope="master"] Required scope. One of <code>master</code>, <code>imap</code>, <code>smtp</code>, <code>pop3</code>
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of authenticated User
     * @apiSuccess {String} username Username of authenticated User
     * @apiSuccess {String} scope The scope this authentication is valid for
     * @apiSuccess {String[]} require2fa List of enabled 2FA mechanisms
     * @apiSuccess {Boolean} requirePasswordChange Indicates if account hassword has been reset and should be replaced
     *
     * @apiError error Description of the error
     * @apiError [code] Error code
     * @apiError [id] User ID if the user exists
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/authenticate \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "username": "myuser",
     *       "password": "secretpass",
     *       "scope": "master"
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "5a12914c350c183bd0d331f0",
     *       "username": "myuser",
     *       "scope": "master",
     *       "require2fa": [
     *         "totp"
     *       ],
     *       "requirePasswordChange": false
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Authentication failed. Invalid scope",
     *       "code": "InvalidAuthScope",
     *       "id": "5b22283d45e8d47572eb0381"
     *     }
     */
    server.post(
        '/authenticate',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                username: Joi.alternatives()
                    .try(
                        Joi.string()
                            .lowercase()
                            .regex(/^[a-z0-9][a-z0-9.]+[a-z0-9]$/, 'username')
                            .min(3)
                            .max(30),
                        Joi.string().email()
                    )
                    .required(),
                password: Joi.string()
                    .max(256)
                    .required(),

                protocol: Joi.string().default('API'),
                scope: Joi.string().default('master'),

                appId: Joi.string()
                    .empty('')
                    .uri(),

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
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            req.validate(roles.can(req.role).createAny('authentication'));

            let meta = {
                protocol: result.value.protocol,
                sess: result.value.sess,
                ip: result.value.ip
            };

            if (result.value.appId) {
                meta.appId = result.value.appId;
            }

            let authData, user;

            try {
                let auth = await authenticate(result.value.username, result.value.password, result.value.scope, meta);
                authData = auth.authData;
                user = auth.user;
            } catch (err) {
                let response = {
                    error: err.message,
                    code: 'AuthFailed' || err.code
                };
                if (user) {
                    response.id = user.toString();
                }
                res.json(response);
                return next();
            }

            if (!authData) {
                let response = {
                    error: 'Authentication failed',
                    code: 'AuthFailed'
                };
                if (user) {
                    response.id = user.toString();
                }
                res.json(response);
                return next();
            }

            let authResponse = {
                success: true,
                id: authData.user,
                username: authData.username,
                scope: authData.scope,
                require2fa: authData.require2fa,
                requirePasswordChange: authData.requirePasswordChange
            };

            if (authData.u2fAuthRequest) {
                authResponse.u2fAuthRequest = authData.u2fAuthRequest;
            }

            res.json(authResponse);
            return next();
        })
    );

    /**
     * @api {get} /users/:user/authlog List authentication Events
     * @apiName GetAuthlog
     * @apiGroup Authentication
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} [action] Limit listing only to values with specific action value
     * @apiParam {String} [filterIp] Limit listing only to values with specific IP address
     * @apiParam {Number} [limit=20] How many records to return
     * @apiParam {Number} [page=1] Current page number. Informational only, page numbers start from 1
     * @apiParam {Number} [next] Cursor value for next page, retrieved from <code>nextCursor</code> response value
     * @apiParam {Number} [previous] Cursor value for previous page, retrieved from <code>previousCursor</code> response value
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Number} total How many results were found
     * @apiSuccess {Number} page Current page number. Derived from <code>page</code> query argument
     * @apiSuccess {String} previousCursor Either a cursor string or false if there are not any previous results
     * @apiSuccess {String} nextCursor Either a cursor string or false if there are not any next results
     * @apiSuccess {Object[]} results Event listing
     * @apiSuccess {String} results.id ID of the Event
     * @apiSuccess {String} results.action Action identifier
     * @apiSuccess {String} results.result Did the action succeed
     * @apiSuccess {String} results.sess Session identifier
     * @apiSuccess {String} results.ip IP address of the Event
     * @apiSuccess {String} results.created Datestring of the Event time
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/authlog?action=account+created"
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "action": "account created",
     *       "total": 1,
     *       "page": 1,
     *       "previousCursor": false,
     *       "nextCursor": false,
     *       "results": [
     *         {
     *           "id": "59fc66a03e54454869460e4d",
     *           "action": "account created",
     *           "result": "success",
     *           "sess": null,
     *           "ip": null,
     *           "created": "2017-11-03T12:52:48.792Z",
     *           "expires": "2017-12-03T12:52:48.792Z"
     *         }
     *       ]
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
    server.get(
        { name: 'authlog', path: '/users/:user/authlog' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                action: Joi.string()
                    .trim()
                    .lowercase()
                    .empty('')
                    .max(100),
                limit: Joi.number()
                    .default(20)
                    .min(1)
                    .max(250),
                next: Joi.string()
                    .empty('')
                    .mongoCursor()
                    .max(1024),
                previous: Joi.string()
                    .empty('')
                    .mongoCursor()
                    .max(1024),
                page: Joi.number()
                    .empty('')
                    .default(1),
                filterIp: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                }),

                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            req.query.user = req.params.user;

            const result = Joi.validate(req.query, schema, {
                abortEarly: false,
                convert: true,
                allowUnknown: false
            });

            if (result.error) {
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('authentication'));
            } else {
                req.validate(roles.can(req.role).readAny('authentication'));
            }

            let user = new ObjectID(result.value.user);
            let limit = result.value.limit;

            let action = result.value.action;
            let ip = result.value.filterIp;

            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;

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

            let filter = { user };
            if (ip) {
                filter.ip = ip;
            }

            let total = await db.users.collection('authlog').countDocuments(filter);

            let opts = {
                limit,
                query: filter,
                sortAscending: false
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.users.collection('authlog'), opts);
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!listing.hasPrevious) {
                page = 1;
            }

            let response = {
                success: true,
                action,
                total,
                page,
                previousCursor: listing.hasPrevious ? listing.previous : false,
                nextCursor: listing.hasNext ? listing.next : false,
                results: (listing.results || []).map(resultData => {
                    let response = {
                        id: (resultData._id || '').toString()
                    };
                    Object.keys(resultData).forEach(key => {
                        if (!['_id', 'user'].includes(key)) {
                            response[key] = resultData[key];
                        }
                    });
                    return response;
                })
            };

            res.json(response);
            return next();
        })
    );

    /**
     * @api {get} /users/:user/authlog/:event Request Event information
     * @apiName GetAuthlogEvent
     * @apiGroup Authentication
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} event ID of the Event
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the Event
     * @apiSuccess {String} action Action identifier
     * @apiSuccess {String} result Did the action succeed
     * @apiSuccess {String} sess Session identifier
     * @apiSuccess {String} ip IP address of the Event
     * @apiSuccess {String} created Datestring of the Event time
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/authlog/59fc66a03e54454869460e4d"
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "id": "59fc66a03e54454869460e4d",
     *       "action": "account created",
     *       "result": "success",
     *       "sess": null,
     *       "ip": null,
     *       "created": "2017-11-03T12:52:48.792Z",
     *       "expires": "2017-12-03T12:52:48.792Z"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
    server.get(
        '/users/:user/authlog/:event',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                event: Joi.string()
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
                convert: true,
                allowUnknown: false
            });

            if (result.error) {
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('authentication'));
            } else {
                req.validate(roles.can(req.role).readAny('authentication'));
            }

            let user = new ObjectID(result.value.user);
            let event = new ObjectID(result.value.event);

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

            let filter = { _id: event, user };
            let eventData;
            try {
                eventData = await db.users.collection('authlog').findOne(filter);
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!eventData) {
                res.json({
                    error: 'Event was not found',
                    code: 'EventNotFound'
                });
                return next();
            }

            let response = {
                success: true,
                id: eventData._id
            };
            Object.keys(eventData).forEach(key => {
                if (!['_id', 'user'].includes(key)) {
                    response[key] = eventData[key];
                }
            });

            res.json(response);
            return next();
        })
    );
};
