'use strict';

const DEFAULT_QUOTES = [
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
    'The Wind Fish is watching...Hoot!',
    'Bad biscuits make the baker broke, bro.',
    'Everything small is just a smaller version of something big.',
    "I'm doing so awesome on my own. Like, right now, I found this can of beans.",
    'This does compute!',
    'Oh, my Glob, you guys, drama bomb!',
    'Melissa, I have to go, they got into my toilet paper! Melissa, I have to go!',
    'Also, I think the Lemongrabs are getting weirder.'
];

module.exports = {
    handler(command) {
        this.session.selected = this.selected = false;
        this.state = 'Logout';

        this.clearNotificationListener();
        this.send('* BYE Logout requested');

        let logoutMessages = [].concat(this._server.options.logoutMessages || []).filter(msg => typeof msg === 'string');
        if (!logoutMessages || !logoutMessages.length) {
            logoutMessages = DEFAULT_QUOTES;
        }

        this.send(command.tag + ' OK ' + logoutMessages[Math.floor(Math.random() * logoutMessages.length)]);
        setImmediate(() => this.close());
    }
};
