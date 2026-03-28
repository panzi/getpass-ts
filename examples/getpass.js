import { getPass } from '../build/cjs/index.js';

/** @typedef {import('../src/index.js').Encoding} Encoding */
/** @typedef {import('../src/index.js').EncodingErrors} EncodingErrors */

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
                                    CHAR prints and deletions. [default: [5,50]]
    --encoding=ENCODING

        Parse password using ENCODING. Encoding errors are handled like Python's
        surrugateexcape encoding error handling method.

        Supported encodings:

            utf-8
            latin1
            ascii
            binary

        [default: utf-8]

    --errors=STRATEGY

        Use STRATEGY to handle encoding errors.

        Supported strategies:

            strict            Throw an Error.
            ignore            Ignore the invalid bytes.
            replace           Replace the invalid bytes with the unicode
                              replacement character � (U+FFFD).
            surrogateescape   Encode invalid bytes as a surrogate code of
                              U+DC00 + invalid_byte. This is the same strategy
                              Python uses for interfacing with the operating
                              system.

        [default: surrogateescape]

    --buffer-size=SIZE              Size of the internal buffer to use. Will
                                    grow if needed. [default: 2048]
    --tty=PATH                      The TTY device to use.
                                    [default: /dev/tty with fallback to
                                     /dev/stdin + /dev/stdout]
    --timeout=TIME                  Abort after TIME milliseconds.
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

    /** @type {EncodingErrors=} */
    let errors;

    /** @type {number=} */
    let bufferSize;

    /** @type {string=} */
    let tty;

    /** @type {number=} */
    let timeout;

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
                    switch (optarg) {
                        case 'utf-8':
                        case 'latin1':
                        case 'ascii':
                        case 'binary':
                            encoding = optarg;
                            break;

                        default:
                            console.error(`illegal argument to --${opt}=${optarg}`);
                            usage();
                            process.exit(1);
                            break;
                    }
                    break;

                case 'errors':
                    optarg = optarg?.toLowerCase();
                    switch (optarg) {
                        case 'strict':
                        case 'ignore':
                        case 'replace':
                        case 'surrogateescape':
                            errors = optarg;
                            break;

                        default:
                            console.error(`illegal argument to --${opt}=${optarg}`);
                            usage();
                            process.exit(1);
                            break;
                    }
                    break;

                case 'buffer-size':
                    bufferSize = +optarg;
                    if (isNaN(bufferSize) || bufferSize < 1) {
                        console.error(`illegal argument to --${opt}=${optarg}`);
                        usage();
                        process.exit(1);
                    }
                    break;

                case 'tty':
                    tty = optarg;
                    break;

                case 'timeout':
                    timeout = +optarg;
                    if (!isFinite(timeout) || timeout < 0) {
                        console.error(`illegal argument to --${opt}=${optarg}`);
                        usage();
                        process.exit(1);
                    }
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

    /** @type {AbortSignal=} */
    let signal;

    /** @type {NodeJS.Timeout?} */
    let timer = null;

    if (timeout !== undefined) {
        const abort = new AbortController();
        signal = abort.signal;
        timer = setTimeout(() => {
            timer = null;
            abort.abort();
        }, timeout);
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
        errors,
        bufferSize,
        tty,
        signal,
    });

    if (timer !== null) {
        clearTimeout(timer);
        timer = null;
    }

    const json = JSON.stringify({ password });
    if (encoding && encoding !== 'binary') {
        process.stdout.write(Buffer.from(json + '\n', encoding));
    } else {
        console.log(json);
    }
}

main();
