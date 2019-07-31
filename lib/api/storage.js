'use strict';

const Joi = require('../joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const roles = require('../roles');
const consts = require('../consts');

module.exports = (db, server, storageHandler) => {
    /**
     * @api {post} /users/:user/storage Upload File
     * @apiName UploadStorage
     * @apiGroup Storage
     * @apiDescription This method allows to upload an attachment to be linked from a draft
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {Binary} content Request body is the file itself. Make sure to use 'application/binary' as content-type for the request, otherwise the server might try to process the input
     * @apiParam {String} [filename] Filename
     * @apiParam {String} [contentType] MIME type for the file
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Object} id File ID
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Upload a file from disk:
     *     curl -i -XPOST "http://localhost:8080/users/5c404c9ec1933085b59e7574/storage?filename=00-example.duck.png" \
     *     -H 'Content-type: application/binary' \
     *     --data-binary "@emails/00-example.duck.png"
     *
     * @apiExample {curl} Upload a string:
     *     curl -i -XPOST "http://localhost:8080/users/5c404c9ec1933085b59e7574/storage?filename=hello.txt" \
     *     -H 'Content-type: application/binary' \
     *     -d "Hello world!"
     *
     * @apiSuccessExample {json} Forward Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "5a2f9ca57308fc3a6f5f811e"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
    server.post(
        '/users/:user/storage',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),

                filename: Joi.string()
                    .empty('')
                    .max(255),
                contentType: Joi.string()
                    .empty('')
                    .max(255),
                encoding: Joi.string()
                    .empty('')
                    .valid('base64'),
                content: Joi.binary()
                    .max(consts.MAX_ALLOWED_MESSAGE_SIZE)
                    .empty('')
                    .required(),

                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            Object.keys(req.query || {}).forEach(key => {
                if (!(key in req.params)) {
                    req.params[key] = req.query[key];
                }
            });

            if (!req.params.content && req.body && (Buffer.isBuffer(req.body) || typeof req.body === 'string')) {
                req.params.content = req.body;
            }

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
                req.validate(roles.can(req.role).createOwn('storage'));
            } else {
                req.validate(roles.can(req.role).createAny('storage'));
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

            let id = await storageHandler.add(user, result.value);

            res.json({
                success: !!id,
                id
            });
            return next();
        })
    );

    /**
     * @api {get} /users/:user/storage List stored files
     * @apiName GetStorage
     * @apiGroup Storage
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} [query] Partial match of a filename
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
     * @apiSuccess {Object[]} results File listing
     * @apiSuccess {String} results.id ID of the File
     * @apiSuccess {String} results.filename Filename
     * @apiSuccess {String} results.contentType Content-Type of the file
     * @apiSuccess {Number} results.size File size
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/users/59fc66a03e54454869460e45/storage
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
     *           "filename": "hello.txt",
     *           "size": 1024
     *         },
     *         {
     *           "id": "59ef21aef255ed1d9d790e82",
     *           "filename": "finances.xls",
     *           "size": 2084
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
        '/users/:user/storage',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                query: Joi.string()
                    .trim()
                    .empty('')
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

            req.query.user = req.params.user;
            const result = Joi.validate(req.query, schema, {
                abortEarly: false,
                convert: true,
                allowUnknown: true
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
                req.validate(roles.can(req.role).readOwn('storage'));
            } else {
                req.validate(roles.can(req.role).readAny('storage'));
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

            let query = result.value.query;
            let limit = result.value.limit;
            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;

            let filter = (query && {
                'metadata.user': user,
                filename: {
                    $regex: query.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'),
                    $options: ''
                }
            }) || {
                'metadata.user': user
            };

            let total = await db.gridfs.collection('storage.files').countDocuments(filter);

            let opts = {
                limit,
                query: filter,
                paginatedField: 'filename',
                sortAscending: true
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.gridfs.collection('storage.files'), opts);
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
                results: (listing.results || []).map(fileData => ({
                    id: fileData._id.toString(),
                    filename: fileData.filename || false,
                    contentType: fileData.contentType || false,
                    size: fileData.length,
                    created: fileData.uploadDate.toISOString(),
                    md5: fileData.md5
                }))
            };

            res.json(response);
            return next();
        })
    );

    /**
     * @api {delete} /users/:user/storage/:file Delete a File
     * @apiName DeleteStorage
     * @apiGroup Storage
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} address ID of the File
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE http://localhost:8080/users/59ef21aef255ed1d9d790e7a/storage/59ef21aef255ed1d9d790e81
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
     *       "error": "Trying to delete main address. Set a new main address first"
     *     }
     */
    server.del(
        '/users/:user/storage/:file',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                file: Joi.string()
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

            let user = new ObjectID(result.value.user);

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).deleteOwn('storage'));
            } else {
                req.validate(roles.can(req.role).deleteAny('storage'));
            }

            let file = new ObjectID(result.value.file);
            await storageHandler.delete(user, file);

            res.json({
                success: true
            });
            return next();
        })
    );

    /**
     * @api {get} /users/:user/storage/:file Download File
     * @apiName GetStorageFile
     * @apiGroup Storage
     * @apiDescription This method returns stored file contents in binary form
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} file ID of the File
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/storage/59fc66a13e54454869460e57"
     *
     * @apiSuccessExample {text} Success-Response:
     *     HTTP/1.1 200 OK
     *     Content-Type: image/png
     *
     *     <89>PNG...
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This attachment does not exist"
     *     }
     */
    server.get(
        { name: 'storagefile', path: '/users/:user/storage/:file' },
        tools.asyncifyJson(async (req, res, next) => {
            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                file: Joi.string()
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
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('storage'));
            } else {
                req.validate(roles.can(req.role).readAny('storage'));
            }

            let user = new ObjectID(result.value.user);
            let file = new ObjectID(result.value.file);

            let fileData;
            try {
                fileData = await db.gridfs.collection('storage.files').findOne({
                    _id: file,
                    'metadata.user': user
                });
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!fileData) {
                res.json({
                    error: 'This file does not exist',
                    code: 'FileNotFound'
                });
                return next();
            }

            res.writeHead(200, {
                'Content-Type': fileData.contentType || 'application/octet-stream'
            });

            let stream = storageHandler.gridstore.openDownloadStream(file);

            stream.once('error', err => {
                try {
                    res.end(err.message);
                } catch (err) {
                    //ignore
                }
            });

            stream.pipe(res);
        })
    );
};
