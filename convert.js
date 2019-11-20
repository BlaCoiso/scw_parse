/* eslint-env node, es6 */
const SC3D = require("./SC3D");
const fs = require("fs");
const util = require("util");
const path = require("path");

const readFilePromise = util.promisify(fs.readFile);
const writeFilePromise = util.promisify(fs.writeFile);

//Uncomment one of these and edit for specifying the default import path
//SC3D.importPath = "/path/to/sc3d/folder";
//SC3D.importPath = "C:\\path\\to\\sc3d\\folder";

main(process.argv.slice(2));

/**
 * @param {string[]} args 
 */
function main(args) {
    const version = SC3D.getVersion();
    let files = [];
    let libs = [];
    let outputName = "";
    let sourceFolder = "";
    let outputFolder = "";
    let verbose = false;
    let exit = false;
    let skipNext = false;
    let all = false;

    const commands = [
        ['h', "help", "Displays this message", () => {
            console.log(`convert.js (SC3D.js [${version}])\n${helpMessage}`);
            exit = true;
        }],
        ['f', ["folder", "source"], "Source folder / import path", n => {
            sourceFolder = n;
            skipNext = true;
        }],
        ['v', "verbose", "Use verbose output", () => verbose = true],
        ['o', "output", "Output file/folder name", n => {
            outputName = n;
            skipNext = true;
        }],
        ['a', "all", "Export all files", () => all = true],
        ['l', ["lib", "library"], "Include libraries (single file only)", n => {
            libs.push(n);
            skipNext = true;
        }]
    ];

    const helpMessage = "Usage: convert [flags] [files]" + commands.map(c => {
        let names = [];
        if (c[0]) names.push('-' + c[0]);
        if (c[1] && typeof c[1] === "string") names.push("--" + c[1]);
        else if (c[1]) c[1].forEach(cn => names.push("--" + cn));
        return `\n ${names.join(", ")}: ${c[2]}`;
    }
    );

    for (let argIdx = 0; argIdx < args.length; ++argIdx) {
        const arg = args[argIdx];
        let next = args[argIdx + 1];
        let c = null;
        let ignoreSkip = false;
        if (arg.startsWith("--")) {
            c = commands.find(c => c[1] ? (typeof c[1] === "string" ? c[1] === arg.slice(2) : c[1].includes(arg.slice(2))) : c[0] === arg[2]);
            if (!c) {
                console.error("Unknown switch " + arg);
                return;
            }
        } else if (arg.startsWith('-')) {
            c = commands.find(c => c[0] === arg[1]);
            if (!c) {
                console.error("Unknown switch " + arg);
                return;
            }
            if (arg.length > 2) {
                next = arg.slice(2);
                ignoreSkip = true;
            }
        } else {
            if (skipNext) skipNext = false;
            else files.push(arg);
        }
        if (c && c[3]) c[3](next);
        if (ignoreSkip) skipNext = false;
        if (exit) return;
    }

    if (sourceFolder) SC3D.importPath = sourceFolder;
    if (files.length !== 1) {
        outputFolder = outputName;
        if (outputFolder && !fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
    }

    if (files.length === 0) all = true;
    else if (files.length === 1) {
        verbose = true;
        loadAndExport(files[0], outputName, libs.map(l => SC3D.importLib(l)), true);
    } else {
        const exportRequests = files.map(f => loadAndExport(f, path.basename(f).replace(/(\.scw)?$/, ".dae"), null, true));
        Promise.all(exportRequests).then(r => console.log(`Exported ${r.length} files.`));
    }
    if (files.length > 0 && all) {
        console.warn("Ignoring all file flag, files were specified");
        all = false;
    }

    if (all) {
        files = fs.readdirSync(sourceFolder || '.').filter(f => f.endsWith(".scw"));
        const exportRequests = files.map(f => loadAndExport((sourceFolder ? sourceFolder + '/' : "") + f,
            f.replace(/(\.scw)?$/, ".dae")
        ));
        Promise.all(exportRequests).then(r => console.log(`Exported ${r.length} files.`));
    }

    function loadAndExport(source, result, libraries, useImportLib) {
        if (!result) result = source.replace(/(\.scw)?$/, ".dae");
        if (outputFolder) result = outputFolder + '/' + result;
        if (useImportLib) {
            const lib = SC3D.importLib(source);
            if (verbose) console.log(`Exporting ${lib.name} into ${result}...`);
            return writeFilePromise(result, lib.exportModel(libraries));
        } else {
            return readFilePromise(source).then(data => {
                const lib = new SC3D(data, source);
                if (verbose) console.log(`Exporting ${source} into ${result}...`);
                return writeFilePromise(result, lib.load().exportModel(libraries));
            });
        }
    }
}