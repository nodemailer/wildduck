/* eslint no-control-regex: 0 */
'use strict';

const os = require('os');
const punycode = require('punycode/');
const libmime = require('libmime');
const consts = require('./consts');
const errors = require('./errors');
const fs = require('fs');
const he = require('he');
const pathlib = require('path');
const crypto = require('crypto');
const urllib = require('url');
const net = require('net');
const ipaddr = require('ipaddr.js');
const ObjectId = require('mongodb').ObjectId;
const log = require('npmlog');
const addressparser = require('nodemailer/lib/addressparser');
const yaml = require('js-yaml');

let templates = false;

const structuredCloneWrapper = typeof structuredClone === 'function' ? structuredClone : obj => JSON.parse(JSON.stringify(obj));

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
            // TODO: group into AND conditions, otherwise expands too much!
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
            domain = punycode.toUnicode(domain).normalize('NFC').toLowerCase().trim();
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

    let user = address.address.substr(0, address.address.lastIndexOf('@')).normalize('NFC').toLowerCase().trim();

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
        result.unshift(username.substr(0, i) + '*@' + domain);
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

function flatAddresses(addresses) {
    let list = [];
    let walk = address => {
        if (address.address) {
            list.push(address);
        } else if (address.group) {
            address.group.forEach(walk);
        }
    };
    walk(addresses);
    return list;
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

    if (typeof value === 'object' && ObjectId.isValid(value)) {
        return true;
    }

    if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value) && ObjectId.isValid(value)) {
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

function validationErrors(validationResult) {
    const errors = {};
    if (validationResult.error && validationResult.error.details) {
        validationResult.error.details.forEach(detail => {
            if (!errors[detail.path]) {
                errors[detail.path] = detail.message;
            }
        });
    }
    return errors;
}

function checkSocket(socket) {
    if (!socket || socket.destroyed || socket.readyState !== 'open') {
        throw new Error('Socket not open');
    }
}

function getHostname(req) {
    let host =
        []
            .concat(req.headers.host || [])
            .concat(req.authority || [])
            .concat(req.ip || [])
            .shift() || '';
    host = host.split(':').shift();

    if (host) {
        host = normalizeDomain(host);
    }

    return host;
}

function normalizeIp(ip) {
    ip = (ip || '').toString().toLowerCase().trim();

    if (/^[a-f0-9:]+:(\d+\.){3}\d+$/.test(ip)) {
        // remove pseudo IPv6 prefix
        ip = ip.replace(/^[a-f0-9:]+:((\d+\.){3}\d+)$/, '$1');
    }

    if (net.isIPv6(ip)) {
        // use the short version
        return ipaddr.parse(ip).toString();
    }

    return ip;
}

function prepareArmoredPubKey(pubKey) {
    pubKey = (pubKey || '').toString().replace(/\r?\n/g, '\n').trim();
    if (/^-----[^-]+-----\n/.test(pubKey) && !/\n\n/.test(pubKey)) {
        // header is missing, add blank line after first newline
        pubKey = pubKey.replace(/\n/, '\n\n');
    }
    return pubKey;
}

function getPGPUserId(pubKey) {
    let name = '';
    let address = '';

    if (!pubKey || !pubKey.users || !pubKey.users.length) {
        return { name, address };
    }

    let userData = pubKey.users.find(u => u && u.userID && (u.userID.userID || u.userID.name || u.userID.email));
    if (!userData) {
        return { name, address };
    }

    name = userData.userID.name || '';
    address = userData.userID.address || '';

    if (!name || !address) {
        let user = addressparser(userData.userID.userID);
        if (user && user.length) {
            if (!address && user[0].address) {
                address = normalizeAddress(user[0].address);
            }
            if (!name && user[0].name) {
                try {
                    name = libmime.decodeWords(user[0].name || '').trim();
                } catch (E) {
                    // failed to parse value
                    name = user[0].name || '';
                }
            }
        }
    }

    return { name, address };
}

function formatFingerprint(fingerprint) {
    if (typeof fingerprint === 'string') {
        return fingerprint.match(/.{1,2}/g).join(':');
    }

    let out = [];
    for (let nr of fingerprint) {
        out.push((nr < 0x10 ? '0' : '') + nr.toString(16).toLowerCase());
    }
    return out.join(':');
}

function getEnabled2fa(enabled2fa) {
    let list = Array.isArray(enabled2fa) ? enabled2fa : [].concat(enabled2fa ? 'totp' : []);

    if (list.includes('u2f')) {
        let listSet = new Set(list);
        listSet.delete('u2f'); // not supported anymore
        list = Array.from(listSet);
    }

    return list;
}

function roundTime(seconds) {
    let days = Math.floor(seconds / (24 * 3600));
    if (days) {
        return `${days} ${days === 1 ? 'day' : 'days'}`;
    }

    let hours = Math.floor(seconds / 3600);
    if (hours) {
        return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    }

    let minutes = Math.floor(seconds / 3600);
    if (minutes) {
        return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
    }

    return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
}

function parsePemBundle(bundle) {
    bundle = (bundle || '').toString().split(/\r?\n/).join('\x00');
    let matches = bundle.match(/[-]{3,}BEGIN [^-]+[-]{3,}.*?[-]{3,}END [^-]+[-]{3,}/g);
    if (matches) {
        matches = Array.from(matches).map(cert => cert.replace(/\x00/g, '\n') + '\n');
    }
    return matches;
}

function buildCertChain(cert, ca) {
    return [cert]
        .concat(ca || [])
        .flatMap(ca => ca)
        .map(ca => ca.trim() + '\n')
        .filter(ca => ca.trim())
        .join('\n');
}

// ignore function and symbol types
const joiTypeToOpenApiTypeMap = {
    any: 'object',
    number: 'number',
    link: 'string',
    boolean: 'boolean',
    date: 'string',
    string: 'string',
    binary: 'string'
};

function replaceWithRefs(reqBodyData) {
    if (reqBodyData.type === 'array') {
        const obj = reqBodyData.items;

        replaceWithRefs(obj);
    } else if (reqBodyData.type === 'object') {
        if (reqBodyData.objectName) {
            const objectName = reqBodyData.objectName;
            Object.keys(reqBodyData).forEach(key => {
                if (key !== '$ref') {
                    delete reqBodyData[key];
                }
            });
            reqBodyData.$ref = `#/components/schemas/${objectName}`;
        } else {
            for (const key in reqBodyData.properties) {
                replaceWithRefs(reqBodyData.properties[key]);
            }
        }
    } else if (reqBodyData.type === 'alternatives') {
        for (const obj in reqBodyData.oneOf) {
            replaceWithRefs(obj);
        }
    }
}

function parseComponetsDecoupled(component, components) {
    if (component.type === 'array') {
        const obj = structuredCloneWrapper(component.items); // copy

        if (obj.objectName) {
            for (const key in obj.properties) {
                parseComponetsDecoupled(obj.properties[key], components);
            }

            // in case the Array itself is marked as a separate object >
            const objectName = obj.objectName;
            components[objectName] = obj;
            delete components[objectName].objectName;
            // ^
        }
    } else if (component.type === 'object') {
        const obj = structuredCloneWrapper(component); // copy
        const objectName = obj.objectName;

        for (const key in obj.properties) {
            parseComponetsDecoupled(obj.properties[key], components);
        }

        if (objectName) {
            components[objectName] = obj;
            delete components[objectName].objectName;
        }
    } else if (component.oneOf) {
        // Joi object is of 'alternatives' types
        for (const obj in component.oneOf) {
            parseComponetsDecoupled({ ...obj }, components);
        }
    }
}

/**
 * Parse Joi Objects
 */
function parseJoiObject(path, joiObject, requestBodyProperties) {
    if (joiObject.type === 'object') {
        const fieldsMap = joiObject._ids._byKey;

        const data = {
            type: joiObject.type,
            description: joiObject._flags.description || '',
            properties: {},
            required: []
        };

        if (joiObject._flags.objectName) {
            data.objectName = joiObject._flags.objectName;
        }

        if (path) {
            requestBodyProperties[path] = data;
        } else if (Array.isArray(requestBodyProperties)) {
            requestBodyProperties.push(data);
        } else {
            requestBodyProperties.items = data;
        }

        for (const [key, value] of fieldsMap) {
            if (value.schema._flags.presence === 'required') {
                data.required.push(key);
            }
            parseJoiObject(key, value.schema, data.properties);
        }
    } else if (joiObject.type === 'alternatives') {
        const matches = joiObject.$_terms.matches;

        const data = {
            oneOf: [],
            description: joiObject._flags.description || ''
        };

        if (path) {
            requestBodyProperties[path] = data;
        } else if (Array.isArray(requestBodyProperties)) {
            requestBodyProperties.push(data);
        } else {
            requestBodyProperties.items = data;
        }

        for (const alternative of matches) {
            parseJoiObject(null, alternative.schema, data.oneOf);
        }
    } else if (joiObject.type === 'array') {
        const elems = joiObject?.$_terms.items;

        const data = {
            type: 'array',
            items: {},
            description: joiObject._flags.description || ''
        };

        if (path) {
            requestBodyProperties[path] = data;
        } else if (Array.isArray(requestBodyProperties)) {
            requestBodyProperties.push(data);
        } else {
            requestBodyProperties.items = data;
        }
        parseJoiObject(null, elems[0], data);
    } else {
        const openApiType = joiTypeToOpenApiTypeMap[joiObject.type]; // even if type is object here then ignore and do not go recursive
        const isRequired = joiObject._flags.presence === 'required';
        const description = joiObject._flags.description || '';
        let format = undefined;

        if (!openApiType) {
            throw new Error('Unsupported type! Check API endpoint!');
        }

        if (joiObject.type !== openApiType) {
            // type has changed, so probably string, acquire format
            format = joiObject.type;
        }

        const data = { type: openApiType, description, required: isRequired };
        if (format) {
            data.format = format;
        }

        if (path) {
            requestBodyProperties[path] = data;
        } else if (Array.isArray(requestBodyProperties)) {
            requestBodyProperties.push(data);
        } else {
            requestBodyProperties.items = data;
        }
    }
}

module.exports = {
    normalizeAddress,
    normalizeDomain,
    normalizeIp,
    getHostname,
    getWildcardAddresses,
    redisConfig,
    checkRangeQuery,
    decodeAddresses,
    flatAddresses,
    getMailboxCounter,
    getEmailTemplates,
    getRelayData,
    isId,
    uview,
    escapeRegexStr,
    validationErrors,
    checkSocket,
    prepareArmoredPubKey,
    getPGPUserId,
    formatFingerprint,
    getEnabled2fa,
    roundTime,
    parsePemBundle,
    buildCertChain,

    formatMetaData: metaData => {
        if (typeof metaData === 'string') {
            try {
                metaData = JSON.parse(metaData);
            } catch (err) {
                // ignore
            }
        }
        return metaData || {};
    },

    responseWrapper(middleware) {
        return async (req, res) => {
            req._localId = crypto.randomBytes(8).toString('hex');
            try {
                await middleware(req, res);
            } catch (err) {
                let data = {
                    error: err.formattedMessage || err.message
                };

                switch (err.code) {
                    case 'ALREADYEXISTS':
                        err.responseCode = err.responseCode || 400;
                        err.code = 'MailboxExistsError';
                        break;
                    case 'NONEXISTENT':
                        err.responseCode = err.responseCode || 404;
                        err.code = 'NoSuchMailbox';
                        break;
                    case 'CANNOT':
                        err.responseCode = err.responseCode || 400;
                        err.code = 'DisallowedMailboxMethod';
                        break;
                }

                if (err.responseCode) {
                    res.status(err.responseCode);
                }

                if (err.code) {
                    data.code = err.code;
                }

                if (err.details && typeof err.details === 'object') {
                    for (let key of Object.keys(err.details)) {
                        if (!data[key]) {
                            data[key] = err.details[key];
                        }
                    }
                }

                log.http(
                    'Error',
                    `${req.method} ${req.url} sess=${(req.params && req.params.sess) || '-'} user=${req.user ? req.user : '-'} error=${JSON.stringify(
                        err.stack
                    )}`
                );

                res.charSet('utf-8');
                res.json(data);
            }
        };
    },

    async generateAPiDocs(routes) {
        let docs = `
openapi: 3.0.0
info:
    title: WildDuck API
    description: WildDuck API docs
    version: 1.0.0
    contact:
        url: 'https://github.com/nodemailer/wildduck'

servers:
    - url: 'https://api.wildduck.email'

tags:
    - name: Addresses
    - name: ApplicationPasswords
    - name: Archive
      description: Archive includes all deleted messages. Once messages are old enough then these are permanenetly deleted from the archive as well. Until then you can restore the deleted messages.
    - name: Audit
      description: 'Auditing allows to monitor an email account. All existing, deleted and new emails are copied to the auditing system. See also https://github.com/nodemailer/wildduck-audit-manager'
    - name: Authentication
    - name: Autoreplies
    - name: Certs
      description: WildDuck allows to register TLS certificates to be used with SNI connections. These certificates are used by IMAP, POP3, API and SMTP servers when a SNI capable client establishes a TLS connection. This does not apply for MX servers.
    - name: DKIM
      description: Whenever an email is sent WildDuck checks if there is a DKIM key registered for the domain name of the sender address and uses it to sign the message.
    - name: DomainAccess
      description: Add sender domain names to allowlist (messages are all accepted) or blocklist (messages are sent to Spam folder)
    - name: DomainAliases
    - name: Filters
    - name: Mailboxes
    - name: Messages
    - name: Settings
    - name: Storage
      description: Storage allows easier attachment handling when composing Draft messages. Instead of uploading the attachmnent with every draft update, you store the attachment to the Storage and then link stored file for the Draft.
    - name: Submission
    - name: TwoFactorAuth
    - name: Users
    - name: Webhooks\n`;
        const mapPathToMethods = {}; // map -> {path -> {post -> {}, put -> {}, delete -> {}, get -> {}}}

        for (const routePath in routes) {
            const route = routes[routePath];
            const { spec } = route;

            if (spec.exclude) {
                continue;
            }

            if (!mapPathToMethods[spec.path]) {
                mapPathToMethods[spec.path] = {};
            }

            mapPathToMethods[spec.path][spec.method.toLowerCase()] = {};
            const operationObj = mapPathToMethods[spec.path][spec.method.toLowerCase()];
            // 1) add tags
            operationObj.tags = spec.tags;

            // 2) add summary
            operationObj.summary = spec.summary || '';

            // 3) add description
            operationObj.description = spec.description || '';

            // 4) add operationId
            operationObj.operationId = spec.name || route.name;

            // 5) add requestBody
            const applicationType = spec.applicationType || 'application/json';
            operationObj.requestBody = {
                content: {
                    [applicationType]: {
                        schema: {
                            type: 'object',
                            properties: {}
                        }
                    }
                },
                required: true
            };

            for (const reqBodyKey in spec.validationObjs?.requestBody) {
                const reqBodyKeyData = spec.validationObjs.requestBody[reqBodyKey];

                parseJoiObject(reqBodyKey, reqBodyKeyData, operationObj.requestBody.content[applicationType].schema.properties);
            }

            // 6) add parameters (queryParams + pathParams).
            operationObj.parameters = [];
            for (const paramKey in spec.validationObjs?.pathParams) {
                const paramKeyData = spec.validationObjs.pathParams[paramKey];

                const obj = {};
                obj.name = paramKey;
                obj.in = 'path';
                obj.description = paramKeyData._flags.description || '';
                obj.required = paramKeyData._flags.presence === 'required';
                obj.schema = { type: paramKeyData.type };
                operationObj.parameters.push(obj);
            }

            for (const paramKey in spec.validationObjs?.queryParams) {
                const paramKeyData = spec.validationObjs.queryParams[paramKey];

                const obj = {};
                obj.name = paramKey;
                obj.in = 'query';
                obj.description = paramKeyData._flags.description || '';
                obj.required = paramKeyData._flags.presence === 'required';
                obj.schema = { type: paramKeyData.type };
                operationObj.parameters.push(obj);
            }

            // 7) add responses
            const responseType = spec.responseType || 'application/json';
            operationObj.responses = {};

            for (const resHttpCode in spec.validationObjs?.response) {
                const resBodyData = spec.validationObjs.response[resHttpCode];

                operationObj.responses[resHttpCode] = {
                    description: resBodyData.description || '',
                    content: {
                        [responseType]: {
                            schema: {}
                        }
                    }
                };

                const obj = operationObj.responses[resHttpCode];

                parseJoiObject('schema', resBodyData.model, obj.content[responseType]);
            }
        }

        const components = { components: { schemas: {} } };

        for (const path in mapPathToMethods) {
            // for every path
            const pathData = mapPathToMethods[path];

            for (const httpMethod in pathData) {
                // for every http method (post, put, get, delete)
                const innerData = pathData[httpMethod];

                // for every requestBody obj
                for (const key in innerData.requestBody.content[Object.keys(innerData.requestBody.content)[0]].schema.properties) {
                    const reqBodyData = innerData.requestBody.content[Object.keys(innerData.requestBody.content)[0]].schema.properties[key];

                    parseComponetsDecoupled(reqBodyData, components.components.schemas);
                    replaceWithRefs(reqBodyData);
                }

                // for every response object
                for (const key in innerData.responses) {
                    // key here is http method (2xx, 4xx, 5xx)
                    const obj = innerData.responses[key].content[Object.keys(innerData.responses[key].content)[0]].schema;
                    parseComponetsDecoupled(obj, components.components.schemas);
                    replaceWithRefs(obj);
                }
            }
        }

        // refify components that use other components
        for (const obj of Object.values(components.components.schemas)) {
            replaceWithRefs(obj);
        }

        const finalObj = { paths: mapPathToMethods };

        const mapPathToMethodsYaml = yaml.dump(finalObj, { indent: 4, lineWidth: -1, noRefs: true });
        const componentsYaml = yaml.dump(components, { indent: 4, lineWidth: -1, noRefs: true });

        docs += mapPathToMethodsYaml;
        docs += componentsYaml;

        docs += `
securitySchemes:
    AccessTokenAuth:
        name: X-Access-Token
        type: apiKey
        in: header
        description: |-
            If authentication is enabled in the WildDuck configuration, you will need to supply an access token in the \`X-Access-Token\` header.

            \`\`\`json
            {
                "X-Access-Token": "59fc66a03e54454869460e45"
            }
            \`\`\`
security:
- AccessTokenAuth: []
`;

        await fs.promises.writeFile(__dirname + '/../openapidocs.yml', docs);
    }
};
