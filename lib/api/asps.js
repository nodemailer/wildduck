'use strict';

const config = require('wild-config');
const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;
const mobileconfig = require('mobileconfig');
const consts = require('../consts');
const certs = require('../certs').get('api.mobileconfig');

module.exports = (db, server, userHandler) => {
    server.get('/users/:user/asps', (req, res, next) => {
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
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);

        db.users.collection('users').findOne({
            _id: user
        }, {
            fields: {
                address: true
            }
        }, (err, userData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
                });
                return next();
            }
            if (!userData) {
                res.json({
                    error: 'This user does not exist'
                });
                return next();
            }

            db.users
                .collection('asps')
                .find({
                    user,
                    active: true,
                    $or: [
                        {
                            expires: false
                        },
                        {
                            expires: { $gt: new Date() }
                        }
                    ]
                })
                .sort({ _id: 1 })
                .toArray((err, asps) => {
                    if (err) {
                        res.json({
                            error: 'MongoDB Error: ' + err.message
                        });
                        return next();
                    }

                    if (!asps) {
                        asps = [];
                    }

                    res.json({
                        success: true,

                        results: asps.map(asp => ({
                            id: asp._id,
                            description: asp.description,
                            scopes: asp.scopes,
                            created: asp.created
                        }))
                    });

                    return next();
                });
        });
    });

    server.post('/users/:user/asps', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            description: Joi.string()
                .trim()
                .max(255)
                .required(),
            scopes: Joi.array()
                .items(
                    Joi.string()
                        .valid(...consts.SCOPES, '*')
                        .required()
                )
                .unique(),
            generateMobileconfig: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .default(false),
            sess: Joi.string().max(255),
            ip: Joi.string().ip({
                version: ['ipv4', 'ipv6'],
                cidr: 'forbidden'
            })
        });

        if (typeof req.params.scopes === 'string') {
            req.params.scopes = req.params.scopes
                .split(',')
                .map(scope => scope.trim())
                .filter(scope => scope);
        }

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let generateMobileconfig = result.value.generateMobileconfig;
        let scopes = result.value.scopes || ['*'];
        let description = result.value.description;

        if (scopes.includes('*')) {
            scopes = ['*'];
        }

        if (generateMobileconfig && !scopes.includes('*') && (!scopes.includes('imap') || !scopes.includes('smtp'))) {
            res.json({
                error: 'Profile file requires imap and smtp scopes'
            });
            return next();
        }

        db.users.collection('users').findOne({
            _id: user
        }, {
            fields: {
                username: true,
                name: true,
                address: true
            }
        }, (err, userData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
                });
                return next();
            }
            if (!userData) {
                res.json({
                    error: 'This user does not exist'
                });
                return next();
            }

            userHandler.generateASP(user, result.value, (err, result) => {
                if (err) {
                    res.json({
                        error: err.message
                    });
                    return next();
                }

                if (!generateMobileconfig) {
                    res.json({
                        success: true,
                        id: result.id,
                        password: result.password
                    });
                    return next();
                }

                let profileOpts = {};
                Object.keys(config.api.mobileconfig || {}).forEach(key => {
                    profileOpts[key] = (config.api.mobileconfig[key] || '')
                        .toString()
                        .replace(/\{email\}/g, userData.address)
                        .trim();
                });

                let options = {
                    displayName: description || profileOpts.displayName,
                    displayDescription: profileOpts.displayDescription,
                    accountDescription: profileOpts.accountDescription,
                    emailAddress: userData.address,
                    emailAccountName: userData.name,
                    identifier: profileOpts.identifier + '.' + userData.username,
                    imap: {
                        hostname: config.imap.setup.hostname,
                        port: config.imap.setup.port || config.imap.port,
                        secure: config.imap.setup.secure,
                        username: userData.username,
                        password: result.password
                    },
                    smtp: {
                        hostname: config.smtp.setup.hostname,
                        port: config.smtp.setup.port || config.smtp.port,
                        secure: true, //config.setup.smtp.secure,
                        username: userData.username,
                        password: false // use the same password as for IMAP
                    },
                    keys: certs
                };

                mobileconfig.getSignedEmailConfig(options, (err, data) => {
                    if (err) {
                        res.json({
                            error: err.message
                        });
                        return next();
                    }

                    res.json({
                        success: true,
                        id: result.id,
                        password: result.password,
                        mobileconfig: data.toString('base64')
                    });
                    return next();
                });
            });
        });
    });

    server.del('/users/:user/asps/:asp', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            asp: Joi.string()
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
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let asp = new ObjectID(result.value.asp);

        userHandler.deleteASP(user, asp, result.value, err => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }
            res.json({
                success: true
            });
            return next();
        });
    });
};
