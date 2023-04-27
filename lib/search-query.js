'use strict';

const SearchString = require('search-string');
const parser = require('logic-query-parser');
const { escapeRegexStr } = require('./tools');
const { ObjectId } = require('mongodb');

function parseSearchQuery(queryStr) {
    const queryTree = parser.parse(queryStr);

    let result = [];

    let walkQueryTree = (node, branch, opts) => {
        switch (node.lexeme && node.lexeme.type) {
            case 'and': {
                let leafNode;
                if (opts.condType === 'and') {
                    leafNode = branch;
                } else {
                    let node = { $and: [] };
                    branch.push(node);
                    leafNode = node.$and;
                }

                if (node.left) {
                    if (
                        node.left?.lexeme?.type === 'string' &&
                        typeof node.left.lexeme.value === 'string' &&
                        node.left.lexeme.value.length > 1 &&
                        node.left.lexeme.value.at(-1) === ':' &&
                        node.right?.lexeme?.type === 'and' &&
                        node.right.left?.lexeme?.type === 'string' &&
                        node.right.left.lexeme.value
                    ) {
                        //
                        node.left.lexeme.value += `"${node.right.left.lexeme.value}"`;
                        node.right = node.right.right;
                    }

                    walkQueryTree(
                        node.left,
                        leafNode,
                        Object.assign({}, opts, {
                            condType: 'and'
                        })
                    );
                }

                if (node.right) {
                    walkQueryTree(
                        node.right,
                        leafNode,
                        Object.assign({}, opts, {
                            condType: 'and'
                        })
                    );
                }

                return;
            }

            case 'or': {
                let leafNode;
                if (opts.condType === 'or') {
                    leafNode = branch;
                } else {
                    let node = { $or: [] };
                    branch.push(node);
                    leafNode = node.$or;
                }

                if (node.left) {
                    walkQueryTree(
                        node.left,
                        leafNode,
                        Object.assign({}, opts, {
                            condType: 'or'
                        })
                    );
                }
                if (node.right) {
                    walkQueryTree(
                        node.right,
                        leafNode,
                        Object.assign({}, opts, {
                            condType: 'or'
                        })
                    );
                }

                return;
            }

            case 'string':
                {
                    const searchString = SearchString.parse(`${opts.negated ? '-' : ''}${node.lexeme.value}`);
                    let parsedQuery = searchString.getParsedQuery();

                    node.parsed = { searchString, parsedQuery };

                    let keywords = {};
                    if (parsedQuery) {
                        for (let key of Object.keys(parsedQuery)) {
                            if (key === 'exclude') {
                                for (let subKey of Object.keys(parsedQuery[key])) {
                                    keywords[subKey] = { value: parsedQuery[key][subKey].flatMap(entry => entry).shift(), negated: true };
                                }
                            } else if (Array.isArray(parsedQuery[key])) {
                                keywords[key] = { value: parsedQuery[key].flatMap(entry => entry).shift(), negated: false };
                            }
                        }
                    }

                    let negated = opts.negated;

                    let textValue =
                        searchString
                            .getTextSegments()
                            .flatMap(entry => {
                                negated = entry.negated ? !opts.negated : !!opts.negated;

                                return entry.text;
                            })
                            .join(' ') || null;

                    const leafNode = {
                        text: textValue ? { value: textValue, negated } : null,
                        keywords: Object.keys(keywords).length ? keywords : null,
                        value: node.lexeme.value
                    };
                    branch.push(leafNode);
                }
                break;
        }
    };

    walkQueryTree(queryTree, result, { condType: 'and' });

    return result;
}

const getMongoDBQuery = async (db, user, queryStr) => {
    const parsed = parseSearchQuery(queryStr);

    let walkTree = async node => {
        if (Array.isArray(node)) {
            let branches = [];
            for (let entry of node) {
                branches.push(await walkTree(entry));
            }
            return branches;
        }

        if (node.$and && node.$and.length) {
            let branch = {
                $and: []
            };

            for (let entry of node.$and) {
                let subBranch = await walkTree(entry);
                branch.$and = branch.$and.concat(subBranch || []);
            }

            return branch;
        } else if (node.$or && node.$or.length) {
            let branch = {
                $or: []
            };

            for (let entry of node.$or) {
                let subBranch = await walkTree(entry);

                branch.$or = branch.$or.concat(subBranch || []);
            }

            return branch;
        } else if (node.text) {
            let branch = {
                $text: {
                    $search: node.text.value
                }
            };

            if (node.text.negated) {
                branch = { $not: branch };
            }

            return branch;
        } else if (node.keywords) {
            let branches = [];

            let keyword = Object.keys(node.keywords || {}).find(key => key && key !== 'negated');
            if (keyword) {
                let { value, negated } = node.keywords[keyword];
                switch (keyword) {
                    case 'from':
                    case 'subject':
                        {
                            let regex = escapeRegexStr(value);
                            let branch = {
                                headers: {
                                    $elemMatch: {
                                        key: keyword,
                                        value: {
                                            $regex: regex,
                                            $options: 'i'
                                        }
                                    }
                                }
                            };
                            if (negated) {
                                branch = { $not: branch };
                            }
                            branches.push(branch);
                        }
                        break;

                    case 'to':
                        {
                            let regex = escapeRegexStr(value);
                            for (let toKey of ['to', 'cc', 'bcc']) {
                                let branch = {
                                    headers: {
                                        $elemMatch: {
                                            key: toKey,
                                            value: {
                                                $regex: regex,
                                                $options: 'i'
                                            }
                                        }
                                    }
                                };
                                if (negated) {
                                    branch = { $not: branch };
                                }
                                branches.push(branch);
                            }
                        }
                        break;

                    case 'in': {
                        value = (value || '').toString().trim();
                        let resolveQuery = { user, $or: [] };
                        if (/^[0-9a-f]{24}$/i.test(value)) {
                            resolveQuery.$or.push({ _id: new ObjectId(value) });
                        } else if (/^Inbox$/i.test(value)) {
                            resolveQuery.$or.push({ path: 'INBOX' });
                        } else {
                            resolveQuery.$or.push({ path: value });
                            if (/^\/?(spam|junk)/i.test(value)) {
                                resolveQuery.$or.push({ specialUse: '\\Junk' });
                            } else if (/^\/?(sent)/i.test(value)) {
                                resolveQuery.$or.push({ specialUse: '\\Sent' });
                            } else if (/^\/?(trash|deleted)/i.test(value)) {
                                resolveQuery.$or.push({ specialUse: '\\Trash' });
                            } else if (/^\/?(drafts)/i.test(value)) {
                                resolveQuery.$or.push({ specialUse: '\\Drafts' });
                            }
                        }

                        let mailboxEntry = await db.database.collection('mailboxes').findOne(resolveQuery, { project: { _id: -1 } });

                        let branch = { mailbox: mailboxEntry ? mailboxEntry._id : new ObjectId('0'.repeat(24)) };
                        if (negated) {
                            branch = { $not: branch };
                        }
                        branches.push(branch);

                        break;
                    }

                    case 'thread':
                        {
                            value = (value || '').toString().trim();
                            if (/^[0-9a-f]{24}$/i.test(value)) {
                                let branch = { thread: new ObjectId(value) };
                                if (negated) {
                                    branch = { $not: branch };
                                }
                                branches.push(branch);
                            }
                        }
                        break;

                    case 'has': {
                        switch (value) {
                            case 'attachment': {
                                branches.push({ ha: true });
                                break;
                            }
                        }
                    }
                }
            }

            return branches;
        }
    };

    if (parsed && parsed.length) {
        return Object.assign({ user: null }, await walkTree(Array.isArray(parsed) ? { $and: parsed } : parsed), { user });
    }

    return { user: false };
};

module.exports = { parseSearchQuery, getMongoDBQuery };

/*
const util = require('util');

let main = () => {
    let db = require('./db');
    db.connect(() => {
        let run = async () => {
            let queries = ['from:"amy namy" kupi in:spam to:greg has:attachment -subject:"dinner and movie tonight" (jupi OR subject:tere)'];

            for (let query of queries) {
                console.log(util.inspect({ query, parsed: parseSearchQuery(query) }, false, 22, true));
                console.log(util.inspect({ query, parsed: await getMongoDBQuery(db, new ObjectId('64099fff101ca2ef6aad8be7'), query) }, false, 22, true));
            }
        };

        run();
    });
};
main();
*/
