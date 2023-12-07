'use strict';

process.env.NODE_ENV = 'test';

module.exports = function (grunt) {
    // Project configuration.
    grunt.initConfig({
        eslint: {
            all: ['lib/**/*.js', 'imap-core/**/*.js', 'test/**/*.js', 'examples/**/*.js', 'Gruntfile.js']
        },

        mochaTest: {
            imap: {
                options: {
                    reporter: 'spec'
                },
                // imap-core tests first
                src: ['imap-core/test/**/*-test.js']
            },
            api: {
                options: {
                    reporter: 'spec'
                },
                // api tests
                src: ['test/**/*-test.js']
            }
        },

        wait: {
            server: {
                options: {
                    delay: 12 * 1000
                }
            }
        },

        shell: {
            server: {
                command: 'node server.js',
                options: {
                    async: true
                }
            },
            options: {
                stdout: data => console.log(data.toString().trim()),
                stderr: data => console.log(data.toString().trim()),
                failOnError: true
            }
        }
    });

    // Load the plugin(s)
    grunt.loadNpmTasks('grunt-eslint');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-shell-spawn');
    grunt.loadNpmTasks('grunt-wait');

    // Tasks
    grunt.registerTask('default', ['eslint', 'shell:server', 'wait:server', 'mochaTest', 'shell:server:kill']);
    grunt.registerTask('testonly', ['shell:server', 'wait:server', 'mochaTest', 'shell:server:kill']);
    grunt.registerTask('proto', ['mochaTest:imap']);
};
