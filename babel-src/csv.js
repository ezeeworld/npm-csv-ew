'use strict';

const readline = require('readline');
const iconv = require('iconv-lite');
var fs = require('fs');
fs = {
    createReadStream: fs.createReadStream,
    readFile: promisify(fs.readFile),
};
const _ = require('lodash');

const defaultOptions = {
    delimiter: ',',
    headerDelimiter: 'auto',
    trimLine: false,
    trimColumns: false,
    raiseOnEmptyLines: true,
    raiseOnMissingColumns: true,
    raiseOnExtraColumns: true,
    returnLines: false,
    returnArrays: false,
    handleQuotes: true,
    defaultValueOnEmptyColumn: '',
    defaultValueOnMissingColumn: null,
    columnNames: 'auto',
    skipFirstLine: false,
    skipEmptyLines: true,
    encoding: 'utf-8',
    firstLineEncoding: 'auto',
};

module.exports = new_();
function new_(mainOptions) {
    mainOptions = _.cloneDeep(mainOptions || {});
    _.defaultsDeep(mainOptions, defaultOptions);
    return _.assign(new_.bind(), {
        eachEntry: eachEntry,
        fromJson: fromJson,
    });

    function fromJson(options) {
        options = _.clone(options || {});
        _.defaultsDeep(options, mainOptions);
        requireOptions(options, [
            'input',
            'columnNames',
            'delimiter',
        ]);
        const inputType = typeof options.input;
        var output = '';
        if (inputType === 'string') {
            var inputPromise = fs.readFile(options.input)
            .then(content => JSON.parse(content));
        } else {
            inputPromise = Promise.resolve(options.input);
        }
        var columnNames = [];
        return inputPromise.then(function(jsonArray) {
            if (options.columnNames === 'auto') {
                jsonArray.forEach(function(item) {
                    for (var key in item) {
                        if (!_.includes(columnNames, key)) {
                            columnNames.push(key);
                        }
                    }
                });
            } else {
                columnNames = options.columnNames;
            }
            jsonArray.forEach(function(item) {
                var csvLine = '';
                columnNames.forEach(function(columnName) {
                    csvLine += '' + item[columnName] + options.delimiter;
                });
                output += csvLine.substr(0, csvLine.length - options.delimiter.length) + '\n';
            });
        }).then(function() {
            return `${columnNames.join(options.delimiter)}\n${output}`;
        });
    }

    function eachEntry(options) {
        options = _.cloneDeep(options || {});
        _.defaultsDeep(options, mainOptions);
        requireOptions(options, [
            'filename',
            'iterator',
            'delimiter',
            'headerDelimiter',
            'trimLine',
            'trimColumns',
            'raiseOnEmptyLines',
            'raiseOnMissingColumns',
            'raiseOnExtraColumns',
            'returnLines',
            'returnArrays',
            'handleQuotes',
            'defaultValueOnEmptyColumn',
            'defaultValueOnMissingColumn',
            'columnNames',
            'skipFirstLine',
            'skipEmptyLines',
            'encoding',
            'firstLineEncoding',
        ]);
        return new Promise(function(resolve, reject) {
            var _iterator = wrapIterator(options.iterator);
            var rl = readline.createInterface({
                input: fs.createReadStream(options.filename),
            });
            var lineNumber = 0;
            var columnNames = options.columnNames;
            var errorFound;
            var raiseForCurrentLine = function(message) {
                errorFound = new Error('line ' + lineNumber + ': ' + message);
                rl.close();
                return process.nextTick(onLineCompleted);
            };
            var rlStack = [];
            var isWorking = false;
            var charset = 0;
            rl.on('line', function onLine(line) {
                var lineBuffer = new Buffer(line);
                if (charset === 0) {
                    while(_.includes([0xEF, 0xBF, 0xBB, 0xBD], lineBuffer[0])) {
                        lineBuffer = lineBuffer.slice(1);
                    }
                    line = '' + lineBuffer;
                    lineBuffer = new Buffer(line);
                    let encoding = options.firstLineEncoding === 'auto' ? options.encoding : options.firstLineEncoding;
                    line = iconv.decode(new Buffer(line), encoding, { stripBOM: true });
                    charset++;
                } else if (charset === 1) {
                    charset = options.encoding;
                    line = iconv.decode(new Buffer(line), charset);
                } else {
                    line = iconv.decode(new Buffer(line), charset);
                }
                rl.pause();
                if (!isWorking) {
                    isWorking = true;
                    return onLineSafe(line);
                }
                rlStack.push(line);
            });
            rl.on('close', () => errorFound ? reject(errorFound) : resolve());
            function onLineCompleted() {
                if (rlStack.length) {
                    return onLineSafe(rlStack.shift());
                }
                isWorking = false;
                rl.resume();
            }
            function onLineSafe(line) {
                lineNumber++;
                if (options.trimLine) {
                    line = line.trim();
                }
                if (!line.length) {
                    if (options.raiseOnEmptyLines) {
                        return raiseForCurrentLine('empty line');
                    } else if (options.skipEmptyLines) {
                        return process.nextTick(onLineCompleted);
                    }
                }
                if (options.returnLines) {
                    return _iterator(line).then(onLineCompleted, reject);
                }
                var delimiter = lineNumber !== 1 || options.headerDelimiter === 'auto' ? options.delimiter : options.headerDelimiter;
                if (lineNumber === 1) {
                    if (line.indexOf(delimiter) === 0) {
                        line = line.substr(delimiter.length);
                    }
                    if (line.lastIndexOf(delimiter) === line.length - delimiter.length) {
                        line = line.substr(0, line.length - delimiter.length);
                    }
                }
                var lineSplit = splitLine(line, delimiter, options.handleQuotes);
                if (options.trimColumns) {
                    lineSplit = lineSplit.map(function(column) {
                        return column.trim();
                    });
                }
                if (options.defaultValueOnEmptyColumn !== '') {
                    lineSplit = lineSplit.map(function(column) {
                        return column.length ? column : options.defaultValueOnEmptyColumn;
                    });
                }
                if (lineNumber == 1) {
                    if (columnNames === 'auto') {
                        columnNames = lineSplit;
                        for (var i = 0; i < columnNames.length; i++) {
                            if (!columnNames[i].length) {
                                return raiseForCurrentLine('empty header column');
                            }
                        }
                        return process.nextTick(onLineCompleted);
                    } else if (options.skipFirstLine) {
                        return process.nextTick(onLineCompleted);
                    }
                }
                if (options.raiseOnMissingColumns && lineSplit.length < columnNames.length) {
                    return raiseForCurrentLine('missing columns: expected ' + columnNames.length + ' but found only ' + lineSplit.length);
                }
                if (options.raiseOnExtraColumns && lineSplit.length > columnNames.length) {
                    return raiseForCurrentLine('extra columns: expected ' + columnNames.length + ' but found ' + lineSplit.length);
                }
                if (lineSplit.length < columnNames.length) {
                    _.times(columnNames.length - lineSplit.length, function() {
                        lineSplit.push(options.defaultValueOnMissingColumn);
                    });
                }
                if (options.returnArrays) {
                    return _iterator(lineSplit).then(onLineCompleted, reject);
                }
                var record = {};
                var i = -1;
                lineSplit.forEach(function(columnValue) {
                    i++;
                    record[columnNames[i]] = columnValue;
                });
                return _iterator(record).then(onLineCompleted, reject);
            }
        });
    }
}

function requireOptions(providedOptions, requiredOptionNames) {
    requiredOptionNames.forEach(function(optionName) {
        if (typeof providedOptions[optionName] === 'undefined') {
            throw new Error('missing option: ' + optionName);
        }
    });
}

function splitLine(line, delimiter, handleQuotes) {
    if (handleQuotes) {
        var lineSplit = [];
        var currentColumn = '';
        var currentMode = 0;
        for (var i = 0; i < line.length; i++) {
            var currentChar = line[i];
            if (currentMode === 0) {
                if (currentChar === delimiter) {
                    lineSplit.push(currentColumn);
                    currentColumn = '';
                } else if (!currentColumn.length && currentChar === '"') {
                    currentMode = 1;
                } else {
                    currentColumn += currentChar;
                }
            } else if (currentMode === 1) {
                if (currentChar === '"') {
                    currentMode = 2;
                } else {
                    currentColumn += currentChar;
                }
            } else if (currentMode === 2) {
                if (currentChar === '"') {
                    currentMode = 1;
                    currentColumn += currentChar;
                } else if (currentChar === delimiter) {
                    currentMode = 0;
                    lineSplit.push(currentColumn);
                    currentColumn = '';
                } else {
                    currentMode = 0;
                    currentColumn = '"' + currentColumn.replace('"', '""') + '"' + currentChar;
                }
            }
        }
        lineSplit.push(currentColumn);
    } else {
        lineSplit = line.split(delimiter);
    }
    return lineSplit;
}

function wrapIterator(iterator) {
    return record => new Promise((resolve, reject) => resolve(iterator(record)));
}

function promisify(toPromisify) {
    return function() {
        const args = Array.prototype.slice.call(arguments);
        return new Promise((resolve, reject) => {
            args.push((err, result) => err ? reject(err) : resolve(result));
            toPromisify.apply(this, args);
        });
    };
}