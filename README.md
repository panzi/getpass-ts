getpass
=======

[![Release](https://img.shields.io/github/v/tag/panzi/getpass-ts)](https://github.com/panzi/getpass-ts/tags)
[![MIT License](https://img.shields.io/github/license/panzi/getpass-ts)](https://github.com/panzi/getpass-ts/?tab=readme-ov-file#MIT_License)

Simple CLI password prompt for NodeJS for Unix(-like) operating systems. This
is inspired by [arekinath/node-getpas](https://github.com/arekinath/node-getpass),
but uses TypeScript and promises instead of callbacks.

Reference
---------

```TypeScript
type Encoding = 'utf-8'|'latin1'|'ascii'|'binary';

interface GetPassOptions {
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

async function getPass(prompt?: string): Promise<string|null>;
async function getPass(options: GetPassOptions & { encoding: 'utf-8'|'latin1'|'ascii' }): Promise<string|null>;
async function getPass(options: GetPassOptions & { encoding: 'binary' }): Promise<Buffer|null>;
async function getPass(options: GetPassOptions): Promise<string|Buffer|null>;
```

The user can delete the entered password via backspace, but no other editing
features are supported at the moment.

The input is accepted when the user hits Ctrl+D, or when a new line, carriage
return, or null byte is read.

The user can abort by pressing Escape, Ctrl+C, or by a premature end of the
input stream.

MIT License
-----------

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
