# Attribution

Faultline uses the following third-party software and algorithms.

---

## React

- **Version:** 19.2.8
- **Author:** Meta Platforms, Inc. and affiliates
- **License:** MIT
- **Homepage:** https://react.dev/
- **Repository:** https://github.com/react/react

**Usage in Faultline:** Core UI framework powering all interactive views including the topology editor, timeline visualization, metrics panel, scenario editor, and invariant builder.

**License text:**

> MIT License
>
> Copyright (c) Meta Platforms, Inc. and affiliates.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## @xyflow/react (React Flow)

- **Version:** 12.11.3
- **Author:** webkid GmbH
- **License:** MIT
- **Homepage:** https://reactflow.dev
- **Repository:** https://github.com/xyflow/xyflow

**Usage in Faultline:** Provides the interactive node-based topology graph editor (`TopologyGraph.tsx`) for visually modeling service architectures and request paths.

**License text:**

> MIT License
>
> Copyright (c) 2019-2025 webkid GmbH
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## Ajv

- **Version:** 8.17.1
- **Author:** Evgeny Poberezkin
- **License:** MIT
- **Homepage:** https://ajv.js.org
- **Repository:** https://github.com/ajv-validator/ajv

**Usage in Faultline:** JSON Schema validation (draft-07) used in the two-pass schema validator (`schema-validator.ts`) to structurally validate scenario configurations before they reach the simulation engine.

**License text:**

> The MIT License (MIT)
>
> Copyright (c) 2015-2021 Evgeny Poberezkin
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## xoshiro128** Algorithm

- **Authors:** David Blackman and Sebastiano Vigna
- **License:** Public Domain (CC0 1.0 Universal)
- **Reference:** Blackman, D. and Vigna, S. (2021). "Scrambled Linear Pseudorandom Number Generators." _ACM Transactions on Mathematical Software_, 47(4), Article 36.
- **Source:** https://prng.di.unimi.it/
- **Reference implementation:** https://prng.di.unimi.it/xoshiro128starstar.c

**Usage in Faultline:** Custom implementation in `src/engine/prng.ts` using `Uint32Array(4)` state and `Math.imul`/`>>> 0` operations. This is the single PRNG instance for the entire simulation engine, providing deterministic randomness for failure probability, latency sampling, and jitter calculations. The deterministic nature of xoshiro128** ensures that identical seeds produce identical simulation results across all platforms and browsers.

---

_This file documents third-party code used in Faultline. All dependencies are used under their respective open-source licenses._
