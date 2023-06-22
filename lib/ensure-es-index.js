'use strict';

const assert = require('assert');

const analyzer = {
    htmlStripAnalyzer: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase'],
        char_filter: ['html_strip']
    },
    filenameSearch: {
        tokenizer: 'filename',
        filter: ['lowercase']
    },
    filenameIndex: {
        tokenizer: 'filename',
        filter: ['lowercase', 'edgeNgram']
    }
};

const tokenizer = {
    filename: {
        pattern: '[^\\p{L}\\d]+',
        type: 'pattern'
    }
};

const filter = {
    edgeNgram: {
        side: 'front',
        max_gram: 20,
        min_gram: 1,
        type: 'edge_ngram'
    }
};

const mappings = {
    // user ID / ObjectId
    user: {
        type: 'keyword',
        ignore_above: 24
    },

    // mailbox folder ID / ObjectId
    mailbox: {
        type: 'keyword',
        ignore_above: 24
    },

    // Thread ID / ObjectId
    thread: {
        type: 'keyword',
        ignore_above: 24
    },

    // Folder UID
    uid: {
        type: 'long'
    },

    answered: {
        type: 'boolean'
    },

    // has attachments
    ha: {
        type: 'boolean'
    },

    attachments: {
        type: 'nested',
        properties: {
            cid: {
                type: 'keyword',
                ignore_above: 128
            },
            contentType: {
                type: 'keyword',
                ignore_above: 128
            },
            size: {
                type: 'long'
            },
            filename: {
                type: 'text',
                analyzer: 'filenameIndex',
                search_analyzer: 'filenameSearch'
            },
            id: {
                type: 'keyword',
                ignore_above: 128
            },
            disposition: {
                type: 'keyword',
                ignore_above: 128
            }
        }
    },

    bcc: {
        properties: {
            address: {
                type: 'keyword',
                ignore_above: 256
            },
            name: {
                type: 'text'
            }
        }
    },

    cc: {
        properties: {
            address: {
                type: 'keyword',
                ignore_above: 256
            },
            name: {
                type: 'text'
            }
        }
    },

    // Time when stored
    created: {
        type: 'date'
    },

    // Internal Date
    idate: {
        type: 'date'
    },

    // Header Date
    hdate: {
        type: 'date'
    },

    draft: {
        type: 'boolean'
    },

    flagged: {
        type: 'boolean'
    },

    flags: {
        type: 'keyword',
        ignore_above: 128
    },

    from: {
        properties: {
            address: {
                type: 'keyword',
                ignore_above: 256
            },
            name: {
                type: 'text'
            }
        }
    },

    headers: {
        type: 'nested',
        properties: {
            key: {
                type: 'keyword',
                ignore_above: 256
            },
            value: {
                type: 'text'
            }
        }
    },

    inReplyTo: {
        type: 'keyword',
        ignore_above: 998
    },

    msgid: {
        type: 'keyword',
        ignore_above: 998
    },

    replyTo: {
        properties: {
            address: {
                type: 'keyword',
                ignore_above: 256
            },
            name: {
                type: 'text'
            }
        }
    },

    size: {
        type: 'long'
    },

    subject: {
        type: 'text'
    },

    to: {
        properties: {
            name: {
                type: 'text'
            },
            address: {
                type: 'keyword',
                ignore_above: 256
            }
        }
    },

    unseen: {
        type: 'boolean'
    },

    html: {
        type: 'text',
        analyzer: 'htmlStripAnalyzer'
    },

    text: {
        type: 'text'
    },

    type: {
        type: 'constant_keyword',
        value: 'email'
    },

    modseq: {
        type: 'long'
    }
};

/**
 * Function to either create or update an index to match the definition
 * @param {Object} client ElasticSearch client object
 * @param {String} index Index name
 */
const ensureIndex = async (client, index, opts) => {
    const { mappings, analyzer, tokenizer, filter, aliases } = opts;

    let indexExistsRes = await client.indices.exists({ index });
    let indexExists = indexExistsRes && indexExistsRes.body;

    if (!indexExists || !indexExists) {
        // create new

        let indexOpts = {
            mappings: { properties: mappings }
        };

        if (analyzer || tokenizer || filter) {
            indexOpts.settings = {
                analysis: {
                    analyzer,
                    tokenizer,
                    filter
                }
            };
        }

        if (aliases) {
            indexOpts.aliases = aliases;
        }

        let createResultRes = await client.indices.create({ index, body: indexOpts });
        let createResult = createResultRes && createResultRes.body;

        assert(createResult && createResult.acknowledged);
        return { created: true };
    } else {
        let indexDataRes = await client.indices.get({ index });
        let indexData = indexDataRes && indexDataRes.body;

        if (!indexData || !indexData[index]) {
            throw new Error('Missing index data');
        }

        let changes = {};

        if (analyzer || tokenizer || filter) {
            // compare settings and update if needed
            let analysisData = (indexData[index].settings && indexData[index].settings.index && indexData[index].settings.index.analysis) || {};
            let missingAnalyzers = {};
            for (let key of Object.keys(analyzer || {})) {
                if (!analysisData.analyzer || !analysisData.analyzer[key]) {
                    missingAnalyzers[key] = analyzer[key];
                }
            }

            // found missing analyzers, update settings
            if (Object.keys(missingAnalyzers).length) {
                // index needs to be closed when changing analyser settings
                let closeResultRes = await client.indices.close({ index });
                let closeResult = closeResultRes && closeResultRes.body;

                assert(closeResult && closeResult.acknowledged);

                try {
                    let updateResultRes = await client.indices.putSettings({
                        index,
                        body: {
                            settings: {
                                analysis: {
                                    analyzer,
                                    tokenizer,
                                    filter
                                }
                            }
                        }
                    });
                    let updateResult = updateResultRes && updateResultRes.body;

                    assert(updateResult && updateResult.acknowledged);
                    changes.analyzers = true;
                } finally {
                    // try to open even if update failed
                    let openResultRes = await client.indices.open({ index });
                    let openResult = openResultRes && openResultRes.body;

                    assert(openResult && openResult.acknowledged);
                }
            }
        }

        // Compare mappings and add missing
        let storedMappings = (indexData[index].mappings && indexData[index].mappings.properties) || {};
        let missingMappings = {};
        for (let key of Object.keys(mappings)) {
            if (!storedMappings[key]) {
                missingMappings[key] = mappings[key];
            }
        }
        // Add missing mappings if needed
        if (Object.keys(missingMappings).length) {
            try {
                const updateResponseRes = await client.indices.putMapping({
                    index,
                    body: { properties: missingMappings }
                });
                const updateResponse = updateResponseRes && updateResponseRes.body;

                assert(updateResponse && updateResponse.acknowledged);
                changes.mappings = true;
            } catch (err) {
                // other than that update everything succeeded, so ignore for now
            }
        }

        if (!Object.keys(changes).length) {
            return { exists: true };
        } else {
            return { updated: true, changes };
        }
    }
};

module.exports = {
    ensureIndex: async (client, index) => await ensureIndex(client, index, { mappings, analyzer, tokenizer, filter })
};
