import { describe, expect, test } from '@jest/globals';
import * as pty from 'node-pty';
import { resolve } from 'path';
import type { Encoding, EncodingErrors } from '../src';

const getpass_path = './examples/getpass.js';
const project_dir = resolve(__dirname, '..');

function stripEscapeSequences(text: string): string {
    return text.replace(/\x1B\[200~.*?\x1B\[201~|\x1B(\[\??(\d*(;\d*)*)?[~a-z])?/gi, '');
}

type GetPassOutput = {
    output: string|Buffer;
    kill?: string;
    echo?: string;
    password?: string|null|{type: "Buffer", data: number[]};
    signal?: number;
    exitCode: number;
};

async function getpass({
    prompt,
    encoding,
    errors,
    echoChar,
    echoRepeat,
    input,
    kill,
}: {
    prompt?: string;
    encoding?: Encoding;
    errors?: EncodingErrors;
    echoChar?: string;
    echoRepeat?: number;
    input: string|Buffer|((term: pty.IPty) => void);
    kill?: string;
}): Promise<GetPassOutput> {
    return new Promise((resolve, reject) => {
        try {
            const args = [getpass_path];

            if (prompt) {
                args.push(`--prompt=${prompt}`);
            }

            if (encoding) {
                args.push(`--encoding=${encoding}`);
            }

            if (errors) {
                args.push(`--errors=${errors}`);
            }

            if (echoChar) {
                args.push(`--echo-char=${echoChar}`);
            }

            if (echoRepeat !== undefined) {
                args.push(`--echo-repeat=${echoRepeat}`);
            }

            const cEncoding = (
                encoding === 'latin1' ? 'ISO-8859-1' :
                encoding === 'ascii' ? 'ASCII' :
                encoding === 'utf-8' ? 'UTF-8' :
                null
            );

            const term = pty.spawn(process.argv0, args, {
                name: 'xterm-color',
                cwd: project_dir,
                env: { ...process.env, LANG: cEncoding ? `C.${cEncoding}` : 'C' },
                encoding: null,
                cols: 80,
                rows: 40,
            });

            let buf: Buffer[] = [];
            let sawPrompt = false;

            const bEncoding = encoding === 'binary' ? 'ascii' : encoding ?? 'utf-8';
            const bPrompt = Buffer.from(prompt === '' ? '\x1B[?2004h\x1b[?7l' : prompt ?? 'Password: ', bEncoding);

            term.onData((async (data: Buffer) => {
                buf.push(data);

                if (!sawPrompt) {
                    let buffer = Buffer.concat(buf);

                    const index = buffer.indexOf(bPrompt);
                    if (index >= 0) {
                        sawPrompt = true;
                        buffer = buffer.subarray(index + bPrompt.length);

                        if (typeof input === 'function') {
                            input(term);
                        } else if (Buffer.isBuffer(input)) {
                            term.write(input);
                        } else {
                            term.write(Buffer.from(input, bEncoding));
                        }

                        if (kill) {
                            term.kill(kill);
                        }
                    }

                    buf = [buffer];
                }
            }) as any);

            term.onExit(({ exitCode, signal }) => {
                try {
                    const output = Buffer.concat(buf);
                    let text = output.toString(encoding === 'binary' ? 'latin1' : encoding ?? 'utf-8');

                    const index = text.indexOf('{');
                    if (index < 0) {
                        resolve({
                            output,
                            echo: text,
                            password: null,
                            signal,
                            exitCode,
                        });
                        return;
                    }

                    try {
                        const echo = text.slice(0, index);
                        const { password } = JSON.parse(text.slice(index));

                        resolve({
                            output,
                            echo,
                            password,
                            signal,
                            exitCode,
                        });
                    } catch (error) {
                        if (error instanceof SyntaxError) {
                            resolve({
                                output,
                                signal,
                                exitCode,
                            });
                        } else {
                            throw error;
                        }
                    }
                } catch (error) {
                    reject(error);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

type TestCase = {
    name: string;
    prompt?: string;
    encoding?: Encoding;
    errors?: EncodingErrors;
    echoChar?: string;
    echoRepeat?: number;
    input: string|Buffer;
    kill?: string;
    echo?: string;
    password?: string|null|{type: "Buffer", data: number[]};
    signal?: number;
    exitCode?: number;
    output?: string|Buffer;
    exception?: string;
};

const tests: TestCase[] = [
    {
        name: 'Valid ASCII',
        encoding: 'ascii',
        input: 'foobar\r',
        password: 'foobar',
    },
    {
        name: 'Valid UTF-8',
        encoding: 'utf-8',
        input: 'äÖß😀桁\r',
        password: 'äÖß😀桁',
    },
    {
        name: 'Valid latin1',
        encoding: 'latin1',
        input: Buffer.from([0xf6, 0xe4, 0xfc, 0xdf, 0xd6, 0xc4, 0xdc, 0x0a]),
        password: 'öäüßÖÄÜ',
    },
    {
        name: 'Binary',
        encoding: 'binary',
        input: Buffer.from([0xC3, 0xA4, 0xC3, 0x96, 0xC3, 0x9F, 0xF0, 0x9F, 0x98, 0x80, 0xE6, 0xA1, 0x81, 0x0A]),
        password: { type: "Buffer", data: [0xC3, 0xA4, 0xC3, 0x96, 0xC3, 0x9F, 0xF0, 0x9F, 0x98, 0x80, 0xE6, 0xA1, 0x81] },
    },
    {
        name: 'Multiline Paste',
        input: '\x1B[200~foo\n\nbar\x1B[201~\n',
        password: 'foo\n\nbar',
    },
    {
        name: 'Escape',
        input: 'foo\x1B',
        password: null,
    },
    {
        name: 'Ctrl+C',
        input: 'foo\x03',
        password: null,
    },
    {
        name: 'Ctrl+D',
        input: 'foo\x04',
        password: 'foo',
    },
    {
        name: 'SIGINT',
        input: 'foo',
        password: null,
        kill: 'SIGINT',
        signal: 2,
    },
    {
        name: 'Backspace',
        input: 'foo\x7Fx bar\x7F\x7F\x7F\x7F\n',
        password: 'fox',
    },
    {
        name: 'Echo',
        input: 'foo\n',
        echo: '***',
        echoChar: '*',
        echoRepeat: 1,
        password: 'foo',
    },
    {
        name: 'Echo Repeat 2',
        input: 'foo\n',
        echo: '******',
        echoChar: '*',
        echoRepeat: 2,
        password: 'foo',
    },
    {
        name: 'Echo + Backspace',
        input: 'foo\x7Fx\n',
        echoChar: '*',
        echoRepeat: 1,
        echo: '****',
        password: 'fox',
    },
    {
        name: 'Echo Repeat 2 + Backspace',
        input: 'foo\x7Fx\x7F\x7F..\n',
        echoChar: '*',
        echoRepeat: 2,
        echo: '************',
        password: 'f..',
    },
    {
        name: 'Custom Prompt',
        prompt: 'PROMPT> ',
        input: 'FOO\n',
        password: 'FOO',
    },
    {
        name: 'Empty Prompt',
        prompt: '',
        input: 'FOO\n',
        password: 'FOO',
    },

    {
        name: 'Broken ASCII (ignore)',
        errors: 'ignore',
        input: Buffer.from([0x66, 0xFE, 0x0A]),
        password: 'f',
    },
    {
        name: 'Broken ASCII (replace)',
        errors: 'replace',
        input: Buffer.from([0x66, 0xFE, 0x0A]),
        password: 'f\uFFFD',
    },
    {
        name: 'Broken ASCII (surrogateescape)',
        errors: 'surrogateescape',
        input: Buffer.from([0x66, 0xFE, 0x0A]),
        password: 'f\uDCFE',
    },
    {
        name: 'Broken ASCII (strict)',
        errors: 'strict',
        input: Buffer.from([0x66, 0xFE, 0x0A]),
        exception: 'invalid bytes: [0xfe]'
    },

    {
        name: 'Broken UTF-8 (ignore)',
        errors: 'ignore',
        input: Buffer.from([0x66, 0xDF, 0x6F, 0xF7, 0xBF, 0x0A]),
        password: 'fo',
    },
    {
        name: 'Broken UTF-8 (replace)',
        errors: 'replace',
        input: Buffer.from([0x66, 0xDF, 0x6F, 0xF7, 0xBF, 0x0A]),
        password: 'f\uFFFDo\uFFFD',
    },
    {
        name: 'Broken UTF-8 (surrogateescape)',
        errors: 'surrogateescape',
        input: Buffer.from([0x66, 0xDF, 0x6F, 0xF7, 0xBF, 0x0A]),
        password: 'f\uDCDFo\uDCF7\uDCBF',
    },
    {
        name: 'Broken UTF-8 (strict)',
        errors: 'strict',
        input: Buffer.from([0xF7, 0xBF, 0x0A]),
        exception: 'invalid bytes: [0xf7, 0xbf]'
    },
];

describe('Basic Tests', () => {
    for (const { name, prompt, encoding, errors, echoChar, echoRepeat,
                 input, echo, password, signal, exitCode, output,
                 exception, kill,
               } of tests) {
        test(name, async () => {
            const res = await getpass({
                prompt,
                kill,
                encoding,
                errors,
                echoChar,
                echoRepeat,
                input,
            });

            if (echo !== undefined) {
                expect(res.echo && stripEscapeSequences(res.echo).trimEnd()).toEqual(echo);
            }

            if (password !== undefined) {
                expect(res.password).toEqual(password);
            }

            if (signal !== undefined) {
                expect(res.signal).toEqual(signal);
            }

            if (exitCode !== undefined) {
                expect(res.exitCode).toEqual(exitCode);
            }

            if (output !== undefined) {
                if (Buffer.isBuffer(res.output) && Buffer.isBuffer(output)) {
                    expect(res.output.equals(output)).toBeTruthy();
                } else {
                    expect(res.output).toEqual(output);
                }
            }

            if (exception !== undefined) {
                expect(res.exitCode).not.toEqual(0);
                expect(res.output.includes(exception)).toBeTruthy();
            }
        });
    }
});
