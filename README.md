getpass
=======

[![Release](https://img.shields.io/github/v/tag/panzi/getpass-ts)](https://github.com/panzi/getpass-ts/tags)
[![MIT License](https://img.shields.io/github/license/panzi/getpass-ts)](https://github.com/panzi/getpass-ts/blob/main/LICENSE.txt)

Simple CLI password prompt for NodeJS for Unix(-like) operating systems. This
is inspired by [arekinath/node-getpass](https://github.com/arekinath/node-getpass),
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
     * @default [0,80]
     */
    repeatDelay?: [number, number];
}

async function getPass(prompt?: string): Promise<string|null>;
async function getPass(options: GetPassOptions & { encoding: 'utf-8'|'latin1'|'ascii' }): Promise<string|null>;
async function getPass(options: GetPassOptions & { encoding: 'binary' }): Promise<Buffer|null>;
async function getPass(options: GetPassOptions): Promise<string|Buffer|null>;
```

The user can delete the entered password via backspace, but no other editing
features are supported at the moment. A password can contain a new line
character by pressing Shift+Enter. Pasting is also supported, though escape
sequences are also stripped from pasted text.

The input is accepted when the user hits Ctrl+D, or when a new line, carriage
return, or null byte is read.

The user can abort by pressing Escape, Ctrl+C, or by a premature end of the
input stream.

```TypeScript
import getPass from '@panzi/getpass';

const password = await getPass();

if (password === null) {
    console.log('Aborted by user!');
    process.exit();
}
```

License
-------

[MIT License](LICENSE.txt)
