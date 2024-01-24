'use strict';

const fs = require('fs');
const Joi = require('joi');

const structuredCloneWrapper = typeof structuredClone === 'function' ? structuredClone : obj => JSON.parse(JSON.stringify(obj));

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
                if (key !== '$ref' || key !== 'description') {
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
            description: joiObject._flags.description,
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
            description: joiObject._flags.description
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
            description: joiObject._flags.description
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
        const description = joiObject._flags.description;
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

            if (data.format === 'date') {
                data.format = 'date-time';
            }
        }

        // enum check
        if (joiObject._valids) {
            const enumValues = [];
            for (const validEnumValue of joiObject._valids._values) {
                enumValues.push(validEnumValue);
            }
            if (enumValues.length > 0) {
                data.enum = enumValues;
            }
        }

        // example check
        if (joiObject.$_terms && joiObject.$_terms.examples && joiObject.$_terms.examples.length > 0) {
            const example = joiObject.$_terms.examples[0];

            data.example = example;
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

async function generateAPiDocs(routes) {
    let docs = {
        openapi: '3.0.0',
        info: {
            title: 'WildDuck API',
            description: 'WildDuck API docs',
            version: '1.0.0',
            contact: {
                url: 'https://github.com/nodemailer/wildduck'
            }
        },
        servers: [{ url: 'https://api.wildduck.email' }],
        tags: [
            { name: 'Addresses' },
            { name: 'ApplicationPasswords' },
            {
                name: 'Archive',
                description:
                    'Archive includes all deleted messages. Once messages are old enough then these are permanenetly deleted from the archive as well. Until then you can restore the deleted messages.'
            },
            {
                name: 'Audit',
                description:
                    'Auditing allows to monitor an email account. All existing, deleted and new emails are copied to the auditing system. See also https://github.com/nodemailer/wildduck-audit-manager'
            },
            { name: 'Authentication' },
            { name: 'Autoreplies' },
            {
                name: 'Certs',
                description:
                    'WildDuck allows to register TLS certificates to be used with SNI connections. These certificates are used by IMAP, POP3, API and SMTP servers when a SNI capable client establishes a TLS connection. This does not apply for MX servers.'
            },
            {
                name: 'DKIM',
                description:
                    'Whenever an email is sent WildDuck checks if there is a DKIM key registered for the domain name of the sender address and uses it to sign the message.'
            },
            {
                name: 'DomainAccess',
                description: 'Add sender domain names to allowlist (messages are all accepted) or blocklist (messages are sent to Spam folder)'
            },
            { name: 'DomainAliases' },
            { name: 'Filters' },
            { name: 'Mailboxes' },
            { name: 'Messages' },
            { name: 'Settings' },
            {
                name: 'Storage',
                description:
                    'Storage allows easier attachment handling when composing Draft messages. Instead of uploading the attachmnent with every draft update, you store the attachment to the Storage and then link stored file for the Draft.'
            },
            { name: 'Submission' },
            { name: 'TwoFactorAuth' },
            { name: 'Users' },
            { name: 'Webhooks' }
        ]
    };

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
        operationObj.summary = spec.summary;

        // 3) add description
        operationObj.description = spec.description;

        // 4) add operationId
        operationObj.operationId = spec.name || route.name;

        // 5) add requestBody
        const applicationType = spec.applicationType || 'application/json';

        if (spec.validationObjs?.requestBody && Object.keys(spec.validationObjs.requestBody).length > 0) {
            operationObj.requestBody = {
                content: {
                    [applicationType]: {
                        schema: {}
                    }
                },
                required: true
            };

            // convert to Joi object for easier parsing
            parseJoiObject('schema', Joi.object(spec.validationObjs?.requestBody), operationObj.requestBody.content[applicationType]);
        }

        // 6) add parameters (queryParams + pathParams).
        operationObj.parameters = [];
        for (const paramKey in spec.validationObjs?.pathParams) {
            const paramKeyData = spec.validationObjs.pathParams[paramKey];

            const obj = {};
            obj.name = paramKey;
            obj.in = 'path';
            obj.description = paramKeyData._flags.description;
            obj.required = paramKeyData._flags.presence === 'required';
            obj.schema = { type: paramKeyData.type };
            operationObj.parameters.push(obj);
        }

        for (const paramKey in spec.validationObjs?.queryParams) {
            const paramKeyData = spec.validationObjs.queryParams[paramKey];

            const obj = {};
            obj.name = paramKey;
            obj.in = 'query';
            obj.description = paramKeyData._flags.description;
            obj.required = paramKeyData._flags.presence === 'required';
            obj.schema = { type: paramKeyData.type };

            // enum check
            if (paramKeyData._valids) {
                const enumValues = [];
                for (const validEnumValue of paramKeyData._valids._values) {
                    enumValues.push(validEnumValue);
                }
                if (enumValues.length > 0) {
                    obj.schema.enum = enumValues;
                }
            }

            // example check
            if (paramKeyData.$_terms && paramKeyData.$_terms.examples && paramKeyData.$_terms.examples.length > 0) {
                const example = paramKeyData.$_terms.examples[0];

                obj.schema.example = example;
            }

            operationObj.parameters.push(obj);
        }

        // 7) add responses
        const responseType = spec.responseType || 'application/json';
        operationObj.responses = {};

        for (const resHttpCode in spec.validationObjs?.response) {
            const resBodyData = spec.validationObjs.response[resHttpCode];

            operationObj.responses[resHttpCode] = {
                description: resBodyData.description,
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
            for (const key in innerData?.requestBody?.content[Object.keys(innerData.requestBody.content)[0]].schema.properties) {
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

    components.components.securitySchemes = {
        AccessTokenAuth: {
            name: 'X-Access-Token',
            type: 'apiKey',
            in: 'header',
            description: `If authentication is enabled in the WildDuck configuration, you will need to supply an access token in the \`X-Access-Token\` header.\n
            \`\`\`json
            {
                "X-Access-Token": "59fc66a03e54454869460e45"
            }
            \`\`\`
            `
        }
    };

    docs = { ...docs, ...finalObj };
    docs = { ...docs, ...components };

    docs = {
        ...docs,
        security: [{ AccessTokenAuth: [] }]
    };

    await fs.promises.writeFile(__dirname + '/openapidocs.json', JSON.stringify(docs));
}

module.exports = { generateAPiDocs };
