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

var compileStats = {
    'success' : 0,
    'skipped': 0,
    'error': 0
};


module.exports = function(grunt) {

    // компиляция респаков
    grunt.task.registerMultiTask("respacksCompile", "Performs respacksGenerate tasks.", function () {
        var startTime = Math.round((new Date().getTime()) / 1000);

        grunt.file.defaultEncoding = 'utf8';
        var options = this.options({
            dest: ".build/respacks/",
            rawEmbedExtensions: ['json', 'xml', 'csv', 'swf', 'atlas'],
            maxConcurrency: 4
        });

        var done = this.async();
        var stark = new StarkTools(grunt, options);

        // создаем as3
        var fileList = stark.generateAsFiles(options['src'], options['asDest'], options['swfDest']);

        // компилим
        var q = async.queue(stark.compile, options['maxConcurrency']);
        q.drain = done;

        for (var respackName in fileList) {
            if (! fileList.hasOwnProperty(respackName)) {
                continue;
            }
            if (! fileList[respackName]['buildRequired']) {
                grunt.verbose.writeln(respackName + " compiling skipped!");
                compileStats['skipped']++;
                continue;
            }
            q.push(fileList[respackName]);
        }
        var endTime = Math.round((new Date().getTime()) / 1000);

        // result
        grunt.log.oklns("Compiled respacks: " + compileStats['success']);
        grunt.log.oklns("Skipped respacks: " + compileStats['skipped']);
        grunt.log.oklns("Error respacks: " + compileStats['error']);
        grunt.log.oklns("Time: " + (endTime - startTime) + " sec");
        return true;
    });

    // синхронизация файлов на удаленный сервер
    grunt.task.registerMultiTask("rsync", "Performs rsync tasks.",function () {
        var done = this.async();
        var options = this.options({
            'dest' : []
        });
        var stark = new StarkTools(grunt, options);

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
                var currentOptions = stark._clone(options);
                for (var param in destinations[i]) {
                    if (! destinations[i].hasOwnProperty(param)) {
                        continue;
                    }
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

    // генерация файла resource.json
    grunt.registerTask('resourcejson', 'A Grunt task plugin to build resources map', function() {
        var options = this.options({
            'hashAlgorithm' : 'md5'
        });

        var stark = new StarkTools(grunt, options);
        stark.resourceJsonBuild();
    });

    // компиляция main.swf
    grunt.registerMultiTask('mxmlc', 'A Grunt task plugin to compile Adobe Flex/ActionScript', function() {
        var options = this.options({
            fontsManagers: ['flash.fonts.JREFontManager', 'flash.fonts.AFEFontManager'],
            player: '11.4',
            staticLinkLibraries: true
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

                if (! error) {
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


/**
 * StarkTools
 * @param grunt
 * @param options
 * @constructor
 */
var StarkTools = function(grunt, options) {

    /**
     * Ссылка на тебя
     * @type {StarkTools}
     */
    var self = this;

    /**
     * Генерируем файлик ResourceJson
     * @returns {*}
     */
    this.resourceJsonBuild = function() {
        var JSONData = {
            'prefixes' : options['urlPath'],
            'files' : {}
        };

        if (! grunt.file.exists(options['src']) || ! grunt.file.isDir(options['src'])) {
            return grunt.log.error("src dir [" + options['src'] + "] is not exists or is not dir!");
        }

        // stats && debug
        var respacksCount = 0, respacksCreated = 0, resourcesCount = 0, resourcesCreated = 0, resourcesIgnored = 0;

        // recurse scan
        grunt.file.recurse(options['src'], function callback(absPath, rootDir, subDir, fileName) {
            if (typeof subDir != 'string') { // ignore root files
                return true;
            }

            // парсим данные файла
            var fileData = self._parseFileName(fileName, subDir);
            if (! fileData) {
                return false;
            }

            // разделяем на части путь
            var parts = subDir.split('/').map(function(value) {
                return value.toLowerCase();
            });
            parts[parts.length] = fileData[0];

            // добавояем расширение для типов, для которых может быть коллизия имени
            if (fileData[1] == 'xml' || fileData[1] == 'swf') {
                parts[parts.length] = fileData[1];
            }

            // считаем md5
            var md5 = crypto.createHash(options['hashAlgorithm']).update(fs.readFileSync(absPath)).digest('hex');

            // формируем уникальное имя респака
            var respackName = parts[0];
            parts.shift(); // удаляем имя респака

            // имя ресурса
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
        return true;
    };

    /**
     * Генерируем AS3 файлы из ресурсов
     */
    this.generateAsFiles = function(src, dest, swfDest) {
        var result = {};
        grunt.verbose.writeln(
            'Start generating AS files into folder [' + dest + '] using resources from [' + src + ']'
        );

        // @TODO НАДО БЫ ОТКУДА ТО ЧИТАТЬ ЭТО
        var buildDate = '2016-08-29 14:36:00';
        var gitRevision = 'abcdef0123456789';

        // Перебираем все исходные файлы, формируем as файлы
        grunt.file.recurse(options['src'], function callback(absPath, rootDir, subDir, fileName) {
            // Игнорим файлы, которые лежат в корне и не привязаны ни к одному респаку
            if (typeof subDir != 'string') {
                grunt.verbose.writeln(absPath + " ignored: no respack binded!");
                return true;
            }

            // парсим данные файла
            var fileData = self._parseFileName(fileName, subDir);
            if (! fileData) {
                return false;
            }

            var parts = subDir.split('/').map(function(value) {
                return value.toLowerCase();
            });
            parts[parts.length] = fileData[0];

            // имя респака
            var respackName = parts.shift();

            // имя файла с этим респаком
            var fileId = "respack_" + respackName;
            var destFileName = options['dest'] + fileId + '.as';
            var destFileNameTemp = options['dest'] + fileId + '.as~';
            var destSwfFileName = swfDest + fileId + ".swf";

            // Если в кеше нет инфы по этому файлу, значит мы по нему проходим в цикле первый раз
            // Проверяем наличие прошлой версии этого файла, и от этого отталкиваемся в дальнейшей логики
            if (typeof result[respackName] == 'undefined') {

                // если прошлая версия файла существует - переименовываем ее в темповый файлик
                if (grunt.file.exists(destFileName)) {
                    grunt.verbose.writeln(
                        "[" + destFileName + "] already exists! Renaming to [" + destFileNameTemp + "]"
                    );
                    grunt.file.copy(destFileName, destFileNameTemp);
                    grunt.file.delete(destFileName);
                }

                // записываем заголовок файла
                self._writeHeader(destFileName, fileId);
                result[respackName] = {
                    'fileId' : fileId,
                    'destFileName' : destFileName,
                    'destFileNameTemp' : destFileNameTemp,
                    'destSwf' : destSwfFileName
                };
            }

            // формируем имя ресурса
            var resourceId = parts.join('_');
            if (fileData[1] == 'xml') {
                resourceId += "XML";
            } else if (fileData[1] == 'swf') {
                resourceId += "SWF";
            }

            // добавляем ресурс в AS файл
            var quality = 100;
            self._processResource(destFileName, resourceId, absPath, fileData, quality);
        });

        // дозаписываем все файлы, сравниваем с оригинальными, формируем список для компиляции
        for(var respackName in result){
            if (! result.hasOwnProperty(respackName)) {
                continue;
            }
            grunt.verbose.writeln(respackName + ": start process...");

            // дозаписываем до валидного файла
            self._writeAppend(result[respackName]['destFileName'], "}}\n");

            // требуется сборка
            var buildRequired = true;

            // если темповый файл существует - проверим хеши двух файлов
            if (grunt.file.exists(result[respackName]['destFileNameTemp'])) {

                // получаем md5 текущего и временного файла
                var md5current = crypto.createHash('md5')
                    .update(fs.readFileSync(result[respackName]['destFileName'])).digest('hex');
                var md5temp = crypto.createHash('md5')
                    .update(fs.readFileSync(result[respackName]['destFileNameTemp'])).digest('hex');

                // хеши файлов совпадают - пересборка не нужна
                // отменяем компиляцию
                if (md5current == md5temp) {
                    grunt.verbose.writeln(respackName + ": hash are match!");

                    // только если скомпиленная версия есть - отказывается от перекомпиляции
                    if (grunt.file.exists(result[respackName]['destSwf'])) {
                        grunt.log.writeln(respackName + ": swf already exists. Skipping...");
                        buildRequired = false;
                    }

                }

                // удаляем темповый файл - он нам больше не нужен
                grunt.file.delete(result[respackName]['destFileNameTemp']);
            }

            // если требуется сборка - добавляем дату и ревизию гита
            if (buildRequired) {
                grunt.verbose.writeln(respackName + ": queued to compile");

                // делаем копию исходного файла
                grunt.file.copy(result[respackName]['destFileName'], result[respackName]['destFileNameTemp']);

                // заменяем в файле плейсхолдеры
                var content = grunt.file.read(result[respackName]['destFileName'])
                    .replace(/@{buildDate}/g, options['buildDate'])
                    .replace(/@{gitRevision}/g, options['gitRevision']);
                grunt.file.write(result[respackName]['destFileName'], content);
            }

            // флаг необходимости компиляции
            result[respackName]['buildRequired'] = buildRequired;
        }
        return result;
    };

    /**
     * Непосредственно компиляция
     * @param file
     * @param callback
     * @returns {boolean}
     */
    this.compile = function(file, callback) {
        grunt.verbose.writeln(
            'Compiling ' + file['destFileName'] + ' to ' + file['destSwf']
        );

        var cmdLineOptions = [
            file['destFileName'],
            '-target-player=10.2',
            '-static-link-runtime-shared-libraries=true',
            '-output ' + file['destSwf']
        ];

        childProcess.execFile(options['mxmlc'], cmdLineOptions, function(err, stdout, stderr) {

            if (! err) {
                grunt.log.writeln('File "' + file['destSwf'] + '" created.');

                // затираем as3 файл с подставленными плейсхолдерами исходным
                grunt.file.copy(file['destFileNameTemp'], file['destFileName']);
                grunt.file.delete(file['destFileNameTemp']);

                compileStats['success']++;

            } else {
                compileStats['error']++;
                grunt.log.error(err.toString());
                grunt.verbose.writeln('stdout: ' + stdout);
                grunt.verbose.writeln('stderr: ' + stderr);

                if (options.force === true) {
                    grunt.log.warn(
                        'Should have failed but will continue because this task had the `force` option set to `true`.'
                    );
                }
                else {
                    grunt.fail.warn('FAILED');
                }
            }

            callback(err);
        });

        return true;
    };

    /**
     * Парсим имя файла
     * @param fileName
     * @param subDir
     * @returns {*}
     * @private
     */
    this._parseFileName = function(fileName, subDir) {
        var fileData = fileName.split('.', 2);
        if (fileData.length != 2) {
            grunt.log.error("[" + fileName + "] wrong format!");
            return false;
        }

        // Заменяем запрещенные символы
        fileData[0] = fileData[0].replace(/[-\/.\\]/g, '_');
        return fileData;
    };

    /**
     * Вспомогательная функция клонирования объекта
     * @param obj
     * @returns {*}
     */
    this._clone = function (obj) {
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
    };

    /**
     * Функция записи заголовка as3 файла
     * @param filePath
     * @param resName
     * @returns {*|{info, type, negate}}
     */
    this._writeHeader = function (filePath, resName) {
        return grunt.file.write(filePath, "package { \n" +
            "import flash.display.Sprite;\n" +
            "import flash.system.Security;\n" +
            "public class " + resName +" extends Sprite { \n\n" +
            "public function " + resName + "() { \n" +
            "\tSecurity.allowDomain(\"*\"); }\n\n" +
            "\tpublic static var buildDate:String = \"@{buildDate}\";\n" +
            "\tpublic static var gitRevision:String = \"@{gitRevision}\";\n\n");
    };

    /**
     * Обрабатываем ресурс и вносим его в as3 файл
     * @param resourceId
     * @param resourcePath
     * @param filePath
     * @param fileData
     */
    this._processResource = function(filePath, resourceId, resourcePath, fileData, quality) {
        var buffer = '';

        // md5 файла
        var md5 = crypto.createHash('md5').update(fs.readFileSync(resourcePath)).digest('hex');
        buffer += "\t// " + md5 + "\n";

        var absResourcePath = '../../' + resourcePath;

        // опции встраивания
        if (options['rawEmbedExtensions'].indexOf(fileData[1]) != -1) {
            buffer += "\t[Embed(source=\"" + absResourcePath + "\", mimeType=\"application/octet-stream\")]\n";
        } else {
            if (quality == 100 || fileData[1] == "jpg") {
                buffer += "\t[Embed(source=\"" + absResourcePath + "\")]\n"
            } else {
                buffer += "\t[Embed(source=\"" + absResourcePath + "\", compression=\"true\", quality=\""+ quality + "\")]\n"
            }
        }

        // сама переменная
        buffer += "\tpublic static var " + resourceId + ": Class;\n\n";

        // записываем
        self._writeAppend(filePath, buffer);
    };

    /**
     * Дозаписываем файл в конец
     * @param filePath
     * @param content
     */
    this._writeAppend = function (filePath, content) {
        return grunt.file.write(
            filePath, grunt.file.read(filePath) + content
        );
    };

};


