/*
 * grunt-stark-mxmlc
 * https://github.com/TonyStarkBy/grunt-stark-mxmlc
 *
 * Copyright (c) 2016 Tony Stark
 * Licensed under the MIT license.
 */

'use strict';

// grunt --rev=123 --branch=master-ok

var 
  yaml = require('js-yaml'),
  fs   = require('fs');


function loadYml(fileName) {
  var doc = false;

  try {
    doc = yaml.safeLoad(fs.readFileSync(fileName, 'utf8'));    
  } catch (e) {}

  return doc;
}
module.exports = function(grunt) {
  // default params will be overwritten from yml/$branch/params.yml
  var params = {
    buildDate:    grunt.template.today('yyyy-mm-dd HH:MM:ss'),
    gitRevision:  grunt.option('rev') || -1,
    branch:       grunt.option('branch') || 'local',
  };

  var branchParams = loadYml('yml/' + params.branch + '/params.yml') || {};
  Object.assign(params, branchParams);

  var settings = loadYml('yml/settings.yml') || {};
  var branchSettings = loadYml('yml/' + params.branch + '/settings.yml') || {};

  Object.assign(settings, branchSettings);

  // регулярка для замены @{var} в *.as файлах
  var varRegExp = /@\{(.*)\}/g;

  grunt.verbose.writeln( 'Params: ' + JSON.stringify(params) );
  grunt.verbose.writeln( 'Settings: ' + JSON.stringify(settings) );

  grunt.initConfig({
    clean: {
      dist: [settings.buildPath]
    },

    copy: {
      main: {
        files: [
          {expand: true, src: ['main/**'], dest: settings.buildPath},
          {expand: true, src: ['lib/**'], dest: settings.buildPath},
        ]
      }
    },

    replace: {
      dist: {
        src: [settings.buildPath + '**/*.as'],
        overwrite: true,        
        
        // TODO: посмотреть другие варианты 
        replacements: [{
          from: varRegExp,
          to: function (matchedWord, index, fullText, regexMatches) {
            grunt.verbose.writeln('matchedWord = ' + matchedWord);

            return params[ regexMatches[0] ];
          }
        }]
      }
    },

    mxmlc: {
      dist: {
        options: {
          mxmlc:      settings.mxmlc, // путь к mxmlc
          libraries:  [settings.buildPath + 'main/lib/'], // пути к *.swc файлам
          sources:    [settings.buildPath + 'lib/'], // исходники подключаемые через import
          debug:      settings.debug
        },

        files: {
          'public/main.swf': settings.buildPath + 'main/src/Main.as'
        }
      }
    },
    
	resourcejson: {
        options: {
          src: settings.srcPath,
          dest: settings.destPath,
          destMetaFile: settings.destMetaFile,
          urlPath: settings.urlPath
        }
    }

  });

  grunt.loadTasks('tasks');

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-text-replace');

  grunt.registerTask('default', ['clean', 'copy', 'replace', 'mxmlc']);
  //grunt.registerTask('default', ['mxmlc:release']);
  //grunt.registerTask('default', ['clean', 'copy']);
  // grunt.registerTask('default', ['resourcejson']);
};
