/*
 * grunt-stark-mxmlc
 * https://github.com/TonyStarkBy/grunt-stark-mxmlc
 *
 * Copyright (c) 2016 Tony Stark aka Iron Man
 * Licensed under the MIT license.
 */

'use strict';

var crypto = require('crypto');
var fs = require("fs");
var async = require('async');
var childProcess = require('child_process');
var rsync = require("rsyncwrapper");

/**
 * StarkStudio grunt Tools
 * @param grunt
 * @constructor
 */
var StarkTools = function(grunt) {

    /**
     * Def enc
     * @type {string}
     */
    grunt.file.defaultEncoding = 'utf8';

    /**
     * Ссылка на тебя
     * @type {StarkTools}
     */
    var self = this;


    /**
     * Генерируем boot.json
     * @param options
     * @returns {boolean}
     */
    this.bootJsonCreate = function(options) {
        var result = {
            'prefixes' : options['urls'],
            'mainPrefixes': options['mainUrls'],
            'files' : {},
            'main' : {}
        };

        var respacksCache = {};
        var respacksCount = 0;

        // сканируем наличие респаков, чтобы удалить старые версии при генерации новых
        if (grunt.file.exists(options['dest'])) {
            grunt.file.recurse(options['dest'], function callback(absPath, rootDir, subDir, fileName) {
                var fileData = fileName.split('.', 2);
                if (fileData.length != 2) {
                    return false;
                }
                if (fileData[1] != 'swf') {
                    return false;
                }
                var parts = fileData[0].split('~');
                if (parts.length != 2) {
                    return false;
                }
                var respackName = parts[0];
                var respackHash = parts[1];

                if (typeof respacksCache[respackName] == 'undefined') {
                    respacksCache[respackName] = {};
                }
                respacksCache[respackName][respackHash] = absPath;
            });
        }

        // функция обработки
        var proccess = function callback(absPath, rootDir, subDir, fileName) {
            var fileData = fileName.split('.', 2);
            if (fileData.length != 2) {
                grunt.log.error(absPath + " cannot parse name!");
                return false;
            }
            if (fileData[1] != 'swf') {
                grunt.verbose.writeln(absPath + " is not swf!");
                return false;
            }

            grunt.log.subhead("Analyze [" + fileName + "]");

            var md5 = crypto.createHash(options['hashAlgorithm']).update(fs.readFileSync(absPath)).digest('hex');
            var newFileName = fileData[0] + '~' + md5 + '.' + fileData[1];
            var destination = options['dest'];
            
            // для мейна меняем целевую папку и ключ записи
            if (fileName == 'main.swf') {
                destination = options['mainDest'];
                result['main'] = newFileName;
            }

            // копиируем только если файла нет
            if (! grunt.file.exists(destination + newFileName)) {

                // вначале удаляем старые
                if (typeof respacksCache[fileData[0]] != 'undefined') {
                    for (var respackHash in respacksCache[fileData[0]]) {
                        var oldRespackPath = respacksCache[fileData[0]][respackHash];
                        grunt.log.oklns("Delete old : " + oldRespackPath);
                        grunt.file.delete(oldRespackPath);
                    }
                }

                // копируем новый
                grunt.file.copy(absPath, destination + newFileName);
                grunt.log.oklns("Copy new: " + newFileName);

            } else {
                 grunt.log.oklns('Already exists.');
            }

            respacksCount++;
            result['files'][fileData[0]] = newFileName;
        };

        // сканируем мейн swf если нужно
        if (options['mainSrc']) {
            var parts = options['mainSrc'].split('/').map(function(value) {
                return value.toLowerCase();
            });
            if (! parts.length) {
                return grunt.log.error("Cannot parse main.swf name!");
            }
            var fileName = parts[parts.length-1];
            proccess(options['mainSrc'], null, null, fileName);
        }

        // сканируем респаки
        grunt.file.recurse(options['src'], proccess);

        // записываем итоговый JSON
        var content = JSON.stringify(result);
        grunt.file.write(options['destMetaFile'], content);
        grunt.log.oklns("Meta file: " + options['destMetaFile'] + " (" + respacksCount + ")");
        return true;
    };

    /**
     * Генерируем файлик ResourceJson
     * @returns {*}
     */
    this.resourcesJsonCreate = function(options) {
        if (! grunt.file.exists(options['src']) || ! grunt.file.isDir(options['src'])) {
            return grunt.log.error("src dir [" + options['src'] + "] is not exists or is not dir!");
        }
        grunt.log.writeln('Sources: ' + options['src']);
        grunt.log.writeln('Destination: ' + options['dest']);

        // result
        var result = {
            'prefixes' : options['urls'],
            'files' : {}
        };

        // stats && debug
        var respacksCount = 0, respacksCreated = 0, resourcesCount = 0, resourcesCreated = 0, resourcesIgnored = 0;

        // recurse scan
        grunt.file.recurse(options['src'], function callback(absPath, rootDir, subDir, fileName) {
            if (typeof subDir != 'string') { // ignore root files
                return true;
            }

            // парсим данные файла
            var fileData = self._fileNameParse(fileName, subDir);
            if (! fileData) {
                grunt.log.error("[" + fileName + "] wrong format!");
                return false;
            }

            // разделяем на части путь
            var parts = subDir.split('/').map(function(value) {
                return value.toLowerCase();
            });
            parts[parts.length] = fileData[0];

            // формируем уникальное имя респака и удаляем его из пути файла (чтобы имя респака не попало в resourceId)
            var respackName = parts.shift();

            // формируем имя ресурса
            var resourceId = self._generateResourceId(parts, fileData);

            // считаем md5
            var md5 = crypto.createHash(options['hashAlgorithm']).update(fs.readFileSync(absPath)).digest('hex');

            // имя файла
            var destinationFile = resourceId + "~" + md5 + "." + fileData[1];

            // создаем папку респака, если нужно
            var destinationDir = options['dest'] + "/" + respackName;
            if (typeof result['files'][respackName] == 'undefined') {
                if (! grunt.file.exists(destinationDir)) {
                    grunt.file.mkdir(destinationDir, "0777");
                    respacksCreated++;
                }
                result['files'][respackName] = {};
                respacksCount++;
            }

            // формируем JSON
            if (typeof result['files'][respackName][resourceId] == 'undefined') {
                result['files'][respackName][resourceId] = respackName + '/' + destinationFile;
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
        var content = JSON.stringify(result);
        grunt.file.write(options['destMetaFile'], content);

        // result
        grunt.log.oklns("Respacks: " + respacksCount + " (created: " + respacksCreated + ")");
        grunt.log.oklns(
            "Resources: " + resourcesCount + " (created: " + resourcesCreated + "; Ignored: " + resourcesIgnored + ")"
        );
        grunt.log.oklns("Meta file: " + options['destMetaFile'] + " (" + content.length + ")");
        return true;
    };

    /**
     * Компиляция флешек
     */
    this.compile = function(data, callback) {
        var options = data['options'];
        grunt.log.subhead("Compile " + data['dest']);
        grunt.verbose.writeln(
            'Compiling ' + data['src'] + ' to ' + data['dest']
        );

        var cmdLineOptions = [];

        // add src
        cmdLineOptions.push(data['src']);

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

        cmdLineOptions.push('-output');
        cmdLineOptions.push(data['dest']);

        grunt.verbose.writeln('options: ' + JSON.stringify(cmdLineOptions));

        childProcess.execFile(options['mxmlc'], cmdLineOptions, function(err, stdout, stderr) {
            if (! err) {
                grunt.log.oklns('File "' + data['dest'] + '" created.');
            } else {
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
     * Функция генерации AS-файлов для респаков
     * @param options
     */
    this.generateRespacks = function(options) {
        grunt.log.writeln('Sources: ' + options['src']);
        grunt.log.writeln('Build Path: ' + options['buildPath']);
        grunt.log.writeln('Dest Path: ' + options['destPath']);

        var result = {};
        grunt.file.recurse(options['src'], function callback(absPath, rootDir, subDir, fileName) {
            if (typeof subDir != 'string') { // Игнорим файлы, которые лежат в корне и не привязаны ни к одному респаку
                grunt.verbose.writeln(absPath + " ignored: no respack binded!");
                return true;
            }

            // парсим данные файла
            var fileData = self._fileNameParse(fileName, subDir);
            if (! fileData) {
                grunt.log.error("[" + fileName + "] wrong format!");
                return false;
            }

            // разделяем на части путь
            var parts = subDir.split('/').map(function(value) {
                return value.toLowerCase();
            });
            parts[parts.length] = fileData[0];

            // формируем имя ресурса и имя респака
            var respackName = parts.shift();
            var resourceId = self._generateResourceId(parts, fileData);

            // имя файла с этим респаком
            var fileId = "respack_" + respackName;
            var destFileName = options['buildPath'] + fileId + '.as';
            var destFileNameTemp = options['buildPath'] + fileId + '.as~';

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
                self._respackWriteHeader(destFileName, fileId);
                result[respackName] = {
                    'fileId' : fileId,
                    'destFileName' : destFileName,
                    'destFileNameTemp' : destFileNameTemp,
                    'compileName' : options['buildPath'] + 'compile/' + fileId + '.as',
                    'destSwf' : options['destPath'] + fileId + ".swf"
                };
            }

            // добавляем ресурс в AS файл
            var quality = 100; // @TODO вынести в конфиг
            var rawEmbed = (options['rawEmbedExtensions'].indexOf(fileData[1]) != -1);
            self._respackProcessResource(destFileName, resourceId, absPath, fileData, quality, rawEmbed);
        });

        var skipped = 0,
             required = 0;

        // дозаписываем все файлы, сравниваем с оригинальными, формируем список для компиляции
        var compileList = {}; var counter = 0;
        for (var respackName in result){
            if (! result.hasOwnProperty(respackName)) {
                continue;
            }

            // дозаписываем до валидного файла
            self._respackWriteAppend(result[respackName]['destFileName'], "}}\n");

            grunt.log.subhead("Analyze [" + respackName + "]");

            // требуется сборка
            var buildRequired = true;

            // если темповый файл существует - проверим хеши двух файлов
            if (grunt.file.exists(result[respackName]['destFileNameTemp'])) {
                grunt.verbose.writeln("- Temp file found.");

                // получаем md5 текущего и временного файла
                var md5current = crypto.createHash('md5').update(fs.readFileSync(result[respackName]['destFileName'])).digest('hex');
                var md5temp = crypto.createHash('md5').update(fs.readFileSync(result[respackName]['destFileNameTemp'])).digest('hex');

                // хеши файлов совпадают - пересборка не нужна - отменяем компиляцию
                if (md5current == md5temp) {
                    grunt.verbose.writeln("- AS3-files hashes are match!");

                    // только если скомпиленная версия есть - отказывается от перекомпиляции
                    if (grunt.file.exists(result[respackName]['destSwf'])) {
                        grunt.verbose.writeln("- SWF already exists. Skip building.");
                        buildRequired = false;
                    } else {
                        grunt.verbose.writeln("- SWF is not found. Building is required!");
                    }
                } else {
                    grunt.verbose.writeln("- Temp file found.");
                }

                // удаляем темповый файл - он нам больше не нужен
                grunt.file.delete(result[respackName]['destFileNameTemp']);
            } else {
                grunt.verbose.writeln("- AS3-files hashes NOT match!");
            }

            // если компиляция не требуется - идем дальше
            if (! buildRequired) {
                skipped++;
                grunt.log.oklns("Building is not required.");
                continue;
            }

            // делаем копию исходного файла
            grunt.file.copy(result[respackName]['destFileName'], result[respackName]['destFileNameTemp']);

            // заменяем в файле плейсхолдеры и записываем в папку компиляции
            var content = grunt.file.read(result[respackName]['destFileName'])
                .replace(/@{buildDate}/g, options['buildDate'])
                .replace(/@{gitRevision}/g, options['gitRevision']);
            grunt.file.write(result[respackName]['compileName'], content);

            // планируем компиляцию
            grunt.log.oklns("Building is queued.");
            compileList[result[respackName]['destSwf']] = result[respackName]['compileName'];
            counter++;
            required++;
        }

        // записываем JSON файл с данными для компиляции
        grunt.file.write(options['buildPath'] + options['metaFile'], JSON.stringify(compileList));

        // result
        grunt.log.subhead(options['metaFile']);
        grunt.log.oklns("Meta file path: " + options['buildPath'] + options['metaFile'] + " (" + counter + " elements)");
        grunt.log.oklns("Skipped: " + skipped);
        grunt.log.oklns("Queued: " + required);

    };


    /**
     * Парсим имя файла. Возвращаем отдельно имя и расширение
     * @param fileName
     * @param subDir
     * @returns {*}
     * @private
     */
    this._fileNameParse = function(fileName, subDir) {
        var fileData = fileName.toLowerCase().split('.', 2);
        if (fileData.length != 2) {
            return false;
        }
        fileData[0] = fileData[0].replace(/[-\/.\\]/g, '_');
        return fileData;
    };

    /**
     * Генерируем имя ресурсов для респаков и resources.json
     * @param parts
     * @param fileData
     * @returns {string}
     * @private
     */
    this._generateResourceId = function(parts, fileData) {
        var resourceId = parts.join('_');
        if (fileData[1] == 'xml') {
            resourceId += "XML";
        } else if (fileData[1] == 'swf') {
            resourceId += "SWF";
        }
        return resourceId;
    };

    /**
     * Функция записи заголовка as3 файла
     * @param filePath
     * @param resName
     * @returns {*|{info, type, negate}}
     */
    this._respackWriteHeader = function (filePath, resName) {
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
     * @param quality
     */
    this._respackProcessResource = function(filePath, resourceId, resourcePath, fileData, quality, rawEmbed) {
        var buffer = '';

        // md5 файла
        var md5 = crypto.createHash('md5').update(fs.readFileSync(resourcePath)).digest('hex');
        buffer += "\t// " + md5 + "\n";

        var absResourcePath = '../../../' + resourcePath;

        // опции встраивания
        if (rawEmbed) {
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
        self._respackWriteAppend(filePath, buffer);
    };

    /**
     * Дозаписываем файл в конец
     * @param filePath
     * @param content
     */
    this._respackWriteAppend = function (filePath, content) {
        return grunt.file.write(
            filePath, grunt.file.read(filePath) + content
        );
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

};


module.exports = function(grunt) {
    var stark = new StarkTools(grunt);

    grunt.task.registerMultiTask("resourcesJson", "Generate resourcesJson files!", function () {
        var options = this.options({
            hashAlgorithm : 'md5'
        });
        stark.resourcesJsonCreate(options);
    });

    grunt.task.registerMultiTask("bootJson", "Generate bootJson files!", function () {
        var options = this.options({
            hashAlgorithm : 'md5',
            dest: false
        });
        stark.bootJsonCreate(options);
    });

    grunt.task.registerMultiTask("generateRespacks", "Generate as3 files for respacks", function () {
        var options = this.options({
            'metaFile' : 'respacks.json',
            'rawEmbedExtensions': ['json', 'xml', 'csv', 'swf', 'atlas']
        });
        stark.generateRespacks(options);
    });

    grunt.task.registerMultiTask("compile", "Compile AS3 files", function () {
        var options = this.options({
            maxConcurrency: 1,
            fontsManagers: false,
            player: '11.4',
            staticLinkLibraries: true,
            libraries: false,
            sources: false,
            files: false,
            filesJson: false
        });


        var files = false;
        if (! options['files']) {
            if (! options['filesJson']) {
                return grunt.log.error("You must set files or filesJson option!");
            }
            // можно передать ссылку на JSON файл со списком компиляции
            files = grunt.file.readJSON(options['filesJson']);
        } else {
            files = options['files'];
        }

        // если равен нулю - дальше не идем, потому что все сломается
        if (Object.getOwnPropertyNames(files).length == 0) {
            return grunt.log.oklns("There no files to compile");
        }

        var done = this.async();
        var q = async.queue(stark.compile, options['maxConcurrency']);
        q.drain = done;

        for (var file in files) {
            if (! files.hasOwnProperty(file)) {
                continue;
            }
            var fileData = {
                options: options,
                src: files[file],
                dest: file
            };
            q.push(fileData);
        }
    });

    // синхронизация файлов на удаленный сервер
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

    // grunt.task.registerMultiTask("mainSwfRev", "Link for mainSwf into PHP", function () {
    //     var options = this.options({
    //         hashAlgorithm : 'md5'
    //     });
    //     stark.mainSwfRev(options);
    // });

    /**
     * Генерируем boot.json
     * @param options
     * @returns {boolean}
     */
    // this.mainSwfRev = function(options) {
    //     if (! grunt.file.exists(options['src'])) {
    //         return grunt.log.error("src is not found " + options['src']);
    //     }
    //     // разделяем на части путь
    //     var parts = options['src'].split('/').map(function(value) {
    //         return value.toLowerCase();
    //     });
    //
    //     var fileName = parts.pop();
    //     var fileData = fileName.split('.', 2);
    //     if (fileData.length != 2) {
    //         return false;
    //     }
    //     if (fileData[1] != 'swf') {
    //         return grunt.log.error("src is not swf " + options['src']);
    //     }
    //
    //     // новое имя файла
    //     var md5 = crypto.createHash(options['hashAlgorithm']).update(fs.readFileSync(options['src'])).digest('hex');
    //     var newFileName = fileData[0] + '~' + md5 + '.' + fileData[1];
    //
    //     // копиируем только если файла нет
    //     if (! grunt.file.exists(options['dest'] + newFileName)) {
    //         grunt.file.copy(options['src'], options['dest'] + newFileName);
    //         grunt.verbose.writeln(options['src'] + ' >>> ' + newFileName);
    //     } else {
    //         grunt.verbose.writeln('Main [' + fileData[0] + '] already exists!');
    //     }
    //
    //     var template =
    //         "<?php \r\n// Generated by GRUNT\r\n// Not modify,please!\r\n" +
    //         "// Time: " + grunt.template.today('yyyy-mm-dd HH:MM:ss') +  "\r\n" +
    //         "define('MAIN_FILENAME', '" + newFileName + "');\r\n" +
    //         "$AS_HOSTS = " + JSON.stringify(options['urls']) + ";\r\n";
    //
    //     grunt.file.write(options['destMetaFile'], template);
    //     grunt.log.oklns("Meta file: " + options['destMetaFile'] + " (" + template.length + ")");
    //     return true;
    // };
};
