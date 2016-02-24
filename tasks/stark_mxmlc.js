/*
 * grunt-stark-mxmlc
 * https://github.com/TonyStarkBy/grunt-stark-mxmlc
 *
 * Copyright (c) 2016 Tony Stark
 * Licensed under the MIT license.
 */

'use strict';

var childProcess = require('child_process');
var async = require('async');

module.exports = function(grunt) {
  grunt.registerMultiTask('mxmlc', 'A Grunt task plugin to compile Adobe Flex/ActionScript', function() {
    var options = this.options({
        fontsManagers: ['flash.fonts.JREFontManager', 'flash.fonts.AFEFontManager'],
        player: '11.4',
        staticLinkLibraries: true,
    });

    var done = this.async();

    // Iterate over all specified file groups.
    this.files.forEach(function(f) {
      // Concat specified files.
      var src = f.src.filter(function(filepath) {
        // Warn on and remove invalid source files (if nonull was set).
        if (!grunt.file.exists(filepath)) {
          grunt.log.warn('Source file "' + filepath + '" not found.');
          return false;
        } else {
          return true;
        }
      });
   
      grunt.verbose.writeln('mxmlc path: ' + options.mxmlc);

      var cmdLineOptions = [];
      cmdLineOptions.push(src);

      if (options.staticLinkLibraries) {
        cmdLineOptions.push('-static-link-runtime-shared-libraries=true');
      }

      if (options.fontsManagers) {
        cmdLineOptions.push('-compiler.fonts.managers');

        options.fontsManagers.forEach(function(f) {
          cmdLineOptions.push(f);
        });
      }

      if (options.player) {
        cmdLineOptions.push('-target-player=' + options.player);
      }

      if (options.debug) {
        cmdLineOptions.push('-debug=true');
      }

      if (options.libraries) {
        options.libraries.forEach(function(f) {
          cmdLineOptions.push('-library-path+='+f);
        });
      }

      if (options.sources) {
        options.sources.forEach(function(f) {
          cmdLineOptions.push('-source-path+='+f);
        });
      }
     
      if (f.dest) {
        cmdLineOptions.push('-output');
        cmdLineOptions.push(f.dest);
      }

      grunt.verbose.writeln('options: ' + JSON.stringify(cmdLineOptions));

      childProcess.execFile(options.mxmlc, cmdLineOptions, function(error, stdout, stderr) {
        grunt.log.writeln(stdout); 
        grunt.log.writeln(stderr); // в stderr mxmlc выводит ошибки и варнинги!

        if (!error) {
          grunt.log.writeln('File "' + f.dest + '" created.');
        } else {
          grunt.log.writeln('Error: ' + stderr);
        }

        done(error); // Technique recommended on #grunt IRC channel. Tell Grunt asych function is finished. Pass error for logging; if operation completes successfully error will be null
      });
    });
  });
};
