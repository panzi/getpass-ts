import { getPass } from '../build/index.js';

/** @typedef {import('../src/index.js').Encoding} Encoding */

function usage() {
    console.log(`Usage: ${process.argv[0]} ${process.argv[1]} [OPTIONS] [--help]`);
}

function help() {
    usage();
    console.log(`
    --help                          Print this help message.
    --prompt=PROMPT                 Print PROMPT before reading input.
    --echo-char=CHAR                Use CHAR as echo. [default: *]
    --echo-repeat=COUNT|MIN..MAX    Print the echo CHAR either exactly COUNT
                                    times on every keypress, or a random number
                                    of times between MIN and MAX (inclusve).
                                    [default: 0]
    --repeat-delay=TIME|MIN..MAX    Range of a random delay between repeated
                                    CHAR prints and deletions. [default: [0,80]]
    --encoding=ENCODING

        Parse password using ENCODING. Encoding errors are handled like Python's
        surrugateexcape encoding error handling method.

        Supported encodings:

            utf-8
            latin1
            ascii
            binary

        [default: utf-8]
`);
}

async function main() {
    /** @type {string=} */
    let prompt;

    /** @type {string=} */
    let echoChar;

    /** @type {number=} */
    let echoRepeatMin;

    /** @type {number=} */
    let echoRepeatMax;

    /** @type {number=} */
    let repeatDelayMin;

    /** @type {number=} */
    let repeatDelayMax;

    /** @type {Encoding=} */
    let encoding;

    /** @type {string[]} */
    let nonopts = [];
    let argind = 2;
    while (argind < process.argv.length) {
        const arg = process.argv[argind ++];
        if (arg === '--') {
            break;
        }

        if (arg.startsWith('--')) {
            const eqIndex = arg.indexOf('=');

            /** @type {string} */
            let opt;

            /** @type {string=} */
            let optarg;

            if (eqIndex < 0) {
                opt = arg.slice(2);
                optarg = process.argv[argind ++];
            } else {
                opt = arg.slice(2, eqIndex);
                optarg = arg.slice(eqIndex + 1);
            }

            switch (opt) {
                case 'prompt':
                    prompt = optarg;
                    break;

                case 'echo-char':
                    echoChar = optarg;
                    break;

                case 'echo-repeat':
                {
                    if (!optarg) {
                        console.error(`illegal argument to --${opt}=${optarg}`);
                        usage();
                        process.exit(1);
                    }

                    const parts = optarg.split('..');
                    if (parts.length > 2 || parts.length < 1) {
                        console.error(`illegal argument to --${opt}=${optarg}`);
                        usage();
                        process.exit(1);
                    }

                    echoRepeatMin = +parts[0];
                    echoRepeatMax = parts.length > 1 ? +parts[1] : echoRepeatMin;
                    break;
                }
                case 'repeat-delay':
                {
                    if (!optarg) {
                        console.error(`illegal argument to --${opt}=${optarg}`);
                        usage();
                        process.exit(1);
                    }

                    const parts = optarg.split('..');
                    if (parts.length > 2 || parts.length < 1) {
                        console.error(`illegal argument to --${opt}=${optarg}`);
                        usage();
                        process.exit(1);
                    }

                    repeatDelayMin = +parts[0];
                    repeatDelayMax = parts.length > 1 ? +parts[1] : repeatDelayMin;
                    break;
                }
                case 'encoding':
                    optarg = optarg?.toLowerCase();
                    if (optarg !== 'utf-8' && optarg !== 'latin1' && optarg !== 'ascii' && optarg !== 'binary') {
                        console.error(`illegal argument to --${opt}=${optarg}`);
                        usage();
                        process.exit(1);
                    }
                    encoding = optarg;
                    break;

                case 'help':
                    help();
                    return;

                default:
                    console.error(`illegal option: --${opt}`);
                    usage();
                    process.exit(1);
                    break;
            }
        } else {
            nonopts.push(arg);
        }
    }

    if (nonopts.length) {
        console.error(`unexpected non-option arguments`);
        usage();
        process.exit(1);
    }

    const password = await getPass({
        prompt,
        echoChar,
        echoRepeat: echoRepeatMin !== undefined && echoRepeatMax !== undefined ? [echoRepeatMin, echoRepeatMax] :
                    echoRepeatMin !== undefined ? [echoRepeatMin, echoRepeatMin] :
                    echoRepeatMax !== undefined ? [1, echoRepeatMax] :
                    undefined,
        repeatDelay: repeatDelayMin !== undefined && repeatDelayMax !== undefined ? [repeatDelayMin, repeatDelayMax] :
                     repeatDelayMin !== undefined ? [repeatDelayMin, repeatDelayMin] :
                     repeatDelayMax !== undefined ? [1, repeatDelayMax] :
                     undefined,
        encoding,
    });
    console.log(JSON.stringify({ password }));
}

main();
