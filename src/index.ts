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

// Adapted from: https://github.com/arekinath/node-getpass

import tty from 'tty';
import fs from 'fs/promises';

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
    prompt?: string;
}

const NL = process.platform === 'win32' ? '\r\n' : '\n';

export async function getPass(options?: GetPassOptions|string): Promise<string|null> {
    const prompt = typeof options === 'string' ? options : options?.prompt ?? 'Password: ';

    const { rfd, wfd, rtty, wtty } = await openTTY();

    wtty.write(prompt);
    rtty.resume();
    rtty.setRawMode(true);
    rtty.resume();
    rtty.setEncoding('utf8');

    try {
        const password = await new Promise<string|null>((resolve, reject) => {
            const password: number[] = [];
            let escapeTimer: NodeJS.Timeout|null = null;

            const cleanup = () => {
                if (escapeTimer !== null) {
                    clearTimeout(escapeTimer);
                    escapeTimer = null;
                }
                rtty.removeListener('data', onData);
                rtty.removeListener('error', onError);
            };

            const onError = (error: Error) => {
                cleanup();
                reject(error);
            };

            const onEscapeTimeout = () => {
                escapeTimer = null;
                cleanup();
                resolve(null);
            };

            const onData = async (data: string) => {
                try {
                    if (data.length === 0) {
                        return;
                    }
                    for (let index = 0; index < data.length;) {
                        const codepoint = data.codePointAt(index);

                        switch (codepoint) {
                        case 0:
                        case CR:
                        case LF:
                        case CTRLD:
                            cleanup();
                            resolve(String.fromCodePoint(...password));
                            return;

                        case CTRLC:
                            cleanup();
                            resolve(null);
                            return;

                        case BACKSPACE:
                            password.pop();
                            break;

                        case ESCAPE:
                            if (password.length > 0 && password[password.length - 1] === ESCAPE) {
                                cleanup();
                                resolve(null);
                                return;
                            }
                            password.push(codepoint);
                            break;

                        case undefined:
                            return;

                        default:
                            if (
                                password.length >= 2 &&
                                password[password.length - 2] === ESCAPE
                             ) {
                                if (
                                    password[password.length - 1] === 0x5B && // '['
                                    (
                                        (codepoint >= 0x41 && codepoint <= 0x5A) || // 'A' ... 'Z'
                                        (codepoint >= 0x61 && codepoint <= 0x7A)    // 'a' ... 'z'
                                    )
                                ) {
                                    // strip simple escape sequences, like cursor moves
                                    password.pop();
                                    password.pop();
                                    break;
                                } else if (
                                    password[password.length - 1] === 0x4F && // 'O'
                                    codepoint === 0x4D // 'M'
                                ) {
                                    // Shift+Enter -> '\n'
                                    password.pop();
                                    password[password.length - 1] = LF;
                                    break;
                                } else if (
                                    password[password.length - 1] === 0x4F && // 'O'
                                    (codepoint >= 0x41 && codepoint <= 0x5A)  // 'A' ... 'Z'
                                ) {
                                    // function keys and such
                                    password.pop();
                                    password.pop();
                                    break;
                                }
                            } else if (
                                password.length >= 3 &&
                                password[password.length - 3] === ESCAPE &&
                                password[password.length - 2] === 0x5B && // '['
                                (password[password.length - 1] >= 0x30 && password[password.length - 1] <= 0x39) && // '0' ... '9'
                                codepoint === 0x7E // '~'
                            ) {
                                // Insert, Delete, Page Up, Page Down, ...
                                password.pop();
                                password.pop();
                                password.pop();
                                break;
                            } else if (
                                password.length >= 4 &&
                                password[password.length - 4] === ESCAPE &&
                                password[password.length - 3] === 0x5B && // '['
                                (password[password.length - 2] >= 0x30 && password[password.length - 2] <= 0x39) && // '0' ... '9'
                                (password[password.length - 1] >= 0x30 && password[password.length - 1] <= 0x39) && // '0' ... '9'
                                codepoint === 0x7E // '~'
                            ) {
                                password.pop();
                                password.pop();
                                password.pop();
                                password.pop();
                                break;
                            }
                            password.push(codepoint);
                            break;
                        }

                        index += codepoint >= 0x010000 ? 2 : 1;
                    }

                    if (password.length > 0 && password[password.length - 1] === ESCAPE) {
                        if (escapeTimer === null) {
                            escapeTimer = setTimeout(onEscapeTimeout, 25);
                        }
                    } else if (escapeTimer !== null) {
                        clearTimeout(escapeTimer);
                        escapeTimer = null;
                    }
                } catch (error) {
                    cleanup();
                    reject(error);
                }
            };

            rtty.on('data', onData);
            rtty.on('error', onError);
        });

        return password;
    } finally {
        wtty.write(NL);
        rtty.setRawMode(false);
        rtty.pause();

        if (wfd !== undefined && wfd !== rfd) {
            wtty.end();
            await wfd.close();
            wtty.destroy();
        }

        if (rfd !== undefined) {
            rtty.end();
            await rfd.close();
            rtty.destroy();
        }
    }
}

interface TTY {
    rfd?: fs.FileHandle;
    wfd?: fs.FileHandle;
    rtty: NodeJS.ReadStream;
    wtty: NodeJS.WriteStream;
}

async function openTTY(): Promise<TTY> {
    if (process.platform === 'win32') {
        return { rtty: process.stdin, wtty: process.stdout };
    }

    let rfd: fs.FileHandle|null = null;
    let wfd: fs.FileHandle|null = null;

    try {
        rfd = await fs.open('/dev/tty', 'r+');
        wfd = await fs.open('/dev/tty', 'w+');

        const rtty = new tty.ReadStream(rfd.fd);
        const wtty = new tty.WriteStream(wfd.fd);

        return { rfd, wfd, rtty, wtty };
    } catch (error) {
        try { rfd?.close(); } catch (error2) {}
        try { wfd?.close(); } catch (error2) {}

        if (isNodeError(error, Error) && (error.code === 'ENOENT' || error.code === 'EACCES')) {
            return { rtty: process.stdin, wtty: process.stdout };
        }

        throw error;
    }
}
