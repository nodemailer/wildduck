/*eslint no-unused-expressions: 0, prefer-arrow-callback: 0 */

'use strict';

const MIMEParser = require('../lib/indexer/parse-mime-tree').MIMEParser;

const chai = require('chai');
const expect = chai.expect;
chai.config.includeStack = true;

describe('#parseValueParams', function () {
    it.only('should return as is', function () {
        let parser = new MIMEParser();
        const parsed = parser.parseValueParams(
            'text/plain;\n' +
                '\tname*0=emailengine_uuendamise_kasud_ja_muud_asjad_ja_veelgi_pikem_pealk;\n' +
                '\tname*1=iri.txt;\n' +
                '\tx-apple-part-url=99AFDE83-8953-43B4-BE59-F59D6160AFAB'
        );

        console.log('PARSED', parsed);
        expect(parsed).to.equal({
            value: 'text/plain',
            type: 'text',
            subtype: 'plain',
            params: {
                'x-apple-part-url': '99AFDE83-8953-43B4-BE59-F59D6160AFAB',
                name: 'emailengine_uuendamise_kasud_ja_muud_asjad_ja_veelgi_pikem_pealkiri.txt'
            },
            hasParams: true
        });
    });
});
