# Third-party notices

The complete `skills/hypersolutions/` tree is derived from
[Hyper Solutions' upstream plugin](https://github.com/Hyper-Solutions/hypersolutions-codex/tree/748959444ca59e67ae8ce75c358a21d43f227b5d),
version 0.4.1, commit `748959444ca59e67ae8ce75c358a21d43f227b5d`.
The upstream plugin manifest identifies **Hyper Solutions** as the author and declares
`"license": "MIT"`. Upstream supplies no standalone LICENSE file or explicit
copyright-year notice at this commit. The attribution below names the declared author;
no copyright year has been invented. The following standard MIT terms reproduce the
license identified by the upstream manifest, rather than claiming an upstream LICENSE
file was supplied.

The OpenCode port changes platform instructions, MCP tool names, installed resource
paths, and reproduced workflow defects through the counted rules recorded in
`scripts/upstream-transforms.json`. Product and SDK coverage remains complete; the
Python implementation is unchanged. File provenance and
SHA-256 checksums appear in `provenance/upstream.json`.

## Hyper Solutions content — MIT License

Copyright Hyper Solutions

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Service and documentation boundary

This package redistributes public upstream integration documentation and its public
helper. The powhttp application and hosted HAR analyzer are existing external services;
their implementations and private detection rules are not included or relicensed here.
Keep exhaustive, current detection rules, exact internal thresholds, reverse engineering
of anti-bot internals, and named customer/target applications out of public package files.
Static documentation covers API usage and generally known browser-fingerprinting facts.
New detection logic belongs in the hosted HAR analyzer. Keep service authentication,
account access and any service terms separate from this package's software license.
