'use strict'

const fs = require("fs");

// Get filenames (paths) in folder and it's subfolders
function getFiles(dir, filePaths = []) {
    const fileList = fs.readdirSync(dir);

    for (const file of fileList) {
        const name = `${dir}/${file}`;

        if (fs.statSync(name).isDirectory()) {
            getFiles(name, filePaths);
        } else {
            filePaths.push(name);
        }
    }
    return filePaths;
}

// console.log(getFiles("./lib/api"));

function readAllFilesSync(filePaths = []) {
    const files = [];
    for (const filePath of filePaths) {
        try {
            const file = fs.readFileSync(filePath, 'utf-8');
            files.push(file);
        } catch (error) {
            console.error(error);
            continue;
        }
    }
    return files;
}

// console.log(readAllFilesSync(getFiles("./lib/api")));

const serverCallToApiMethodMap = {
    "del": "DELETE",
    "put": "PUT",
    "get": "GET",
    "post": "POST"
}

function extractApiDataFromFiles(files = []) {
    const rx = /server\.[A-Za-z]{3,6}\([^)]*/mg;

    // const apiMethodsCrude = [];

    const apiPathToApiMethodMap = {};


    for (const file of files) {
        const data = file.match(rx);

        if (!data) {
            continue;
        }

        // console.log(data);

        for (const match of data) {
            const apiMethodRegex = /\.[^(]*/;
            const apiPathRegex2 = /{(.*)}/;
            const apiPathRegex1 = /'(.*)'/;

            const apiMethod = match.match(apiMethodRegex)[0];
            const apiPathVariant2 = match.match(apiPathRegex2);
            const apiPathVariant1 = match.match(apiPathRegex1);

            const path = apiPathVariant2 ? apiPathVariant2[1].split("path:")[1].replace(/[']/g, '').trim() : apiPathVariant1[1].trim();

            // console.log(/*match,*/apiMethod.replace(".", '').trim(), path);
            // console.log("------------")

            apiPathToApiMethodMap[path] = serverCallToApiMethodMap[apiMethod.replace(".", '').trim()];
        }
    }

    // console.log(apiPathToApiMethodMap);
    return apiPathToApiMethodMap;
}

console.log(extractApiDataFromFiles(readAllFilesSync(getFiles("./lib/api"))));
