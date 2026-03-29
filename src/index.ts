/*
 * Very much inspired by https://github.com/arekinath/node-getpass
 *    Copyright 2016, Joyent, Inc. All rights reserved.
 *    Author: Alex Wilson <alex.wilson@joyent.com>
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

import tty from 'tty';
import fs from 'fs/promises';
import { randomInt } from 'crypto';

let wcswidth: (text: string) => number;

try {
    wcswidth = require('wcwidth-o1').wcswidth;
} catch (error) {
    try {
        wcswidth = require('wcswidth');
    } catch (error) {
        try {
            wcswidth = require('simple-wcswidth').wcswidth;
        } catch (error) {
            wcswidth = (text: string) => text.replace(/([^\n])\p{Mn}+/gu, '$1').replace(/\p{Emoji_Presentation}/gu, 'xx').length;
        }
    }
}

function isNodeError<T extends ErrorConstructor>(error: unknown, errorType: T): error is InstanceType<T> & NodeJS.ErrnoException {
    return error instanceof errorType;
}

function isCont(byte: number): boolean {
    return byte >= 0x80 && byte < 0xC0;
}

const CTRLC     = 0x0003;
const CTRLD     = 0x0004;
const LF        = 0x000A;
const CR        = 0x000D;
const ESCAPE    = 0x001B;
const BACKSPACE = 0x007F;

/**
 * Encodings supported by `getPass()`.
 */
export type Encoding = 'utf-8'|'latin1'|'ascii'|'binary';

/**
 * Encoding error handling methods of `getPass()`.
 */
export type EncodingErrors = 'strict'|'ignore'|'replace'|'surrogateescape';

/**
 * Options for `getPass()`.
 */
export interface GetPassOptions {
    /**
     * Prompt to display.
     * @default 'Password: '
     */
    prompt?: string;

    /**
     * Parse input to string using this encoding.
     * 
     * If `'binary'` is passed `getPass()` will return a `Buffer` object.
     * 
     * @default 'utf-8'
     */
    encoding?: Encoding;

    /**
     * How do handle encoding errors.
     * 
     * * `'strict'` - Throw an `Error`.
     * * `'ignore'` - Ignore the invalid bytes.
     * * `'replace'` - Replace the invalid bytes with the unicode replacement
     *   character � (`U+FFFD`).
     * * `'surrogateescape'` - Encode invalid bytes as a surrogate code of
     *   `U+DC00 + invalid_byte`. This is the same strategy Python uses for
     *    interfacing with the operating system.
     * 
     * @default 'surrogateescape'
     */
    errors?: EncodingErrors;

    /**
     * Print this character when the user types.
     * 
     * May not include codepoints in the range of `U+0000` to `U+001F` (inclusive).
     * These are things like `\t`, `\n`, Escape etc.
     * 
     * @default '*'
     */
    echoChar?: string;

    /**
     * Display width of `echoChar`.
     * 
     * If not given it is attempted to determine the display width with this
     * fallback list of libraries:
     * 
     * * [wcwidth-o1](https://www.npmjs.com/package/wcwidth-o1)
     * * [wcswidth](https://www.npmjs.com/package/wcwidth)
     * * [simple-wcswidth](https://www.npmjs.com/package/simple-wcswidth)
     * 
     * If none of them are available this fallback method is used:
     * 
     * ```JavaScript
     * echoChar.replace(/([^\n])\p{Mn}+/gu, '$1').replace(/\p{Emoji_Presentation}/gu, 'xx').length
     * ```
     */
    echoCharWidth?: number;

    /**
     * A [min, max] tuple of integers.
     * 
     * The `echoChar` is randomly repeated `n` times where `min` <= `n` and `n` <= `max`.
     * If `echoChar` is passed but `echoRepeat` isn't, then the `echoChar` is written
     * exactly once by input byte. This is to obfuscate the password length for anyone
     * snooping.
     * 
     * @default undefined
     */
    echoRepeat?: [number, number];

    /**
     * A [min, max] tuple of integers.
     * 
     * This is a range for a random delay in milliseconds between the repeated
     * `echoChar` prints or deletions on backspace. This is to make the repeated
     * `echoChar`s look more realistic.
     * 
     * @default [5,50]
     */
    repeatDelay?: [number, number];

    /**
     * Initial buffer size, can grow if needed.
     * 
     * @default 2048
     */
    bufferSize?: number;

    /**
     * TTY device to open.
     * 
     * @default '/dev/tty' with fallback to '/dev/stdin' + '/dev/stdout'
     */
    tty?: string;

    /**
     * Abort prompt (return `null`) when this signal fires.
     */
    signal?: AbortSignal;

    /**
     * Milliseconds to wait for an escape character to be accepted as the user
     * wanting to abort.
     * 
     * A single escape character might be the start of an escape sequence or
     * the user pressing escape in order to abort input. The only way to
     * distinguish between the two is to wait for more input and if none (or
     * a second escape) comes its the user wanting to abort.
     * 
     * @default 25
     */
    escapeTimeout?: number;
}

/**
 * Read a password from the terminal, decoded as a string from UTF-8.
 * 
 * The user can delete the entered password via backspace, but no other editing
 * features are supported at the moment. A password can contain a new line
 * character by pressing Shift+Enter. Pasting is also supported, though escape
 * sequences are also stripped from pasted text.
 * 
 * The input is accepted when the user hits Ctrl+D, or when a new line, carriage
 * return, or null byte is read.
 * 
 * The user can abort by pressing Escape, Ctrl+C, or by a premature end of the
 * input stream.
 * 
 * @returns The password or `null` if the user aborted.
 */
export async function getPass(prompt?: string): Promise<string|null>;

/**
 * Read a password from the terminal, decoded as a string from the given encoding.
 * 
 * The user can delete the entered password via backspace, but no other editing
 * features are supported at the moment. A password can contain a new line
 * character by pressing Shift+Enter. Pasting is also supported, though escape
 * sequences are also stripped from pasted text.
 * 
 * The input is accepted when the user hits Ctrl+D, or when a new line, carriage
 * return, or null byte is read.
 * 
 * The user can abort by pressing Escape, Ctrl+C, or by a premature end of the
 * input stream.
 * 
 * @returns The password or `null` if the user aborted.
 */
export async function getPass(options: GetPassOptions & { encoding: 'utf-8'|'latin1'|'ascii' }): Promise<string|null>;

/**
 * Read a password from the terminal as a `Buffer`.
 * 
 * The user can delete the entered password via backspace, but no other editing
 * features are supported at the moment. A password can contain a new line
 * character by pressing Shift+Enter. Pasting is also supported, though escape
 * sequences are also stripped from pasted text.
 * 
 * The input is accepted when the user hits Ctrl+D, or when a new line, carriage
 * return, or null byte is read.
 * 
 * The user can abort by pressing Escape, Ctrl+C, or by a premature end of the
 * input stream.
 * 
 * @returns The password or `null` if the user aborted.
 */
export async function getPass(options: GetPassOptions & { encoding: 'binary' }): Promise<Buffer|null>;

/**
 * Read a password from the terminal.
 * 
 * The user can delete the entered password via backspace, but no other editing
 * features are supported at the moment. A password can contain a new line
 * character by pressing Shift+Enter. Pasting is also supported, though escape
 * sequences are also stripped from pasted text.
 * 
 * The input is accepted when the user hits Ctrl+D, or when a new line, carriage
 * return, or null byte is read.
 * 
 * The user can abort by pressing Escape, Ctrl+C, or by a premature end of the
 * input stream.
 * 
 * @returns The password or `null` if the user aborted.
 */
export async function getPass(options: GetPassOptions): Promise<string|Buffer|null>;

/**
 * Read a password from the terminal.
 * 
 * The user can delete the entered password via backspace, but no other editing
 * features are supported at the moment. A password can contain a new line
 * character by pressing Shift+Enter. Pasting is also supported, though escape
 * sequences are also stripped from pasted text.
 * 
 * The input is accepted when the user hits Ctrl+D, or when a new line, carriage
 * return, or null byte is read.
 * 
 * The user can abort by pressing Escape, Ctrl+C, or by a premature end of the
 * input stream.
 * 
 * @returns The password or `null` if the user aborted.
 */
export async function getPass(options?: GetPassOptions|string): Promise<string|Buffer|null> {
    let prompt = 'Password: ';
    let encoding: Encoding = 'utf-8';
    let echoChar = '*';
    let echoWidth = 1;
    let echoRepeatMin = 0;
    let echoRepeatMax = 0;
    let repeatDelayMin = 5;
    let repeatDelayMax = 50;
    let errors: EncodingErrors = 'surrogateescape';
    let bufferSize = 2048;
    let ttyPath: string|undefined;
    let signal: AbortSignal|undefined;
    let escapeTimeout = 25;

    if (typeof options === 'string') {
        prompt = options;
    } else if (options) {
        const {
            prompt: oPrompt,
            encoding: oEncoding,
            errors: oErrors,
            echoChar: oEchoChar,
            echoRepeat: oEchoRepeat,
            repeatDelay: oRepeatDelay,
            bufferSize: oBufferSize,
            tty: oTTY,
            signal: oSignal,
            escapeTimeout: oEscapeTimeout,
            echoCharWidth: oEchoWidth,
        } = options;

        if (oPrompt !== undefined) {
            prompt = oPrompt;
        }

        if (oEncoding) {
            encoding = oEncoding;
        }

        if (oErrors) {
            errors = oErrors;
        }

        if (oEchoRepeat) {
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

        if (oEchoWidth !== undefined) {
            if (
                !isFinite(oEchoWidth) ||
                (oEchoWidth|0) !== oEchoWidth ||
                oEchoWidth < 0
            ) {
                throw new RangeError(`echoCharWidth needs to be an integer >= 0: ${oEchoWidth}`);
            }
        }

        if (oEchoChar !== undefined) {
            echoChar = oEchoChar;
            if (/[\x00-\x1F\x7F]/.test(echoChar)) {
                throw new Error(`illegal characters in echoChar: ${JSON.stringify(echoChar)}`);
            }
            if (oEchoRepeat === undefined) {
                echoRepeatMin = 1;
                echoRepeatMax = 1;
            }
            echoWidth = oEchoWidth ?? wcswidth(echoChar);
        }

        if (oRepeatDelay) {
            repeatDelayMin = oRepeatDelay[0];
            repeatDelayMax = oRepeatDelay[1];
            if (
                !isFinite(repeatDelayMin) ||
                !isFinite(repeatDelayMax) ||
                (repeatDelayMin|0) !== repeatDelayMin ||
                (repeatDelayMax|0) !== repeatDelayMax ||
                repeatDelayMin < 0 ||
                repeatDelayMax < repeatDelayMin
            ) {
                throw new RangeError(`repeatDelay needs to be a [min, max] tuple of integers where min >= 0 and min <= max: [${oRepeatDelay}]`);
            }
        }

        if (oBufferSize !== undefined) {
            bufferSize = oBufferSize;
            if (
                !isFinite(bufferSize) ||
                (bufferSize|0) !== bufferSize ||
                bufferSize < 1
            ) {
                throw new RangeError(`bufferSize needs to be an integer >= 1: ${bufferSize}`);
            }
        }

        if (oTTY !== undefined) {
            ttyPath = oTTY;
        }

        if (oEscapeTimeout !== undefined) {
            escapeTimeout = oEscapeTimeout;
            if (!isFinite(escapeTimeout) || escapeTimeout < 0) {
                throw new RangeError(`escapeTimeout needs to be an >= 0: ${escapeTimeout}`);
            }
        }

        signal = oSignal;
    }

    const utf8 = encoding === 'utf-8';
    const raw  = encoding === 'latin1' || encoding === 'binary';

    const { rfd, wfd } = await openTTY(ttyPath);
    let rtty: tty.ReadStream|undefined;
    let wtty: tty.WriteStream|undefined;

    try {
        if (signal?.aborted) {
            return null;
        }

        rtty = new tty.ReadStream(rfd.fd);
        wtty = new tty.WriteStream(wfd.fd);

        rtty.setRawMode(true);

        // turn on bracketed paste mode and disable line wrapping
        wtty.write('\x1B[?2004h\x1b[?7l');
        wtty.write(prompt);

        // approximate initial cursor position:
        let column = 1 + prompt.slice(prompt.indexOf('\n') + 1).length;
        let row = 1;
        let promptEndInit = false;
        let promptEnd = column;

        let buffer = Buffer.alloc(bufferSize);
        let offset = 0;
        let size = 0;
        let ended = false;

        let sleepTimer: NodeJS.Timeout|null = null;
        let sleepResolve: (() => void)|null = null;

        // when keystrokes come in faster than the repeat delay allows, skip the delay
        function cancelSleep(): void {
            if (sleepTimer) {
                clearTimeout(sleepTimer);
                sleepTimer = null;
                sleepResolve?.();
                sleepResolve = null;
            }
        }

        function sleep(ms: number): Promise<void> {
            return new Promise(resolve => {
                cancelSleep();

                sleepResolve = resolve;
                sleepTimer = setTimeout(() => {
                    sleepTimer = null;
                    sleepResolve = null;
                    resolve();
                }, ms);
            });
        }

        let readResolve: (() => void)|null = null;
        let readReject: ((error: Error) => void)|null = null;
        let readPromise: Promise<void>|null = null;

        const onAbort = () => {
            ended = true;
            readPromise = null;
            size = offset;
            cancelSleep();
            readResolve?.();
        };

        const onData = (input: Buffer) => {
            const remSize = size - offset;
            if (input.byteLength + remSize > buffer.length) {
                const newBuffer = Buffer.alloc(remSize + input.byteLength);

                buffer.copy(newBuffer, 0, offset, size);
                input.copy(newBuffer, remSize);

                buffer = newBuffer;
                offset = 0;
                size = remSize + input.byteLength;
            } else if (input.byteLength + size > buffer.length) {
                buffer.copyWithin(0, offset, size);
                size -= offset;
                offset = 0;

                input.copy(buffer, size);
                size += input.byteLength;
            } else {
                input.copy(buffer, size);
                size += input.byteLength;
            }
            readPromise = null;
            cancelSleep();
            readResolve?.();
        };

        const onError = (error: Error) => {
            readPromise = null;
            cancelSleep();
            readReject?.(error);
        };

        const onEnd = () => {
            readPromise = null;
            cancelSleep();
            readResolve?.();
        };

        const onResize = () => {
            if (wtty) {
                // request actual cursor position
                wtty.write('\x1b[6n');
                if (wtty.columns > column) {
                    column = wtty.columns;
                }
            }
        };

        signal?.addEventListener('abort', onAbort);

        rtty.on('data',   onData);
        rtty.on('error',  onError);
        rtty.on('end',    onEnd);
        wtty.on('resize', onResize);

        try {
            // request actual cursor position
            wtty.write('\x1b[6n');

            async function readByte(): Promise<number> {
                if (offset >= size) {
                    if (ended) {
                        return -1;
                    }

                    if (!readPromise) {
                        readPromise = new Promise((resolve, reject) => {
                            readResolve = resolve;
                            readReject  = reject;
                        });
                    }

                    await readPromise;

                    if (offset >= size || ended) {
                        ended = true;
                        return -1;
                    }
                }

                return buffer[offset ++];
            }

            async function peekByte(): Promise<number> {
                if (offset >= size) {
                    if (ended) {
                        return -1;
                    }

                    if (!readPromise) {
                        readPromise = new Promise((resolve, reject) => {
                            readResolve = resolve;
                            readReject  = reject;
                        });
                    }

                    await readPromise;

                    if (offset >= size || ended) {
                        ended = true;
                        return -1;
                    }
                }

                return buffer[offset];
            }

            const password: number[] = [];
            const widths: number[] = [];
            let pasteNesting = 0;

            const handleError: (bytes: number[]) => number[] = (
                errors === 'strict'  ? encdingErrorsStrict :
                errors === 'ignore'  ? encodingErrorsIgnore :
                errors === 'replace' ? encodingErrorsReplace :
                encodingErrorsSurrogateEscape
            );

            async function writeEcho(): Promise<void> {
                let width = 0;
                if (echoRepeatMax) {
                    // it's to late now to get the cursor position event
                    promptEndInit = true;

                    const count = echoRepeatMin === echoRepeatMax ?
                        echoRepeatMin :
                        randomInt(echoRepeatMin, echoRepeatMax + 1);

                    if (wtty) {
                        for (let index = 0; index < count; ++ index) {
                            if (index > 0 && offset >= size) {
                                await sleep(
                                    repeatDelayMin === repeatDelayMax ? repeatDelayMin :
                                    randomInt(repeatDelayMin, repeatDelayMax + 1)
                                );
                            }
                            wtty.write(echoChar);
                        }
                        // request actual cursor position
                        wtty.write('\x1b[6n');
                    }
                    width = echoWidth * count;
                    column += width;
                    if (wtty && column > wtty.columns) {
                        column = wtty.columns;
                    }
                }
                widths.push(width);
            }

            async function appendByte(byte: number): Promise<void> {
                if (utf8 && byte >= 0xC0) {
                    let codepoint = byte;
                    // UTF-8 multi-byte sequence
                    if (byte >= 0xF0) {
                        // 4 bytes
                        codepoint &= 0x07;

                        const b2 = await peekByte();
                        if (isCont(b2)) {
                            ++ offset;
                            codepoint <<= 6;
                            codepoint |= b2 & 0x3F;

                            const b3 = await peekByte();
                            if (isCont(b3)) {
                                ++ offset;
                                codepoint <<= 6;
                                codepoint |= b3 & 0x3F;

                                const b4 = await peekByte();
                                if (isCont(b4)) {
                                    ++ offset;
                                    codepoint <<= 6;
                                    codepoint |= b4 & 0x3F;

                                    password.push(codepoint);
                                    await writeEcho();
                                } else {
                                    for (const codepoint of handleError([byte, b2, b3])) {
                                        password.push(codepoint);
                                        await writeEcho();
                                    }
                                }
                            } else {
                                for (const codepoint of handleError([byte, b2])) {
                                    password.push(codepoint);
                                    await writeEcho();
                                }
                            }
                        } else {
                            for (const codepoint of handleError([byte])) {
                                password.push(codepoint);
                                await writeEcho();
                            }
                        }
                    } else if (byte >= 0xE0) {
                        // 3 bytes
                        codepoint &= 0x0F;

                        const b2 = await peekByte();
                        if (isCont(b2)) {
                            ++ offset;
                            codepoint <<= 6;
                            codepoint |= b2 & 0x3F;

                            const b3 = await peekByte();
                            if (isCont(b3)) {
                                ++ offset;
                                codepoint <<= 6;
                                codepoint |= b3 & 0x3F;

                                password.push(codepoint);
                                await writeEcho();
                            } else {
                                for (const codepoint of handleError([byte, b2])) {
                                    password.push(codepoint);
                                    await writeEcho();
                                }
                            }
                        } else {
                            for (const codepoint of handleError([byte])) {
                                password.push(codepoint);
                                await writeEcho();
                            }
                        }
                    } else {
                        // 2 bytes
                        codepoint &= 0x1F;

                        const b2 = await peekByte();
                        if (isCont(b2)) {
                            ++ offset;
                            codepoint <<= 6;
                            codepoint |= b2 & 0x3F;

                            password.push(codepoint);
                            await writeEcho();
                        } else {
                            for (const codepoint of handleError([byte])) {
                                password.push(codepoint);
                                await writeEcho();
                            }
                        }
                    }
                } else if (!raw && byte > 0x7F) {
                    for (const codepoint of handleError([byte])) {
                        password.push(codepoint);
                        await writeEcho();
                    }
                } else {
                    password.push(byte);
                    await writeEcho();
                }
            }

            for (;;) {
                let byte = await readByte();
                if (byte < 0) return null;

                if (byte === ESCAPE) {
                    // see: https://en.wikipedia.org/wiki/ANSI_escape_code#Terminal_input_sequences

                    let escapeTimer: NodeJS.Timeout|null = setTimeout(onAbort, escapeTimeout);

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
                            let param1 = 0;
                            do {
                                param1 *= 10;
                                param1 += byte - 0x30;

                                byte = await readByte();
                                if (byte < 0) {
                                    return null;
                                }
                            } while (byte >= 0x30 && byte <= 0x39); // '0' ... '9'

                            if (
                                (byte >= 0x41 && byte <= 0x5A) || // 'A' ... 'Z'
                                (byte >= 0x61 && byte <= 0x7A)    // 'a' ... 'z'
                            ) {
                                // keycode sequence, <modifier> is a decimal
                                // number and defaults to 1 (xterm)
                            } else {
                                let param2 = -1;
                                if (byte === 0x3b) { // ';'
                                    param2 = 0;
                                    for (;;) {
                                        byte = await readByte();
                                        if (byte < 0) {
                                            return null;
                                        }

                                        if (!(byte >= 0x30 && byte <= 0x39)) { // '0' ... '9'
                                            break;
                                        }

                                        param2 *= 10;
                                        param2 += byte - 0x30;
                                    }
                                }

                                if (byte === 0x7E) { // '~'
                                    // keycode sequence, <keycode> and <modifier>
                                    // are decimal numbers and default to 1 (vt)
                                    if (param2 === -1) {
                                        switch (param1) {
                                            case 200: // bracketed paste start
                                                ++ pasteNesting;
                                                break;

                                            case 201: // bracketed paste end
                                                if (pasteNesting > 0) {
                                                    -- pasteNesting;
                                                }
                                                break;
                                        }
                                    }
                                } else if (param2 !== -1 && byte === 0x52) { // 'R'
                                    // cursor position
                                    column = param2;
                                    row = param1;
                                    if (!promptEndInit) {
                                        promptEnd = column;
                                        promptEndInit = true;
                                    }
                                } else {
                                    // XXX: unknown/broken escape sequence
                                }
                            }
                        } else if (byte === 0x3F) { // '?'
                            // private
                            let param1 = 0;
                            while ((byte = await readByte()) >= 0x30 && byte <= 0x39) { // '0' ... '9'
                                param1 *= 10;
                                param1 += byte - 0x30;
                            }

                            let param2 = -1;
                            if (byte === 0x3b) { // ';'
                                param2 = 0;
                                while ((byte = await readByte()) >= 0x30 && byte <= 0x39) { // '0' ... '9'
                                    param1 *= 10;
                                    param1 += byte - 0x30;
                                }
                            }

                            if (param2 !== -1 && byte === 0x52) { // 'R'
                                // cursor position
                                column = param2;
                                row = param1;
                                if (!promptEndInit) {
                                    promptEnd = column;
                                    promptEndInit = true;
                                }
                            }
                        } else {
                            // XXX: unknown/broken escape sequence
                        }
                    } else if (byte === 0x4F) { // 'O'
                        byte = await readByte();
                        if (byte < 0) {
                            return null;
                        }

                        if (byte === 0x4D) { // 'M'
                            // Shift+Enter -> '\n'
                            await appendByte(LF);
                        } else if (
                            (byte >= 0x41 && byte <= 0x5A) || // 'A' ... 'Z'
                            (byte >= 0x61 && byte <= 0x7A)    // 'a' ... 'z'
                        ) {
                            // function keys and such
                        } else {
                            // XXX: unknown/broken escape sequence
                        }
                    } else {
                        // XXX: unknown/broken escape sequence
                    }
                } else if (pasteNesting) {
                    await appendByte(byte === CR ? LF : byte);
                } else if (byte === CTRLD || byte === LF || byte === CR || byte === 0) {
                    break;
                } else {
                    switch (byte) {
                        case CTRLC:
                            return null;

                        case BACKSPACE:
                            password.pop();
                            const width = widths.pop();
                            if (width) {
                                for (let index = 0; index < width; ++ index) {
                                    if (index > 0 && offset >= size) {
                                        await sleep(
                                            repeatDelayMin === repeatDelayMax ? repeatDelayMin :
                                            randomInt(repeatDelayMin, repeatDelayMax + 1)
                                        );
                                    }

                                    if (column - echoWidth <= promptEnd) {
                                        let sumWidth = 0;
                                        for (const width of widths) {
                                            sumWidth += width;
                                        }
                                        wtty.write(`\x1B[${row};${promptEnd}H\x1B[K${echoChar.repeat(sumWidth / echoWidth)}`);
                                        column = promptEnd + sumWidth;
                                    } else {
                                        wtty.write(`\x1B[1D\x1B[K`);
                                        column -= echoWidth;
                                    }
                                }

                                // request actual cursor position
                                wtty.write('\x1b[6n');
                            }
                            break;

                        default:
                            await appendByte(byte);
                            break;
                    }
                }
            }

            return encoding === 'binary' ?
                Buffer.from(password) :
                String.fromCodePoint(...password);
        } finally {
            rtty.off('data',   onData);
            rtty.off('error',  onError);
            rtty.off('end',    onEnd);
            wtty.off('resize', onResize);
            signal?.removeEventListener('abort', onAbort);
        }
    } finally {
        try {
            wtty?.write('\n');
        } finally {
            try {
                rtty?.setRawMode(false);
            } finally {
                try {
                    // turn off bracketed paste mode and enable line wrapping
                    wtty?.write('\x1B[?2004l\x1b[?7h');
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

export default getPass;

interface TTY {
    wfd: fs.FileHandle;
    rfd: fs.FileHandle;
}

async function openTTY(ttyPath?: string): Promise<TTY> {
    // Opening read second so that there is no await between it and attaching
    // onData event handlers and actually reading.
    let wfd: fs.FileHandle|null = null;
    let rfd: fs.FileHandle|null = null;

    if (ttyPath) {
        wfd = await fs.open(ttyPath, 'w');

        try {
            rfd = await fs.open(ttyPath, 'r');
        } catch (error) {
            try {
                wfd?.close();
            } catch (error2) {
                const errors = [error, error2];
                throw new AggregateError(errors, errors.join('\n'));
            }

            throw error;
        }

        return { rfd, wfd };
    }

    try {
        wfd = await fs.open('/dev/tty', 'w');
        rfd = await fs.open('/dev/tty', 'r');

        return { rfd, wfd };
    } catch (error) {
        const errors: unknown[] = [error];

        try { wfd?.close(); } catch (error2) { errors.push(error2); }
        try { rfd?.close(); } catch (error2) { errors.push(error2); }

        if (isNodeError(error, Error) && (error.code === 'ENOENT' || error.code === 'EACCES')) {
            // There is no fs.fdopen(number) in NodeJS?
            wfd = await fs.open('/dev/stdout', 'w');

            try {
                rfd = await fs.open('/dev/stdin', 'r');
            } catch (error2) {
                errors.push(error2);

                try {
                    wfd?.close();
                } catch (error3) {
                    errors.push(error3);
                }

                throw new AggregateError(errors, errors.join('\n'));
            }

            return { rfd, wfd };
        }

        if (errors.length > 1) {
            throw new AggregateError(errors, errors.join('\n'));
        }

        throw error;
    }
}

function encdingErrorsStrict(bytes: number[]): number[] {
    throw new Error(`invalid bytes: [${bytes.map(byte => '0x' + byte.toString(16).padStart(2, '0')).join(', ')}]`);
}

function encodingErrorsIgnore(bytes: number[]): number[] {
    return [];
}

function encodingErrorsReplace(bytes: number[]): number[] {
    return [0xFFFD];
}

function encodingErrorsSurrogateEscape(bytes: number[]): number[] {
    return bytes.map(byte => 0xDC00 + byte);
}
