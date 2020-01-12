/* eslint no-bitwise: 0*/
'use strict';

/*-
 * Copyright (c) 2003 Poul-Henning Kamp
 * All rights reserved.
 *
 * Converted to JavaScript / node.js and modified by Dominik Deobald / Interdose.com
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */
let crypto = require('crypto');

// http://code.activestate.com/recipes/325204-passwd-file-compatible-1-md5-crypt/
// http://www.freebsd.org/cgi/cvsweb.cgi/~checkout~/src/lib/libcrypt/crypt.c?rev=1.2&content-type=text/plain
// http://www.freebsd.org/cgi/cvsweb.cgi/~checkout~/src/lib/libcrypt/crypt-md5.c
exports.cryptMD5 = function(pw, salt) {
    let magic = '$1$';
    let fin;
    let sp = salt || generateSalt(8);

    let ctx = crypto.createHash('md5');

    // The password first, since that is what is most unknown
    // Then our magic string
    // Then the raw salt
    ctx.update(pw + magic + sp);

    // Then just as many characters of the MD5(pw,sp,pw)
    let ctx1 = crypto.createHash('md5');
    ctx1.update(pw);
    ctx1.update(sp);
    ctx1.update(pw);
    fin = ctx1.digest('binary');

    for (let i = 0; i < pw.length; i++) {
        ctx.update(fin.substr(i % 16, 1), 'binary');
    }

    // Then something really weird...

    // Also really broken, as far as I can tell.  -m
    // Agreed ;) -dd

    for (let i = pw.length; i; i >>= 1) {
        ctx.update(i & 1 ? '\x00' : pw[0]);
    }
    fin = ctx.digest('binary');

    // and now, just to make sure things don't run too fast
    for (let i = 0; i < 1000; i++) {
        let ctx1 = crypto.createHash('md5');

        if (i & 1) {
            ctx1.update(pw);
        } else {
            ctx1.update(fin, 'binary');
        }

        if (i % 3) {
            ctx1.update(sp);
        }

        if (i % 7) {
            ctx1.update(pw);
        }

        if (i & 1) {
            ctx1.update(fin, 'binary');
        } else {
            ctx1.update(pw);
        }

        fin = ctx1.digest('binary');
    }

    return magic + sp + '$' + to64(fin);
};

function to64(data) {
    // This is the bit that uses to64() in the original code.

    let itoa64 = [
        '.',
        '/',
        '0',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        'A',
        'B',
        'C',
        'D',
        'E',
        'F',
        'G',
        'H',
        'I',
        'J',
        'K',
        'L',
        'M',
        'N',
        'O',
        'P',
        'Q',
        'R',
        'S',
        'T',
        'U',
        'V',
        'W',
        'X',
        'Y',
        'Z',
        'a',
        'b',
        'c',
        'd',
        'e',
        'f',
        'g',
        'h',
        'i',
        'j',
        'k',
        'l',
        'm',
        'n',
        'o',
        'p',
        'q',
        'r',
        's',
        't',
        'u',
        'v',
        'w',
        'x',
        'y',
        'z'
    ];

    let rearranged = '';

    let opt = [[0, 6, 12], [1, 7, 13], [2, 8, 14], [3, 9, 15], [4, 10, 5]];

    for (let p in opt) {
        let l = (data.charCodeAt(opt[p][0]) << 16) | (data.charCodeAt(opt[p][1]) << 8) | data.charCodeAt(opt[p][2]);

        for (let i = 0; i < 4; i++) {
            rearranged += itoa64[l & 0x3f];
            l >>= 6;
        }
    }

    let l = data.charCodeAt(11);
    for (let i = 0; i < 2; i++) {
        rearranged += itoa64[l & 0x3f];
        l >>= 6;
    }

    return rearranged;
}

function generateSalt(len) {
    let set = '0123456789abcdefghijklmnopqurstuvwxyzABCDEFGHIJKLMNOPQURSTUVWXYZ',
        setLen = set.length,
        salt = '';
    for (let i = 0; i < len; i++) {
        let p = Math.floor(Math.random() * setLen);
        salt += set[p];
    }
    return salt;
}
