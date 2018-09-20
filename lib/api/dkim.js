'use strict';

const config = require('wild-config');
const Joi = require('../joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectID = require('mongodb').ObjectID;
const DkimHandler = require('../dkim-handler');
const tools = require('../tools');
const util = require('util');
const roles = require('../roles');

module.exports = (db, server) => {
    const dkimHandler = new DkimHandler({
        cipher: config.dkim.cipher,
        secret: config.dkim.secret,
        useOpenSSL: config.dkim.useOpenSSL,
        pathOpenSSL: config.dkim.pathOpenSSL,
        database: db.database
    });

    const setDkim = util.promisify(dkimHandler.set.bind(dkimHandler));
    const getDkim = util.promisify(dkimHandler.get.bind(dkimHandler));
    const delDkim = util.promisify(dkimHandler.del.bind(dkimHandler));

    /**
     * @api {get} /dkim List registered DKIM keys
     * @apiName GetDkim
     * @apiGroup DKIM
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} [query] Partial match of a Domain name
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
     * @apiSuccess {Object[]} results Aliases listing
     * @apiSuccess {String} results.id ID of the DKIM
     * @apiSuccess {String} results.domain The domain this DKIM key applies to
     * @apiSuccess {String} results.selector DKIM selector
     * @apiSuccess {String} results.description Key description
     * @apiSuccess {String} results.fingerprint Key fingerprint (SHA1)
     * @apiSuccess {String} results.created Datestring
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/dkim
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "total": 1,
     *       "page": 1,
     *       "previousCursor": false,
     *       "nextCursor": false,
     *       "results": [
     *         {
     *           "id": "59ef21aef255ed1d9d790e81",
     *           "domain": "example.com",
     *           "selector": "oct17",
     *           "description": "Key for marketing emails",
     *           "fingerprint": "6a:aa:d7:ba:e4:99:b4:12:e0:f3:35:01:71:d4:f1:d6:b4:95:c4:f5",
     *           "created": "2017-10-24T11:19:10.911Z"
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
        { name: 'dkim', path: '/dkim' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                query: Joi.string()
                    .empty('')
                    .trim()
                    .max(255),
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
                page: Joi.number().default(1),
                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            const result = Joi.validate(req.query, schema, {
                abortEarly: false,
                convert: true,
                allowUnknown: true
            });

            if (result.error) {
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            req.validate(roles.can(req.role).readAny('dkim'));

            let query = result.value.query;
            let limit = result.value.limit;
            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;

            let filter = query
                ? {
                      domain: {
                          $regex: query.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'),
                          $options: ''
                      }
                  }
                : {};

            let total = await db.database.collection('dkim').countDocuments(filter);

            let opts = {
                limit,
                query: filter,
                paginatedField: 'domain',
                sortAscending: true
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.database.collection('dkim'), opts);
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
                query,
                total,
                page,
                previousCursor: listing.hasPrevious ? listing.previous : false,
                nextCursor: listing.hasNext ? listing.next : false,
                results: (listing.results || []).map(dkimData => ({
                    id: dkimData._id.toString(),
                    domain: dkimData.domain,
                    selector: dkimData.selector,
                    description: dkimData.description,
                    fingerprint: dkimData.fingerprint,
                    created: dkimData.created
                }))
            };

            res.json(response);
            return next();
        })
    );

    /**
     * @api {get} /dkim/resolve/:domain Resolve ID for a DKIM domain
     * @apiName ResolveDKIM
     * @apiGroup DKIM
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} domain DKIM domain
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id DKIM unique ID (24 byte hex)
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/dkim/resolve/example.com
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "59fc66a03e54454869460e45"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This domain does not exist"
     *     }
     */
    server.get(
        '/dkim/resolve/:domain',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                domain: Joi.string()
                    .max(255)
                    //.hostname()
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
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            req.validate(roles.can(req.role).readAny('dkim'));

            let domain = tools.normalizeDomain(result.value.domain);

            let dkimData;

            try {
                dkimData = await db.database.collection('dkim').findOne(
                    {
                        domain
                    },
                    {
                        projection: { _id: 1 }
                    }
                );
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!dkimData) {
                res.json({
                    error: 'This domain does not exist',
                    code: 'DkimNotFound'
                });
                return next();
            }

            res.json({
                success: true,
                id: dkimData._id
            });

            return next();
        })
    );

    /**
     * @api {post} /dkim Create or update DKIM key for domain
     * @apiName PostDkim
     * @apiGroup DKIM
     * @apiDescription Add a new DKIM key for a Domain or update existing one. There can be single DKIM key
     * registered for each domain name.
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} domain Domain name this DKIM key applies to. Use <code>"\*"</code> as a special value that will be used for domains that do not have their own DKIM key set
     * @apiParam {String} selector Selector for the key
     * @apiParam {String} [description] Key description
     * @apiParam {String} [privateKey] Pem formatted DKIM private key. If not set then a new 2048 bit RSA key is generated, beware though that it can take several seconds to complete.
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the DKIM
     * @apiSuccess {String} domain The domain this DKIM key applies to
     * @apiSuccess {String} selector DKIM selector
     * @apiSuccess {String} description Key description
     * @apiSuccess {String} fingerprint Key fingerprint (SHA1)
     * @apiSuccess {String} publicKey Public key in DNS format (no prefix/suffix, single line)
     * @apiSuccess {Object} dnsTxt Value for DNS TXT entry
     * @apiSuccess {String} dnsTxt.name Is the domain name of TXT
     * @apiSuccess {String} dnsTxt.value Is the value of TXT
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/dkim \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "domain": "example.com",
     *       "selector": "oct17",
     *       "description": "Key for marketing emails",
     *       "privateKey": "-----BEGIN RSA PRIVATE KEY-----..."
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "59ef21aef255ed1d9d790e81",
     *       "domain": "example.com",
     *       "selector": "oct17",
     *       "description": "Key for marketing emails",
     *       "fingerprint": "6a:aa:d7:ba:e4:99:b4:12:e0:f3:35:01:71:d4:f1:d6:b4:95:c4:f5",
     *       "publicKey": "-----BEGIN PUBLIC KEY-----\r\nMIGfMA0...",
     *       "dnsTxt": {
     *         "name": "dec20._domainkey.example.com",
     *         "value": "v=DKIM1;t=s;p=MIGfMA0..."
     *       }
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This user does not exist"
     *     }
     */
    server.post(
        '/dkim',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                domain: Joi.string()
                    .max(255)
                    //.hostname()
                    .required(),
                selector: Joi.string()
                    .max(255)
                    //.hostname()
                    .trim()
                    .required(),
                privateKey: Joi.string()
                    .empty('')
                    .trim()
                    .regex(/^-----BEGIN (RSA )?PRIVATE KEY-----/, 'DKIM key format'),
                description: Joi.string()
                    .max(255)
                    //.hostname()
                    .trim(),
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
            req.validate(roles.can(req.role).createAny('dkim'));

            let response;

            try {
                response = await setDkim(result.value);
            } catch (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            if (response) {
                response.success = true;
            }

            res.json(response);
            return next();
        })
    );

    /**
     * @api {get} /dkim/:dkim Request DKIM information
     * @apiName GetDkimKey
     * @apiGroup DKIM
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} dkim ID of the DKIM
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the DKIM
     * @apiSuccess {String} domain The domain this DKIM key applies to
     * @apiSuccess {String} selector DKIM selector
     * @apiSuccess {String} description Key description
     * @apiSuccess {String} fingerprint Key fingerprint (SHA1)
     * @apiSuccess {String} publicKey Public key in DNS format (no prefix/suffix, single line)
     * @apiSuccess {Object} dnsTxt Value for DNS TXT entry
     * @apiSuccess {String} dnsTxt.name Is the domain name of TXT
     * @apiSuccess {String} dnsTxt.value Is the value of TXT
     * @apiSuccess {String} created Datestring
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/dkim/59ef21aef255ed1d9d790e7a
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "59ef21aef255ed1d9d790e7a",
     *       "domain": "example.com",
     *       "selector": "oct17",
     *       "description": "Key for marketing emails",
     *       "fingerprint": "6a:aa:d7:ba:e4:99:b4:12:e0:f3:35:01:71:d4:f1:d6:b4:95:c4:f5",
     *       "publicKey": "-----BEGIN PUBLIC KEY-----\r\nMIGfMA0...",
     *       "dnsTxt": {
     *         "name": "dec20._domainkey.example.com",
     *         "value": "v=DKIM1;t=s;p=MIGfMA0..."
     *       }
     *       "created": "2017-10-24T11:19:10.911Z"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This Alias does not exist"
     *     }
     */
    server.get(
        '/dkim/:dkim',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                dkim: Joi.string()
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
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            req.validate(roles.can(req.role).readAny('dkim'));

            let dkim = new ObjectID(result.value.dkim);

            let response;
            try {
                response = await getDkim({ _id: dkim }, false);
            } catch (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            if (response) {
                response.success = true;
            }

            res.json(response);
            return next();
        })
    );

    /**
     * @api {delete} /dkim/:dkim Delete a DKIM key
     * @apiName DeleteDkim
     * @apiGroup DKIM
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} dkim ID of the DKIM
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE http://localhost:8080/dkim/59ef21aef255ed1d9d790e81
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
     *       "error": "Database error"
     *     }
     */
    server.del(
        '/dkim/:dkim',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                dkim: Joi.string()
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
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            req.validate(roles.can(req.role).deleteAny('dkim'));

            let dkim = new ObjectID(result.value.dkim);

            let response;

            try {
                response = await delDkim({ _id: dkim });
            } catch (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            res.json({
                success: response
            });

            return next();
        })
    );
};
