'use strict';

const config = require('wild-config');

const quotes = config.imap.quotes || [
    'All dreams are but another reality. Never forget...',
    'Oh boy, oh boy, oh boy...',
    'Cut the dramatics, would yeh, and follow me!',
    'Oh ho ho ho, duck hunters is da cwaziest peoples! Ha ha ha.',
    'Well, that makes sense. Send a bird to catch a cat!',
    'Piccobello!',
    'No more Mr. Nice Duck!',
    'Not bad for a duck from outer space.',
    'Ho! Ho! Ho! My BowWow is so proud of his fine fur coat!',
    'Whew! What a surprise!',
    'Whoa, boy! Where ya off to in such a hurry?',
    'Ahhh... It has the Sleepy Toad-stool, it does!',
    'Make-up! Jewels! Dresses! I want it all! Sigh...',
    'Remember, you... too... are in... ...the dream...',
    'The Wind Fish is watching...Hoot!'
];

module.exports = {
    handler(command) {
        this.session.selected = this.selected = false;
        this.state = 'Logout';

        this.clearNotificationListener();
        this.send('* BYE Logout requested');
        this.send(command.tag + ' OK ' + quotes[Math.floor(Math.random() * quotes.length)]);
        this.close();
    }
};
