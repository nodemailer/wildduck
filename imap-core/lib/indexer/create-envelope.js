'use strict';

// This module converts message structure into an ENVELOPE object

/**
 * Convert a message header object to an ENVELOPE object
 *
 * @param {Object} message A parsed mime tree node
 * @return {Object} ENVELOPE compatible object
 */
module.exports = function (header) {
    return [
        header.date || null,
        header.subject || '',
        processAddress(header.from),
        processAddress(header.sender, header.from),
        processAddress(header['reply-to'], header.from),
        processAddress(header.to),
        processAddress(header.cc),
        processAddress(header.bcc),
        header['in-reply-to'] || null,
        header['message-id'] || null
    ];
};

/**
 * Converts an address object to a list of arrays
 * [{name: 'User Name', addres:'user@example.com'}] -> [['User Name', null, 'user', 'example.com']]
 *
 * @param {Array} arr An array of address objects
 * @return {Array} A list of addresses
 */
function processAddress(arr, defaults) {
    arr = [].concat(arr || []);
    if (!arr.length) {
        arr = [].concat(defaults || []);
    }
    if (!arr.length) {
        return null;
    }
    let result = [];
    arr.forEach(addr => {
        if (!addr.group) {
            result.push([
                addr.name || null, null, (addr.address || '').split('@').shift() || null, (addr.address || '').split('@').pop() || null
            ]);
        } else {
            // Handle group syntax
            result.push([null, null, addr.name || '', null]);
            result = result.concat(processAddress(addr.group) || []);
            result.push([null, null, null, null]);
        }
    });

    return result;
}
