'use strict';

const Indexer = require('./indexer/indexer');
let indexer = new Indexer();

module.exports.matchSearchQuery = matchSearchQuery;

let queryHandlers = {

    // atom beautify uses invalid indentation that messes up shorthand methods
    /*eslint-disable object-shorthand */

    // always matches
    all: function () {
        return true;
    },

    // matches if the message object includes (exists:true) or does not include (exists:false) specifiec flag
    flag: function (message, query) {
        let pos = [].concat(message.flags || []).indexOf(query.value);
        return query.exists ? pos >= 0 : pos < 0;
    },

    // matches message receive date
    internaldate: function (message, query) {
        switch (query.operator) {
            case '<':
                return getShortDate(message.internaldate) < getShortDate(query.value);
            case '=':
                return getShortDate(message.internaldate) === getShortDate(query.value);
            case '>=':
                return getShortDate(message.internaldate) >= getShortDate(query.value);
        }
        return false;
    },

    // matches message header date
    date: function (message, query) {
        let mimeTree = message.mimeTree;
        if (!mimeTree) {
            mimeTree = indexer.parseMimeTree(message.raw);
        }

        let date = mimeTree.parsedHeader.date || message.internaldate;
        switch (query.operator) {
            case '<':
                return getShortDate(date) < getShortDate(query.value);
            case '=':
                return getShortDate(date) === getShortDate(query.value);
            case '>=':
                return getShortDate(date) >= getShortDate(query.value);
        }

        return false;
    },

    // matches message body
    body: function (message, query) {
        let body = (message.raw || '').toString();
        let bodyStart = body.match(/\r?\r?\n/);
        if (!bodyStart) {
            return false;
        }
        return body.substr(bodyStart.index + bodyStart[0].length).toLowerCase().indexOf((query.value || '').toString().toLowerCase()) >= 0;
    },

    // matches message source
    text: function (message, query) {
        return (message.raw || '').toString().toLowerCase().indexOf((query.value || '').toString().toLowerCase()) >= 0;
    },

    // matches message UID number. Sequence queries are also converted to UID queries
    uid: function (message, query) {
        return query.value.indexOf(message.uid) >= 0;
    },

    // matches message source size
    size: function (message, query) {
        let raw = message.raw || '';

        switch (query.operator) {
            case '<':
                return raw.length < query.value;
            case '=':
                return raw.length === query.value;
            case '>':
                return raw.length > query.value;
        }

        return false;
    },

    // matches message headers
    header: function (message, query) {
        let mimeTree = message.mimeTree;
        if (!mimeTree) {
            mimeTree = indexer.parseMimeTree(message.raw || '');
        }

        let headers = (mimeTree.header || []);
        let header = query.header;
        let term = (query.value || '').toString().toLowerCase();
        let key, value, parts;

        for (let i = 0, len = headers.length; i < len; i++) {
            parts = headers[i].split(':');
            key = (parts.shift() || '').trim().toLowerCase();

            if (/^X-Attachment-Stream/i.test(key)) {
                // skip special headers
                continue;
            }

            value = (parts.join(':') || '');

            if (key === header && (!term || value.toLowerCase().indexOf(term) >= 0)) {
                return true;
            }
        }

        return false;
    },

    // matches messages with modifyIndex exual or greater than criteria
    modseq: function (message, query) {
        return message.modseq >= query.value;
    },

    // charset argument is ignored
    charset: function () {
        return true;
    }

    /*eslint-enable object-shorthand */
};

/**
 * Returns a date object with time set to 00:00 on UTC timezone
 *
 * @param {String|Date} date Date to convert
 * @returns {Date} Date object without time
 */
function getShortDate(date) {
    date = date || new Date();
    if (typeof date === 'string' || typeof date === 'number') {
        date = new Date(date);
    }
    return date.toISOString().substr(0, 10);
}

/**
 * Checks if a specific search term match the message or not
 *
 * @param {Object} message Stored message object
 * @param {Object} query Query term object
 * @returns {Boolean} Term matched (true) or not (false)
 */
function matchSearchTerm(message, query) {

    if (Array.isArray(query)) {
        // AND, all terms need to match
        return matchSearchQuery(message, query);
    }

    if (!query || typeof query !== 'object') {
        // unknown query term
        return false;
    }

    switch (query.key) {
        case 'or':
            // OR, only single match needed
            for (let i = query.value.length - 1; i >= 0; i--) {
                if (matchSearchTerm(message, query.value[i])) {
                    return true;
                }
            }
            return false;
        case 'not':
            // return reverse match
            return !matchSearchTerm(message, query.value);
        default:
            // check if there is a handler for the term and use it
            if (queryHandlers.hasOwnProperty(query.key)) {
                return queryHandlers[query.key](message, query);
            }
            return false;
    }
}

/**
 * Traverses query tree and checks if all query terms match or not. Stops on first false match occurence
 *
 * @param {Object} message Stored message object
 * @param {Object} query Query term object
 * @returns {Boolean} Term matched (true) or not (false)
 */
function matchSearchQuery(message, query) {
    if (!Array.isArray(query)) {
        query = [].concat(query || []);
    }

    for (let i = 0, len = query.length; i < len; i++) {
        if (!matchSearchTerm(message, query[i])) {
            return false;
        }
    }

    return true;
}
