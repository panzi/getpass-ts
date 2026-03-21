/*
 * Copyright 2016, Joyent, Inc. All rights reserved.
 * Author: Alex Wilson <alex.wilson@joyent.com>
 * 
 * Copyright 2026 Mathias Panzenböck
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
*/

// Inspired by: https://github.com/arekinath/node-getpass

import tty from 'tty';
import fs from 'fs/promises';
import { randomInt } from 'crypto';

function isNodeError<T extends ErrorConstructor>(error: unknown, errorType: T): error is InstanceType<T> & NodeJS.ErrnoException {
    return error instanceof errorType;
}

const CTRLC     = 0x0003;
const CTRLD     = 0x0004;
const LF        = 0x000A;
const CR        = 0x000D;
const ESCAPE    = 0x001B;
const BACKSPACE = 0x007F;

export interface GetPassOptions {
    /**
     * Prompt to display.
     * @default 'Password: '
     */
    prompt?: string;

    /**
     * Parse input to string using this encoding.
     * @default 'utf-8'
     */
    encoding?: BufferEncoding;

    /**
     * Print this character when the user types.
     * @default '*'
     */
    echoChar?: string;

    /**
     * A [min, max] tuple of integers.
     * The `echoChar` is randomly repeated `n` times where `min` <= `n` and `n` <= `max`.
     * If `echoChar` is passed but `echoRepeat` isn't, then the `echoChar` is written
     * exactly once by input byte.
     * 
     * @default undefined
     */
    echoRepeat?: [number, number];
}

/**
 * Read a password from the terminal.
 * @returns The password or `null` if the user aborted.
 */
export async function getPass(options?: GetPassOptions|string): Promise<string|null> {
    let prompt = 'Password: ';
    let encoding: BufferEncoding = 'utf-8';
    let echoChar = '*';
    let echoRepeatMin = 0;
    let echoRepeatMax = 0;

    if (typeof options === 'string') {
        prompt = options;
    } else if (options) {
        const {
            prompt: oPrompt,
            encoding: oEncoding,
            echoChar: oEchoChar,
            echoRepeat: oEchoRepeat,
        } = options;
        if (oPrompt !== undefined) {
            prompt = oPrompt;
        }

        if (oEncoding !== undefined) {
            encoding = oEncoding;
        }

        if (oEchoRepeat !== undefined) {
            echoRepeatMin = oEchoRepeat[0];
            echoRepeatMax = oEchoRepeat[1];
            if (
                !isFinite(echoRepeatMin) ||
                !isFinite(echoRepeatMax) ||
                (echoRepeatMin|0) !== echoRepeatMin ||
                (echoRepeatMax|0) !== echoRepeatMax ||
                echoRepeatMin < 0 ||
                echoRepeatMax < echoRepeatMin
            ) {
                throw new RangeError(`echoRepeat needs to be a [min, max] tuple of integers where min >= 0 and min <= max: [${oEchoRepeat}]`);
            }
        }

        if (oEchoChar !== undefined) {
            echoChar = oEchoChar;
            if (oEchoRepeat === undefined) {
                echoRepeatMin = 1;
                echoRepeatMax = 2;
            }
        }
    }

    const { rfd, wfd } = await openTTY();
    let rtty: tty.ReadStream|undefined;
    let wtty: tty.WriteStream|undefined;

    try {
        rtty = new tty.ReadStream(rfd.fd);
        wtty = new tty.WriteStream(wfd.fd);

        wtty.write(prompt);
        rtty.resume();
        rtty.setRawMode(true);
        rtty.resume();

        let buffer: Buffer|null = null;
        let offset = 0;
        let ended = false;

        let readResolve: (buffer: Buffer|null) => void;
        let readReject: (error: Error) => void;
        let readPromise: Promise<Buffer|null>|null = null;

        const onData = (buffer: Buffer) => {
            readResolve(buffer);
            readPromise = null;
        };

        const onError = (error: Error) => {
            readReject(error);
            readPromise = null;

            rtty?.off('data', onData);
            rtty?.off('error', onError);
            rtty?.off('end', onEnd);
        };

        const onEnd = () => {
            readResolve(null);
            readPromise = null;

            rtty?.off('data', onData);
            rtty?.off('error', onError);
            rtty?.off('end', onEnd);
        };

        rtty.on('data', onData);
        rtty.on('error', onError);
        rtty.on('end', onEnd);

        async function readByte(): Promise<number> {
            if (!buffer || offset >= buffer.byteLength) {
                if (ended) {
                    return -1;
                }

                offset = 0;
                buffer = null;

                if (!readPromise) {
                    readPromise = new Promise((resolve, reject) => {
                        readResolve = resolve;
                        readReject  = reject;
                    });
                }

                buffer = await readPromise;

                if (!buffer || ended) {
                    ended = true;
                    return -1;
                }
            }

            return buffer[offset ++];
        }

        try {
            const passwordBytes: number[] = [];
            const widths: number[] = [];

            function appendByte(byte: number): void {
                passwordBytes.push(byte);

                if (echoRepeatMax) {
                    const echo =
                        echoRepeatMin === echoRepeatMax ? echoChar :
                        echoChar.repeat(randomInt(echoRepeatMin, echoRepeatMax + 1));
                    wtty?.write(echo);
                    widths.push(echo.length);
                }
            }

            // TODO: turn on paste mode? CSI ? 2004 h
            for (;;) {
                let byte = await readByte();
                if (byte < 0) return null;

                if (byte === ESCAPE) {
                    // see: https://en.wikipedia.org/wiki/ANSI_escape_code#Terminal_input_sequences

                    let escapeTimer: NodeJS.Timeout|null = setTimeout(async () => {
                        escapeTimer = null;
                        ended = true;
                        readResolve?.(null);
                    }, 25);

                    try {
                        byte = await readByte();
                        if (byte < 0 || byte === ESCAPE) {
                            // ESC ESC is either the user pressing ESC twice or Alt-ESC
                            return null;
                        }
                    } finally {
                        if (escapeTimer !== null) {
                            clearTimeout(escapeTimer);
                            escapeTimer = null;
                        }
                    }

                    if (byte === 0x5B) { // '['
                        byte = await readByte();
                        if (byte < 0) {
                            return null;
                        }

                        if (
                            (byte >= 0x41 && byte <= 0x5A) || // 'A' ... 'Z'
                            (byte >= 0x61 && byte <= 0x7A)    // 'a' ... 'z'
                        ) {
                            // ignore Alt-keypress or keycode sequence
                        } else if (byte >= 0x30 && byte <= 0x39) { // '0' ... '9'
                            // TODO: do something with this
                            while (byte >= 0x30 && byte <= 0x39) { // '0' ... '9'
                                byte = await readByte();
                                if (byte < 0) {
                                    return null;
                                }
                            }

                            if (
                                (byte >= 0x41 && byte <= 0x5A) || // 'A' ... 'Z'
                                (byte >= 0x61 && byte <= 0x7A)    // 'a' ... 'z'
                            ) {
                                // keycode sequence, <modifier> is a decimal
                                // number and defaults to 1 (xterm)
                            } else {
                                if (byte === 0x3b) { // ';'
                                    for (;;) {
                                        byte = await readByte();
                                        if (byte < 0) {
                                            return null;
                                        }
                                        if (!(byte >= 0x30 && byte <= 0x39)) { // '0' ... '9'
                                            break;
                                        }
                                    }
                                }

                                if (byte === 0x7E) { // '~'
                                    // keycode sequence, <keycode> and <modifier>
                                    // are decimal numbers and default to 1 (vt)
                                } else {
                                    return null;
                                }
                            }
                        } else {
                            return null;
                        }
                    } else if (byte === 0x4F) { // 'O'
                        byte = await readByte();
                        if (byte < 0) {
                            return null;
                        }

                        if (byte === 0x4D) { // 'M'
                            // Shift+Enter -> '\n'
                            appendByte(LF);
                        } else if (
                            (byte >= 0x41 && byte <= 0x5A) || // 'A' ... 'Z'
                            (byte >= 0x61 && byte <= 0x7A)    // 'a' ... 'z'
                        ) {
                            // function keys and such
                        } else {
                            return null;
                        }
                    } else {
                        return null;
                    }
                } else if (byte === CTRLD || byte === LF || byte == CR || byte === 0) {
                    break;
                } else {
                    switch (byte) {
                        case CTRLC:
                            return null;

                        case BACKSPACE:
                            passwordBytes.pop();
                            const width = widths.pop();
                            if (width) {
                                wtty.write(`\x1B[${width}D\x1B[K`)
                            }
                            break;

                        default:
                            appendByte(byte);
                            break;
                    }
                }
            }

            return Buffer.from(passwordBytes).toString(encoding);
        } finally {
            rtty.off('data', onData);
            rtty.off('error', onError);
            rtty.off('end', onEnd);
        }
    } finally {
        try {
            wtty?.write('\n');
        } finally {
            try {
                if (rtty) {
                    rtty.setRawMode(false);
                    rtty.pause();
                }
            } finally {
                try {
                    wtty?.end();
                    await wfd.close();
                    wtty?.destroy();
                } finally {
                    rtty?.end();
                    await rfd.close();
                    rtty?.destroy();
                }
            }
        }
    }
}

interface TTY {
    rfd: fs.FileHandle;
    wfd: fs.FileHandle;
}

async function openTTY(): Promise<TTY> {
    let rfd: fs.FileHandle|null = null;
    let wfd: fs.FileHandle|null = null;

    try {
        rfd = await fs.open('/dev/tty', 'r');
        wfd = await fs.open('/dev/tty', 'w');

        return { rfd, wfd };
    } catch (error) {
        try { rfd?.close(); } catch (error2) {}
        try { wfd?.close(); } catch (error2) {}

        if (isNodeError(error, Error) && (error.code === 'ENOENT' || error.code === 'EACCES')) {
            // There is no fs.fdopen(number) in NodeJS?
            rfd = await fs.open('/dev/stdin', 'r');

            try {
                wfd = await fs.open('/dev/stdout', 'w');
            } catch (error2) {
                try { rfd?.close(); } catch (error2) {}

                throw error2;
            }

            return { rfd, wfd };
        }

        throw error;
    }
}
