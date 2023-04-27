'use strict';

const util = require('util');
const SearchString = require('search-string');
const parser = require('logic-query-parser');

const isModifier = node => {
    if (node?.left?.lexeme?.type === 'string' && node?.left?.lexeme?.value?.at(-1) === ':' && node?.right) {
        let keyword = node.left.lexeme.value.substring(0, node.left.lexeme.value.length - 1);
        let negated = keyword.at(0) === '-';
        if (negated) {
            keyword = keyword.substring(1);
        }
        return keyword ? { keyword, negated } : null;
    }
};

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

                let queryModifier = isModifier(node);
                if (node.left) {
                    let subLeaf = [];

                    if (queryModifier) {
                        walkQueryTree(
                            node.right,
                            subLeaf,
                            Object.assign({}, opts, {
                                condType: 'and'
                            })
                        );
                    }

                    walkQueryTree(
                        node.left,
                        leafNode,
                        Object.assign({}, opts, {
                            condType: 'and'
                        })
                    );

                    if (queryModifier) {
                        let entry = leafNode.at(-1);

                        let subEntries = [];
                        if (entry?.keywords?.[queryModifier.keyword]?.value === '') {
                            for (let textEntry of subLeaf) {
                                if (textEntry?.text?.value) {
                                    subEntries.push({
                                        text: null,
                                        keywords: { [queryModifier.keyword]: textEntry?.text?.value, negated: textEntry?.text?.negated }
                                    });
                                }
                            }
                        }

                        leafNode.splice(-1, 1, ...subEntries);
                    }
                }
                if (node.right && !queryModifier) {
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

    console.log(util.inspect(queryTree, false, 22, true));

    return {
        query: queryStr,
        parsed: result
    };
}

const getMongoDBQuery = queryStr => {
    const parsed = parseSearchQuery(queryStr);

    const query = {};

    let walkTree = node => {};

    if (parsed && parsed.length) {
        walkTree(parsed[0]);
    }

    return query;
};

module.exports = { parseSearchQuery, getMongoDBQuery };

let queries = ['from:amy to:greg has:attachment subject:"dinner and movie tonight" OR subject:(dinner movie)'];

for (let query of queries) {
    console.log(util.inspect({ query, parsed: parseSearchQuery(query) }, false, 22, true));
}
