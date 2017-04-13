'use strict';

let quotes = [
    'All dreams are but another reality. Never forget...',
    'Oh boy, oh boy, oh boy...',
    'Cut the dramatics, would yeh, and follow me!',
    'Oh ho ho ho, duck hunters is da cwaziest peoples! Ha ha ha.',
    'Well, that makes sense. Send a bird to catch a cat!',
    'Piccobello!'
];

module.exports = {
    handler(command) {
        this.session.selected = this.selected = false;
        this.state = 'Logout';

        this.updateNotificationListener(() => {
            this.send('* BYE Logout requested');
            this.send(command.tag + ' OK ' + quotes[Math.floor(Math.random() * quotes.length)]);
            this.close();
        });
    }
};
