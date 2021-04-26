'use strict';

const { Upload } = require("@aws-sdk/lib-storage");
const {
    S3,
    HeadObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand
} = require("@aws-sdk/client-s3");
const libmime = require('libmime');


class S3Driver {
    constructor(options) {
        this.storageConf = options.config;   
        const s3conf = {
            credentials: {
                accessKeyId: this.storageConf.s3.accessKeyId,
                secretAccessKey: this.storageConf.s3.secretAccessKey
            },
            region: this.storageConf.s3.region
        };
        if (this.storageConf.endpoint) {
            s3conf.endpoint = this.storageConf.s3.endpoint
        }
        this.client = new S3(s3conf);
    }

    async add(user, options) {
        let filename = options.filename;
        let contentType = options.contentType;

        let filebase = 'upload-' + new Date().toISOString().substr(0, 10);
        if (!contentType && !filename) {
            filename = filebase + '.bin';
            contentType = 'application/octet-stream';
        } else if (!contentType) {
            contentType = libmime.detectMimeType(filename) || 'application/octet-stream';
        } else if (!filename) {
            filename = filebase + '.' + libmime.detectExtension(contentType);
        }

            const target = {
                Bucket: this.storageConf.s3.bucket,
                Key: filename,
                Body: options.content
            };

                const paralellUploads3 = new Upload({
                  client: this.client,
                  tags: [], // optional tags
                //   queueSize: 4, // optional concurrency configuration
                  leavePartsOnError: false, // optional manually handle dropped parts
                  params: target,
                });
    
            
                await paralellUploads3.done();
                return filename;


    }

    async get(user, file) {

        const options = {
            Bucket: this.storageConf.s3.bucket,
            Key: file,
        };
        let fileData;
        const that = this;
        
        try {
            const getFileCommand = new HeadObjectCommand(options);
            fileData = await that.client.send(getFileCommand);
        } catch (error) {
            let err = new Error('This file does not exist');
            err.code = 'FileNotFound';
            throw err;
        }


        return new Promise(async (resolve, reject) => {
            let body;
            try {
                let getObjCommand = new GetObjectCommand(options);
                const resp = await this.client.send(getObjCommand);
                body = resp.Body;
            } catch (error) {
                reject(error);
            }
         

            let chunks = [];
            let chunklen = 0;


            body.once('error', err => {
                reject(err);
            });

            body.on('readable', () => {
                let chunk;
                while ((chunk = body.read()) !== null) {
                    chunks.push(chunk);
                    chunklen += chunk.length;
                }
            });

            body.once('end', () => {
                resolve({
                    id: fileData.ETag,
                    filename: file,
                    contentType: fileData.contentType,
                    size: fileData.ContentLength,
                    content: Buffer.concat(chunks, chunklen)
                });
            });
        });
    }

    async delete(user, file) {

        const options = {
            Bucket: this.storageConf.s3.bucket,
            Key: file,
        };
        const that = this;
        
        try {
            const getFileCommand = new HeadObjectCommand(options);
            await that.client.send(getFileCommand);
        } catch (error) {
            let err = new Error('This file does not exist');
            err.code = 'FileNotFound';
            throw err;
        }

        try {
            let getObjCommand = new DeleteObjectCommand(options);
            await this.client.send(getObjCommand);
        } catch (error) {
            let err = new Error('Error in deleting the file');
            err.code = 'FileNotDeleted';
            throw error;
        }
    }
}

module.exports = S3Driver;