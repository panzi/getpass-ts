getpass
=======

[![Test Status](https://img.shields.io/github/actions/workflow/status/panzi/getpass-ts/tests.yml)](https://github.com/panzi/getpass-ts/actions/workflows/tests.yml)
[![Release](https://img.shields.io/github/v/tag/panzi/getpass-ts)](https://github.com/panzi/getpass-ts/tags)
[![MIT License](https://img.shields.io/github/license/panzi/getpass-ts)](https://github.com/panzi/getpass-ts/blob/main/LICENSE.txt)
[![API Reference](https://img.shields.io/badge/API_Reference-informational)](https://panzi.github.io/getpass-ts)

Simple CLI password prompt for NodeJS for Unix(-like) operating systems. This
is inspired by [arekinath/node-getpass](https://github.com/arekinath/node-getpass),
but uses TypeScript and promises instead of callbacks.

The user can delete the entered password via backspace, but no other editing
features are supported at the moment. A password can contain a new line
character by pressing Shift+Enter. Pasting also preserves new lines, though
escape sequences are still interpreted in pasted text, because pasting happens
via escape sequences.

The input is accepted when the user hits Ctrl+D, or when a new line, carriage
return, or null byte is read.

The user can abort by pressing Escape, Ctrl+C, or by a premature end of the
input stream. An API user can cancle the process via an
[AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal).

There are multiple options how invalid UTF-8/ASCII input can be handled. Per
default it is done in the same way Python does with it's "surrogate escape"
method.

Install
-------

```bash
npm install --save @panzi/getpass
```

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

This library has no hard dependencies, but if you enable echoing then for the
width calculation on the `echoChar` various `wcswidth()` libraries are tried to
be used and if none are available a simple fallback is used. The library
fallback order is:

* [wcwidth-o1](https://www.npmjs.com/package/wcwidth-o1)
* [wcswidth](https://www.npmjs.com/package/wcwidth)
* [simple-wcswidth](https://www.npmjs.com/package/simple-wcswidth)

The simple built-in fallback is:

```TypeScript
function wcswidth(text: string): number {
    return text.replace(/([^\n])\p{Mn}+/gu, '$1').replace(/\p{Emoji_Presentation}/gu, 'xx').length;
}
```

License
-------

[MIT License](LICENSE.txt)
