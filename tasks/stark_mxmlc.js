/*
 * grunt-stark-mxmlc
 * https://github.com/TonyStarkBy/grunt-stark-mxmlc
 *
 * Copyright (c) 2016 Tony Stark aka Iron Man
 * Licensed under the MIT license.
 */

'use strict';

var childProcess = require('child_process');
var async = require('async');
var crypto = require('crypto');
var fs = require("fs");
var rsync = require("rsyncwrapper");

function clone(obj) {
    if (null == obj || "object" != typeof obj) {
        return obj;
    }
    var copy = obj.constructor();
    for (var attr in obj) {
        if (obj.hasOwnProperty(attr)) {
            copy[attr] = obj[attr];
        }
    }
    return copy;
}

module.exports = function(grunt) {

    grunt.task.registerMultiTask("rsync", "Performs rsync tasks.",function () {
        var done = this.async();
        var options = this.options({
            'dest' : []
        });

        if (! options.onStdout ) {
            options.onStdout = function (data) {
                grunt.log.write(data.toString("utf8"));
            };
        }
        if (typeof options['dest'] != 'object') {
            return grunt.log.error("Invalid dest!");
        }

        try {
            var destinations = options['dest'];

            for (var i = 0; i < destinations.length; i++) {

                // формируем опции запуска конкретно для этого вызова
                var currentOptions = clone(options);
                for (var param in destinations[i]) {
                    currentOptions[param] = destinations[i][param];
                }
                grunt.verbose.writeln('Run rsync: ' + JSON.stringify(currentOptions));

                // start rsync
                rsync(currentOptions, function (error, stdout, stderr, cmd) {
                    grunt.log.writeln("Shell command was: " + cmd);
                    if (error) {
                        grunt.log.error();
                        grunt.log.writeln(error.toString().red);
                        done(false);
                    } else {
                        grunt.log.ok();
                        done(true);
                    }
                });
            }

        } catch (error) {
            grunt.log.writeln("\n"+error.toString().red);
            done(false);
        }
    });


    grunt.registerTask('resourcejson', 'A Grunt task plugin to build resources map', function() {
        var options = this.options({
            'hashAlgorithm' : 'md5'
        });
        var JSONData = {
            'prefixes' : options['urlPath'], 'files' : {}
        };

        if (! grunt.file.exists(options['src']) || ! grunt.file.isDir(options['src'])) {
            return grunt.log.error("src dir [" + options['src'] + "] is not exists or is not dir!");
        }

        //var done = this.async();

        // stats && debug
        var respacksCount = 0, respacksCreated = 0, resourcesCount = 0, resourcesCreated = 0, resourcesIgnored = 0;

        // recurse scan
        grunt.file.recurse(options['src'], function callback(absPath, rootDir, subDir, fileName) {
            // ignore root files
            if (typeof subDir != 'string') {
                return true;
            }
            var md5 = crypto.createHash(options['hashAlgorithm']).update(fs.readFileSync(absPath)).digest('hex');

            // парсим имя и тип ресурса
            var fileData = fileName.split('.', 2);
            if (fileData.length != 2) {
                return grunt.log.error("[" + absPath + "] wrong format!");
            }

            // разделяем на части путь
            var parts = subDir.split('/').map(function(value) {
                return value.toLowerCase();
            });

            // добавляем имя файла
            parts[parts.length] = fileData[0];

            // добавояем расширение для типов, для которых может быть коллизия имени
            if (fileData[1] == 'xml' || fileData[1] == 'swf') {
                parts[parts.length] = fileData[1];
            }

            // формируем уникальное имя ресурса и имя респака
            var respackName = parts[0];
            // удаляем имя респака
            parts.shift();
            var resourceId = parts.join('_');
            var destinationFile = resourceId + "~" + md5 + "." + fileData[1];

            // создаем папку для респака, если нужно
            var destinationDir = options['dest'] + "/" + respackName;
            if (typeof JSONData['files'][respackName] == 'undefined') {
                if (! grunt.file.exists(destinationDir)) { // Можно не создавать, grunt сделает это сам
                    grunt.file.mkdir(destinationDir, "0777");
                    respacksCreated++;
                }
                JSONData['files'][respackName] = {};
                respacksCount++;
            }

            // формируем JSON
            if (typeof JSONData['files'][respackName][resourceId] == 'undefined') {
                JSONData['files'][respackName][resourceId] = respackName + '/' + destinationFile;
            } else {
                grunt.log.error("Resource " + resourceId + " (respack=" + respackName + ") DUPLICATE!");
            }

            // копируем файл назначения
            if (! grunt.file.exists(destinationDir + '/' + destinationFile)) {
                grunt.file.copy(absPath, destinationDir + '/' + destinationFile);
                resourcesCreated++;
            } else {
                resourcesIgnored++;
            }

            resourcesCount++;
        });

        // записываем итоговый JSON
        grunt.file.write(options['destMetaFile'], JSON.stringify(JSONData));

        // result
        grunt.log.oklns("Respacks: " + respacksCount + " (created: " + respacksCreated + ")");
        grunt.log.oklns(
            "Resources: " + resourcesCount + " (created: " + resourcesCreated + "; Ignored: " + resourcesIgnored + ")"
        );
        grunt.log.oklns("Meta file:" + options['destMetaFile']);
    });

    
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
            done(true);
        } else {
            // Technique recommended on #grunt IRC channel. Tell Grunt asych function is finished.
            // Pass error for logging; if operation completes successfully error will be null
            grunt.log.writeln('Error: ' + stderr);
            done(error);
        }

      });
    });
  });
};
