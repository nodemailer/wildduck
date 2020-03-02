'use strict';

const os = require('os');
const punycode = require('punycode');
const libmime = require('libmime');
const consts = require('./consts');
const errors = require('./errors');
const fs = require('fs');
const he = require('he');
const pathlib = require('path');
const crypto = require('crypto');
const urllib = require('url');
const net = require('net');
const ObjectID = require('mongodb').ObjectID;

let templates = false;

function checkRangeQuery(uids, ne) {
    // check if uids is a straight continous array and if such then return a range query,
    // otherwise retrun a $in query

    if (uids.length === 1) {
        return {
            [!ne ? '$eq' : '$ne']: uids[0]
        };
    }

    for (let i = 1, len = uids.length; i < len; i++) {
        if (uids[i] !== uids[i - 1] + 1) {
            return {
                [!ne ? '$in' : '$nin']: uids
            };
        }
    }

    if (!ne) {
        return {
            $gte: uids[0],
            $lte: uids[uids.length - 1]
        };
    } else {
        return {
            $not: {
                $gte: uids[0],
                $lte: uids[uids.length - 1]
            }
        };
    }
}

function normalizeDomain(domain) {
    domain = (domain || '').toLowerCase().trim();
    try {
        if (/^xn--/.test(domain)) {
            domain = punycode
                .toUnicode(domain)
                .normalize('NFC')
                .toLowerCase()
                .trim();
        }
    } catch (E) {
        // ignore
    }

    return domain;
}

function normalizeAddress(address, withNames, options) {
    if (typeof address === 'string') {
        address = {
            address
        };
    }
    if (!address || !address.address) {
        return '';
    }

    options = options || {};

    let removeLabel = typeof options.removeLabel === 'boolean' ? options.removeLabel : false;
    let removeDots = typeof options.removeDots === 'boolean' ? options.removeDots : false;

    let user = address.address
        .substr(0, address.address.lastIndexOf('@'))
        .normalize('NFC')
        .toLowerCase()
        .trim();

    if (removeLabel) {
        user = user.replace(/\+[^@]*$/, '');
    }

    if (removeDots) {
        user = user.replace(/\./g, '');
    }

    let domain = normalizeDomain(address.address.substr(address.address.lastIndexOf('@') + 1));

    let addr = user + '@' + domain;

    if (withNames) {
        return {
            name: address.name || '',
            address: addr
        };
    }

    return addr;
}

/**
 * Generate a list of possible wildcard addresses by generating all posible
 * substrings of the username email address part.
 *
 * @param {String} username - The username part of the email address.
 * @param {String} domain - The domain part of the email address.
 * @return {Array} The list of all possible username wildcard addresses,
 *   that would match this email address (as given by the params).
 */
function getWildcardAddresses(username, domain) {
    if (typeof username !== 'string' || typeof domain !== 'string') {
        return [];
    }

    let result = ['*@' + domain];
    // <= generates the 'simple' wildcard (a la '*@') address.
    for (let i = 1; i < Math.min(username.length, consts.MAX_ALLOWED_WILDCARD_LENGTH) + 1; i++) {
        result.unshift('*' + username.substr(-i) + '@' + domain);
        result.unshift(username.substr(0,i) + '*@' + domain);
    }

    return result;
}

// returns a redis config object with a retry strategy
function redisConfig(defaultConfig) {
    return defaultConfig;
}

function decodeAddresses(addresses) {
    addresses.forEach(address => {
        address.name = (address.name || '').toString();
        if (address.name) {
            try {
                address.name = libmime.decodeWords(address.name);
            } catch (E) {
                //ignore, keep as is
            }
        }
        if (/@xn--/.test(address.address)) {
            address.address =
                address.address.substr(0, address.address.lastIndexOf('@') + 1) +
                punycode.toUnicode(address.address.substr(address.address.lastIndexOf('@') + 1));
        }
        if (address.group) {
            decodeAddresses(address.group);
        }
    });
}

function getMailboxCounter(db, mailbox, type, done) {
    let prefix = type ? type : 'total';
    db.redis.get(prefix + ':' + mailbox.toString(), (err, sum) => {
        if (err) {
            return done(err);
        }

        if (sum !== null) {
            return done(null, Number(sum));
        }

        // calculate sum
        let query = { mailbox };
        if (type) {
            query[type] = true;
        }

        db.database.collection('messages').countDocuments(query, (err, sum) => {
            if (err) {
                return done(err);
            }

            // cache calculated sum in redis
            db.redis
                .multi()
                .set(prefix + ':' + mailbox.toString(), sum)
                .expire(prefix + ':' + mailbox.toString(), consts.MAILBOX_COUNTER_TTL)
                .exec(err => {
                    if (err) {
                        errors.notify(err);
                    }
                    done(null, sum);
                });
        });
    });
}

function renderEmailTemplate(tags, template) {
    let result = JSON.parse(JSON.stringify(template));

    let specialTags = {
        TIMESTAMP: Date.now(),
        HOSTNAME: tags.DOMAIN || os.hostname()
    };

    let walk = (node, nodeKey) => {
        if (!node) {
            return;
        }

        Object.keys(node || {}).forEach(key => {
            if (!node[key] || ['content'].includes(key)) {
                return;
            }

            if (Array.isArray(node[key])) {
                return node[key].forEach(child => walk(child, nodeKey));
            }

            if (typeof node[key] === 'object') {
                return walk(node[key], key);
            }

            if (typeof node[key] === 'string') {
                let isHTML = /html/i.test(key);
                node[key] = node[key].replace(/\[([^\]]+)\]/g, (match, tag) => {
                    if (tag in tags) {
                        return isHTML ? he.encode(tags[tag]) : tags[tag];
                    } else if (tag in specialTags) {
                        return isHTML ? he.encode((specialTags[tag] || '').toString()) : specialTags[tag];
                    }
                    return match;
                });
                return;
            }
        });
    };

    walk(result, false);

    return result;
}

async function getEmailTemplates(tags) {
    if (templates) {
        return templates.map(template => renderEmailTemplate(tags, template));
    }
    let templateFolder = pathlib.join(__dirname, '..', 'emails');
    let files = await fs.promises.readdir(templateFolder);

    files = files.sort((a, b) => a.localeCompare(b));

    let filesMap = new Map();

    for (let file of files) {
        let fParts = pathlib.parse(file);
        try {
            let value = await fs.promises.readFile(pathlib.join(templateFolder, file));

            let ext = fParts.ext.toLowerCase();
            let name = fParts.name.toLowerCase();
            if (name.indexOf('.') >= 0) {
                name = name.substr(0, name.indexOf('.'));
            }

            let type = false;
            switch (ext) {
                case '.json': {
                    try {
                        value = JSON.parse(value.toString('utf-8'));
                        type = 'message';
                    } catch (E) {
                        //ignore?
                    }
                    break;
                }
                case '.html':
                case '.htm':
                    value = value.toString('utf-8');
                    type = 'html';
                    break;
                case '.text':
                case '.txt':
                    value = value.toString('utf-8');
                    type = 'text';
                    break;
                default: {
                    if (name.length < fParts.name.length) {
                        type = 'attachment';
                        value = {
                            filename: fParts.base.substr(name.length + 1),
                            content: value.toString('base64'),
                            encoding: 'base64'
                        };
                    }
                }
            }

            if (type) {
                if (!filesMap.has(name)) {
                    filesMap.set(name, {});
                }
                if (type === 'attachment') {
                    if (!filesMap.get(name).attachments) {
                        filesMap.get(name).attachments = [value];
                    } else {
                        filesMap.get(name).attachments.push(value);
                    }
                } else {
                    filesMap.get(name)[type] = value;
                }
            }
        } catch (err) {
            // ignore
        }
    }

    let newTemplates = Array.from(filesMap)
        .map(entry => {
            let name = escapeRegexStr(entry[0]);
            entry = entry[1];
            if (!entry.message || entry.disabled) {
                return false;
            }

            if (entry.html) {
                entry.message.html = entry.html;
            }

            if (entry.text) {
                entry.message.text = entry.text;
            }

            if (entry.attachments) {
                entry.message.attachments = [].concat(entry.message.attachments || []).concat(entry.attachments);

                if (entry.message.html) {
                    entry.message.attachments.forEach(attachment => {
                        if (entry.message.html.indexOf(attachment.filename) >= 0) {
                            // replace html image link with a link to the attachment
                            let fname = escapeRegexStr(attachment.filename);
                            entry.message.html = entry.message.html.replace(
                                new RegExp('(["\'])(?:.\\/)?(?:' + name + '.)?' + fname + '(?=["\'])', 'g'),
                                (m, p) => {
                                    attachment.cid = attachment.cid || crypto.randomBytes(8).toString('hex') + '-[TIMESTAMP]@[DOMAIN]';
                                    return p + 'cid:' + attachment.cid;
                                }
                            );
                        }
                    });
                }
            }

            if (entry.text) {
                entry.message.text = entry.text;
            }

            return entry.message;
        })
        .filter(entry => entry && !entry.disabled);

    templates = newTemplates;
    return templates.map(template => renderEmailTemplate(tags, template));
}

function escapeRegexStr(string) {
    let specials = ['-', '[', ']', '/', '{', '}', '(', ')', '*', '+', '?', '.', '\\', '^', '$', '|'];
    return string.replace(RegExp('[' + specials.join('\\') + ']', 'g'), '\\$&');
}

function getRelayData(url) {
    let urlparts = urllib.parse(url);
    let targetMx = {
        host: urlparts.hostname,
        port: urlparts.port || 25,
        auth: urlparts.auth
            ? [urlparts.auth].map(auth => {
                  let parts = auth.split(':');
                  return {
                      user: decodeURIComponent(parts[0] || ''),
                      pass: decodeURIComponent(parts[1] || '')
                  };
              })[0]
            : false,
        secure: urlparts.protocol === 'smtps:',
        A: [].concat(net.isIPv4(urlparts.hostname) ? urlparts.hostname : []),
        AAAA: [].concat(net.isIPv6(urlparts.hostname) ? urlparts.hostname : [])
    };
    let data = {
        mx: [
            {
                priority: 0,
                mx: true,
                exchange: targetMx.host,
                A: targetMx.A,
                AAAA: targetMx.AAAA
            }
        ],
        mxPort: targetMx.port,
        mxAuth: targetMx.auth,
        mxSecure: targetMx.secure,
        url
    };

    return data;
}

function isId(value) {
    if (!value) {
        // obviously
        return false;
    }

    if (typeof value === 'object' && ObjectID.isValid(value)) {
        return true;
    }

    if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value) && ObjectID.isValid(value)) {
        return true;
    }

    return false;
}

function uview(address) {
    if (!address) {
        return '';
    }

    if (typeof address !== 'string') {
        address = address.toString() || '';
    }

    let atPos = address.indexOf('@');
    if (atPos < 0) {
        return address.replace(/\./g, '').toLowerCase();
    } else {
        return (address.substr(0, atPos).replace(/\./g, '') + address.substr(atPos)).toLowerCase();
    }
}

module.exports = {
    normalizeAddress,
    normalizeDomain,
    getWildcardAddresses,
    redisConfig,
    checkRangeQuery,
    decodeAddresses,
    getMailboxCounter,
    getEmailTemplates,
    getRelayData,
    isId,
    uview,
    escapeRegexStr,

    asyncifyJson: middleware => async (req, res, next) => {
        try {
            await middleware(req, res, next);
        } catch (err) {
            let data = {
                error: err.message
            };

            if (err.responseCode) {
                res.status(err.responseCode);
            }

            if (err.code) {
                data.code = err.code;
            }

            res.charSet('utf-8');
            res.json(data);
            return next();
        }
    }
};
