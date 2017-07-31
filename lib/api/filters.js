'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;
const urllib = require('url');

module.exports = (db, server) => {
    server.get('/users/:user/filters', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string().hex().lowercase().length(24).required()
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
                            error: 'MongoDB Error: ' + err.message
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
                                    error: 'MongoDB Error: ' + err.message
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
        });
    });

    server.get('/users/:user/filters/:filter', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string().hex().lowercase().length(24).required(),
            filter: Joi.string().hex().lowercase().length(24).required()
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
        let filter = new ObjectID(result.value.filter);

        db.database.collection('filters').findOne({
            _id: filter,
            user
        }, (err, filterData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
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
                            error: 'MongoDB Error: ' + err.message
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
        });
    });

    server.del('/users/:user/filters/:filter', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string().hex().lowercase().length(24).required(),
            filter: Joi.string().hex().lowercase().length(24).required()
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
        let filter = new ObjectID(result.value.filter);

        db.database.collection('filters').deleteOne({
            _id: filter,
            user
        }, (err, r) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
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
        });
    });

    server.post('/users/:user/filters', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string().hex().lowercase().length(24).required(),

            name: Joi.string().trim().max(255).empty(''),

            query_from: Joi.string().trim().max(255).empty(''),
            query_to: Joi.string().trim().max(255).empty(''),
            query_subject: Joi.string().trim().max(255).empty(''),
            query_text: Joi.string().trim().max(255).empty(''),
            query_ha: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
            query_size: Joi.number().empty(''),

            action_seen: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
            action_flag: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
            action_delete: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
            action_spam: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),

            action_mailbox: Joi.string().hex().lowercase().length(24).empty(''),
            action_forward: Joi.string().email().empty(''),
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
                error: result.error.message
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
            db.database.collection('mailboxes').findOne({
                _id: new ObjectID(result.value.action_mailbox),
                user
            }, (err, mailboxData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
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
            });
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

                db.database.collection('filters').insertOne(filterData, (err, r) => {
                    if (err) {
                        res.json({
                            error: 'MongoDB Error: ' + err.message
                        });
                        return next();
                    }

                    res.json({
                        success: !!r.insertedCount,
                        id: filterData._id
                    });
                    return next();
                });
            });
        });
    });

    server.put('/users/:user/filters/:filter', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string().hex().lowercase().length(24).required(),
            filter: Joi.string().hex().lowercase().length(24).required(),

            name: Joi.string().trim().max(255).empty(''),

            query_from: Joi.string().trim().max(255).empty(''),
            query_to: Joi.string().trim().max(255).empty(''),
            query_subject: Joi.string().trim().max(255).empty(''),
            query_text: Joi.string().trim().max(255).empty(''),
            query_ha: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
            query_size: Joi.number().empty(''),

            action_seen: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
            action_flag: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
            action_delete: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
            action_spam: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),

            action_mailbox: Joi.string().hex().lowercase().length(24).empty(''),
            action_forward: Joi.string().email().empty(''),
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
                error: result.error.message
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
            db.database.collection('mailboxes').findOne({
                _id: new ObjectID(result.value.action_mailbox),
                user
            }, (err, mailboxData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
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
            });
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
                        error: 'MongoDB Error: ' + err.message
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
