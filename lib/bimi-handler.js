'use strict';

const packageData = require('../package.json');
const https = require('https');
const { validateSvg } = require('mailauth/lib/bimi/validate-svg');
const { vmc } = require('@postalsys/vmc');
const { formatDomain, getAlignment } = require('mailauth/lib/tools');
const crypto = require('crypto');

class BimiHandler {
    static create(options = {}) {
        return new BimiHandler(options);
    }

    constructor(options) {
        this.options = options || {};

        this.database = options.database;
    }

    async download(url) {
        if (!url) {
            return false;
        }

        const parsedUrl = new URL(url);

        let protoHandler;
        switch (parsedUrl.protocol) {
            case 'https:':
                protoHandler = https;
                break;
            case 'http:': {
                let error = new Error(`Only HTTPS addresses are allowed`);
                error.code = 'PROTO_NOT_HTTPS';
                throw error;
            }
            default: {
                let error = new Error(`Unknown protocol ${parsedUrl.protocol}`);
                error.code = 'UNKNOWN_PROTO';
                throw error;
            }
        }

        const options = {
            protocol: parsedUrl.protocol,
            host: parsedUrl.host,
            headers: {
                host: parsedUrl.host,
                'User-Agent': `${packageData.name}/${packageData.version} (+${packageData.homepage}`
            },
            servername: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.pathname,
            method: 'GET',
            rejectUnauthorized: true
        };

        return new Promise((resolve, reject) => {
            const req = protoHandler.request(options, res => {
                let chunks = [],
                    chunklen = 0;
                res.on('readable', () => {
                    let chunk;
                    while ((chunk = res.read()) !== null) {
                        chunks.push(chunk);
                        chunklen += chunk.length;
                    }
                });
                res.on('end', () => {
                    let data = Buffer.concat(chunks, chunklen);
                    if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                        let err = new Error(`Invalid response code ${res.statusCode || '-'}`);

                        if (res.headers.location && res.statusCode >= 300 && res.statusCode < 400) {
                            err.code = 'REDIRECT_NOT_ALLOWED';
                            err.details = {
                                code: res.statusCode,
                                location: res.headers.location
                            };
                        } else {
                            err.code = 'HTTP_STATUS_' + (res.statusCode || 'NA');
                        }
                        return reject(err);
                    }
                    resolve(data);
                });
                res.on('error', err => reject(err));
            });

            req.on('error', err => {
                reject(err);
            });
            req.end();
        });
    }

    async getBimiData(url, type) {
        if (!url) {
            return false;
        }

        let bimiDocument = await this.database.collection('bimi').findOne({ url, type });

        let bimiTtl = bimiDocument?.error ? 1 * 3600 * 1000 : 24 * 3600 * 1000;

        if (bimiDocument && bimiDocument?.updated > new Date(Date.now() - bimiTtl)) {
            if (bimiDocument.error) {
                let error = new Error(bimiDocument.error.message);
                if (bimiDocument.error.details) {
                    error.details = bimiDocument.error.details;
                }
                if (bimiDocument.error.code) {
                    error.code = bimiDocument.error.code;
                }
                throw error;
            }

            if (bimiDocument?.content?.buffer) {
                bimiDocument.content = bimiDocument.content.buffer;
            }

            return bimiDocument;
        }

        bimiDocument = {
            url,
            type,
            updated: new Date()
        };

        // Step 1. Download

        let file;
        try {
            file = await this.download(url);
        } catch (err) {
            bimiDocument.error = {
                message: err.message,
                details: err.details,
                code: err.code
            };

            try {
                await this.database.collection('bimi').updateOne(
                    {
                        url,
                        type
                    },
                    {
                        $set: bimiDocument,
                        $setOnInsert: {
                            created: new Date()
                        }
                    },
                    { upsert: true }
                );
            } catch (err) {
                // ignore
                console.error(3, err);
            }

            throw err;
        }

        // Step 2. Validate VMC
        if (type === 'authority') {
            try {
                let vmcData = await vmc(file);

                if (!vmcData.logoFile) {
                    let error = new Error('VMC does not contain a logo file');
                    error.code = 'MISSING_VMC_LOGO';
                    throw error;
                }

                if (vmcData?.mediaType?.toLowerCase() !== 'image/svg+xml') {
                    let error = new Error('Invalid media type for the logo file');
                    error.details = {
                        mediaType: vmcData.mediaType
                    };
                    error.code = 'INVALID_MEDIATYPE';
                    throw error;
                }

                if (!vmcData.validHash) {
                    let error = new Error('VMC hash does not match logo file');
                    error.details = {
                        hashAlgo: vmcData.hashAlgo,
                        hashValue: vmcData.hashValue,
                        logoFile: vmcData.logoFile
                    };
                    error.code = 'INVALID_LOGO_HASH';
                    throw error;
                }

                bimiDocument.content = Buffer.from(vmcData.logoFile, 'base64');
                bimiDocument.vmc = vmcData;
            } catch (err) {
                bimiDocument.error = {
                    message: err.message,
                    details: err.details,
                    code: err.code
                };

                try {
                    await this.database.collection('bimi').updateOne(
                        {
                            type,
                            url
                        },
                        {
                            $set: bimiDocument,
                            $setOnInsert: {
                                created: new Date()
                            }
                        },
                        { upsert: true }
                    );
                } catch (err) {
                    // ignore
                    console.error(1, err);
                }

                throw err;
            }
        } else {
            bimiDocument.content = file;
        }

        // Step 3. Validate SVG

        try {
            validateSvg(bimiDocument.content);
        } catch (err) {
            let error = new Error('VMC logo SVG validation failed');
            error.details = Object.assign(
                {
                    message: err.message
                },
                error.details || {},
                err.code ? { code: err.code } : {}
            );
            error.code = 'SVG_VALIDATION_FAILED';

            bimiDocument.error = {
                message: error.message,
                details: error.details,
                code: error.code
            };

            try {
                await this.database.collection('bimi').updateOne(
                    {
                        type,
                        url
                    },
                    {
                        $set: bimiDocument,
                        $setOnInsert: {
                            created: new Date()
                        }
                    },
                    { upsert: true }
                );
            } catch (err) {
                // ignore
                console.error(2, err);
            }

            throw error;
        }

        // clear pending errors
        bimiDocument.error = null;

        let r = await this.database.collection('bimi').findOneAndUpdate(
            {
                type,
                url
            },
            {
                $set: bimiDocument,
                $setOnInsert: {
                    created: new Date()
                }
            },
            { upsert: true, returnDocument: 'after' }
        );

        bimiDocument = r?.value;

        if (bimiDocument?.content?.buffer) {
            bimiDocument.content = bimiDocument.content.buffer;
        }

        return r && r.value;
    }

    async getInfo(bimiData) {
        let [
            { reason: locationError, value: locationValue, status: locationStatus },
            { reason: authorityError, value: authorityValue, status: authorityStatus }
        ] = await Promise.allSettled([this.getBimiData(bimiData.location, 'location'), this.getBimiData(bimiData.authority, 'authority')]);

        if (locationError) {
            throw locationError;
        }

        if (authorityError) {
            throw locationError;
        }

        if (authorityStatus === 'fulfilled' && authorityValue) {
            let selector = bimiData.status?.header?.selector;
            let d = bimiData.status?.header?.d;

            // validate domain
            let selectorSet = [];
            let domainSet = [];
            authorityValue.vmc?.certificate?.subjectAltName?.map(formatDomain)?.forEach(domain => {
                if (/\b_bimi\./.test(domain)) {
                    selectorSet.push(domain);
                } else {
                    domainSet.push(domain);
                }
            });

            let domainVerified = false;

            if (selector && selectorSet.includes(formatDomain(`${selector}._bimi.${d}`))) {
                domainVerified = true;
            } else {
                let alignedDomain = getAlignment(d, domainSet, false);
                if (alignedDomain) {
                    domainVerified = true;
                }
            }

            if (!domainVerified) {
                let error = new Error('Domain can not be verified');
                error.details = {
                    subjectAltName: authorityValue.vmc?.certificate?.subjectAltName,
                    selector,
                    d
                };
                error.code = 'VMC_DOMAIN_MISMATCH';
                throw error;
            }

            if (locationStatus === 'fulfilled' && locationValue?.content && authorityValue.vmc?.hashAlgo && authorityValue.vmc?.validHash) {
                console.log(locationValue.content);
                let hash = crypto
                    .createHash(authorityValue.vmc.hashAlgo)
                    //sss
                    .update(locationValue.content)
                    .digest('hex');
                if (hash === authorityValue.vmc.hashValue) {
                    // logo files match, so location URL is safe to use
                    authorityValue.locationUrl = bimiData.location;
                } else {
                    let error = new Error('Logo files from l= and a= do not match');
                    error.details = {
                        locationHash: hash,
                        authorityHash: authorityValue.vmc.hashValue,
                        hashAlgo: authorityValue.vmc.hashAlgo
                    };
                    error.code = 'LOGO_HASH_MISMATCH';
                    throw error;
                }
            }

            return authorityValue;
        }

        return locationStatus === 'fulfilled' && locationValue;
    }
}

module.exports = BimiHandler;

/*
const db = require('./db');
db.connect(() => {
    let bimi = BimiHandler.create({
        database: db.database
    });

    bimi.getInfo({
        status: {
            header: {
                selector: 'default',
                d: 'zone.ee'
            },
            result: 'pass'
        },
        rr: 'v=BIMI1; l=https://zone.ee/common/img/zone_profile_square_bimi.svg;a=https://zone.ee/.well-known/bimi.pem',
        location: 'https://zone.ee/common/img/zone_profile_square_bimi.svg',
        authority: 'https://zone.ee/.well-known/bimi.pem',
        info: 'bimi=pass header.selector=default header.d=zone.ee'
    })
        .then(result => console.log(require('util').inspect(result, false, 22)))
        .catch(err => console.error(err))
        .finally(() => process.exit());
});
*/
