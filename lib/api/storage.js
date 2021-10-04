'use strict';

const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const tools = require('../tools');
const roles = require('../roles');
const consts = require('../consts');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema } = require('../schemas');

module.exports = (db, server, storageHandler) => {
    server.post(
        '/users/:user/storage',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),

                filename: Joi.string().empty('').max(255),
                contentType: Joi.string().empty('').max(255),
                encoding: Joi.string().empty('').valid('base64'),
                content: Joi.binary().max(consts.MAX_ALLOWED_MESSAGE_SIZE).empty('').required(),

                sess: sessSchema,
                ip: sessIPSchema
            });

            if (!req.params.content && req.body && (Buffer.isBuffer(req.body) || typeof req.body === 'string')) {
                req.params.content = req.body;
            }

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
                req.validate(roles.can(req.role).createOwn('storage'));
            } else {
                req.validate(roles.can(req.role).createAny('storage'));
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

            let id = await storageHandler.add(user, result.value);

            res.json({
                success: !!id,
                id
            });
            return next();
        })
    );

    server.get(
        '/users/:user/storage',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                query: Joi.string().trim().empty('').max(255),
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
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('storage'));
            } else {
                req.validate(roles.can(req.role).readAny('storage'));
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

            let query = result.value.query;
            let limit = result.value.limit;
            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;

            let filter = (query && {
                'metadata.user': user,
                filename: {
                    $regex: tools.escapeRegexStr(query),
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

    server.del(
        '/users/:user/storage/:file',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                file: Joi.string().hex().lowercase().length(24).required(),
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

            let user = new ObjectId(result.value.user);

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).deleteOwn('storage'));
            } else {
                req.validate(roles.can(req.role).deleteAny('storage'));
            }

            let file = new ObjectId(result.value.file);
            await storageHandler.delete(user, file);

            res.json({
                success: true
            });
            return next();
        })
    );

    server.get(
        { name: 'storagefile', path: '/users/:user/storage/:file' },
        tools.asyncifyJson(async (req, res, next) => {
            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                file: Joi.string().hex().lowercase().length(24).required()
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
                req.validate(roles.can(req.role).readOwn('storage'));
            } else {
                req.validate(roles.can(req.role).readAny('storage'));
            }

            let user = new ObjectId(result.value.user);
            let file = new ObjectId(result.value.file);

            let fileData;
            try {
                fileData = await db.gridfs.collection('storage.files').findOne({
                    _id: file,
                    'metadata.user': user
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!fileData) {
                res.status(404);
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
