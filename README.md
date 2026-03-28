getpass
=======

[![Test Status](https://img.shields.io/github/actions/workflow/status/panzi/getpass-ts/tests.yml)](https://github.com/panzi/getpass-ts/actions/workflows/tests.yml)
[![Release](https://img.shields.io/github/v/tag/panzi/getpass-ts)](https://github.com/panzi/getpass-ts/tags)
[![MIT License](https://img.shields.io/github/license/panzi/getpass-ts)](https://github.com/panzi/getpass-ts/blob/main/LICENSE.txt)

Simple CLI password prompt for NodeJS for Unix(-like) operating systems. This
is inspired by [arekinath/node-getpass](https://github.com/arekinath/node-getpass),
but uses TypeScript and promises instead of callbacks.

Example
-------

```TypeScript
import getPass from '@panzi/getpass';

const password = await getPass();

if (password === null) {
    console.log('Aborted by user!');
    process.exit();
}
```

Dependencies
------------

This library has no hard dependencies, but for the width calculation on the
`echoChar` various `wcswidth()` libraries are tried to be used and if none are
available a simple fallback is used. The library fallback order is:

* [wcwidth-o1](https://www.npmjs.com/package/wcwidth-o1)
* [wcswidth](https://www.npmjs.com/package/wcwidth)
* [simple-wcswidth](https://www.npmjs.com/package/simple-wcswidth)

The simple built-in fallback is:

```TypeScript
function wcswidth(text: string): number {
    return text.replace(/([^\n])\p{Mn}+/gu, '$1').replace(/\p{Emoji_Presentation}/gu, 'xx').length;
}
```

Reference
---------

```TypeScript
export type Encoding = 'utf-8'|'latin1'|'ascii'|'binary';

export type EncodingErrors = 'strict'|'ignore'|'replace'|'surrogateescape';

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
}

export async function getPass(prompt?: string): Promise<string|null>;
export async function getPass(options: GetPassOptions & { encoding: 'utf-8'|'latin1'|'ascii' }): Promise<string|null>;
export async function getPass(options: GetPassOptions & { encoding: 'binary' }): Promise<Buffer|null>;
export async function getPass(options: GetPassOptions): Promise<string|Buffer|null>;

export default getPass;
```

The user can delete the entered password via backspace, but no other editing
features are supported at the moment. A password can contain a new line
character by pressing Shift+Enter. Pasting is also supported, though escape
sequences are also stripped from pasted text.

The input is accepted when the user hits Ctrl+D, or when a new line, carriage
return, or null byte is read.

The user can abort by pressing Escape, Ctrl+C, or by a premature end of the
input stream.

When parsing invalid UTF-8 or ASCII the invalid bytes are handled the way
Python does with it's "surrogate escape" method.

License
-------

[MIT License](LICENSE.txt)
