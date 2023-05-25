/*eslint no-unused-expressions: 0, prefer-arrow-callback: 0 */

'use strict';

const MIMEParser = require('../lib/indexer/parse-mime-tree').MIMEParser;

const chai = require('chai');
const expect = chai.expect;
chai.config.includeStack = true;

describe('#parseValueParams', function () {
    it('should return continuation value as mime-word', function () {
        let parser = new MIMEParser();
        const parsed = parser.parseValueParams(
            'text/plain;\n' +
                '\tname*0=emailengine_uuendamise_kasud_ja_muud_asjad_ja_veelgi_pikem_pealk;\n' +
                '\tname*1=iri.txt;\n' +
                '\tx-apple-part-url=99AFDE83-8953-43B4-BE59-F59D6160AFAB'
        );

        expect(parsed).to.deep.equal({
            value: 'text/plain',
            type: 'text',
            subtype: 'plain',
            params: {
                'x-apple-part-url': '99AFDE83-8953-43B4-BE59-F59D6160AFAB',
                name: '=?UTF-8?Q?emailengine_uuendamise_kasud_ja_muud_asjad_ja_veelgi_pikem_pealkiri.txt?='
            },
            hasParams: true
        });
    });

    it('should return continuation value as mime-word', function () {
        let parser = new MIMEParser();
        const parsed = parser.parseValueParams('image/jpeg; name="=?UTF-8?Q?sw=C3=A4n=2Ejpg?="');

        expect(parsed).to.deep.equal({
            value: 'image/jpeg',
            type: 'image',
            subtype: 'jpeg',
            params: {
                name: '=?UTF-8?Q?sw=C3=A4n=2Ejpg?='
            },
            hasParams: true
        });
    });
});
