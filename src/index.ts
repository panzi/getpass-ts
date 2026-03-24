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

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
     * @default [10,100]
     */
    repeatDelay?: [number, number];
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
    let echoRepeatMin = 0;
    let echoRepeatMax = 0;
    let repeatDelayMin = 10;
    let repeatDelayMax = 100;
    let errors: EncodingErrors = 'surrogateescape';

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

        if (oEchoChar !== undefined) {
            echoChar = oEchoChar;
            if (/[\x00-\x1F]/.test(echoChar)) {
                throw new Error(`illegal characters in echoChar: ${JSON.stringify(echoChar)}`);
            }
            if (oEchoRepeat === undefined) {
                echoRepeatMin = 1;
                echoRepeatMax = 1;
            }
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
    }

    const utf8 = encoding === 'utf-8';
    const raw  = encoding === 'latin1' || encoding === 'binary';
    const echoWidth = wcswidth(echoChar);

    const { rfd, wfd } = await openTTY();
    let rtty: tty.ReadStream|undefined;
    let wtty: tty.WriteStream|undefined;

    try {
        rtty = new tty.ReadStream(rfd.fd);
        wtty = new tty.WriteStream(wfd.fd);

        // turn on bracketed paste mode and disable line wrapping
        wtty.write('\x1B[?2004h\x1b[?7l');
        wtty.write(prompt);

        rtty.resume();
        rtty.setRawMode(true);
        rtty.resume();

        // approximate initial cursor position:
        let column = 1 + prompt.slice(prompt.indexOf('\n') + 1).length;
        let row = 1;
        let promptEndInit = false;
        let promptEnd = column;

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

        const onResize = () => {
            if (wtty) {
                // request actual cursor position
                wtty.write('\x1b[6n');
                if (wtty.columns > column) {
                    column = wtty.columns;
                }
            }
        };

        rtty.on('data', onData);
        rtty.on('error', onError);
        rtty.on('end', onEnd);
        wtty.on('resize', onResize);

        // request actual cursor position
        wtty.write('\x1b[6n');

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

                if (!buffer?.length || ended) {
                    ended = true;
                    return -1;
                }
            }

            return buffer[offset ++];
        }

        async function peekByte(): Promise<number> {
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

                if (!buffer?.length || ended) {
                    ended = true;
                    return -1;
                }
            }

            return buffer[offset];
        }

        try {
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
                    const count = echoRepeatMin === echoRepeatMax ?
                        echoRepeatMin :
                        randomInt(echoRepeatMin, echoRepeatMax + 1);

                    if (wtty) {
                        for (let index = 0; index < count; ++ index) {
                            if (index > 0) {
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
                                } else if (param2 != -1 && byte === 0x52) { // 'R'
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

                            if (param2 != -1 && byte === 0x52) { // 'R'
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
                                    if (index > 0) {
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
                                        wtty.write(`\x1B[${row};${promptEnd}H\x1B[K` + echoChar.repeat(sumWidth / echoWidth));
                                        column = promptEnd;
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
            rtty.off('data', onData);
            rtty.off('error', onError);
            rtty.off('end', onEnd);
            wtty.off('resize', onResize);
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
