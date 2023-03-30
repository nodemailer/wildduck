'use strict';

const SearchString = require('search-string');
const parser = require('logic-query-parser');

const { parse } = require('liqe');

const util = require('util');

function convertSearchQuery(queryStr, elasticSearch) {
    const queryTree = parser.parse(queryStr);

    let walkQueryTree = (node, branch) => {
        let leafNode;

        switch (node.lexeme && node.lexeme.type) {
            case 'or':
            case 'and':
                {
                    const leafBranch = [];
                    leafNode = { [node.lexeme.type]: leafBranch };

                    // TODO: convert parsed query to and/or tree
                }

                break;

            case 'string':
                {
                    const searchString = SearchString.parse(node.lexeme.value);
                    leafNode = {
                        text: searchString.getTextSegments(),
                        keywords: searchString.getParsedQuery(),
                        value: node.lexeme.value
                    };
                    branch.push(leafNode);
                }
                break;
        }

        if (node.lexeme && node.lexeme.type === 'string') {
            const searchString = SearchString.parse(node.lexeme.value);

            node.lexeme.text = searchString.getTextSegments();
            node.lexeme.keywords = searchString.getParsedQuery();
        }
        if (node.left) {
            walkQueryTree(node.left);
        }
        if (node.right) {
            walkQueryTree(node.right);
        }
    };

    //walkQueryTree(queryTree);

    console.log('------');
    console.log(queryStr);
    console.log(util.inspect(parse(queryStr), false, 22, true));
}

module.exports = { convertSearchQuery };

convertSearchQuery('from:amy');
convertSearchQuery('to:david');
convertSearchQuery('subject:dinner');

convertSearchQuery('from:amy OR from:david');

convertSearchQuery('(from:amy to:graig "wunder bar") OR from:david');

convertSearchQuery('dinner -movie');
convertSearchQuery('has:attachment');
