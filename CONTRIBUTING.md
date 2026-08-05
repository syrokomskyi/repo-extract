# Contributing

Thank you for your interest in contributing to `@warpgogol/repo-extract`.

## How to contribute

### 1. Report a bug or suggest an improvement

- Open a [GitHub Issue](https://github.com/syrokomskyi/repo-extract/issues)
- Describe the problem as precisely as possible. For bugs: steps to reproduce, expected vs. actual behaviour, environment (Node.js version, operating system)

Please read the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) before contributing.

### 2. Code contribution (Pull Request)

1. **Fork** the repository
2. **Create a branch** for your change: `git checkout -b feature/your-description`
3. **Edit** the code. Follow the existing architecture and code style
4. **Test** your change:
   ```bash
   pnpm run build
   pnpm test
   ```
5. **Commit** with a descriptive message in English
6. **Open a Pull Request** including:
   - Description of the change
   - Rationale (why it is needed)
   - Tests you have run

## Code style

- TypeScript, strict mode
- 2 spaces indentation
- `??` instead of `||` for nullish coalescing
- `satisfies` for configs and constant tables
- `override` on class inheritance
- Comments only where explanation improves maintainability

## License

By submitting a contribution, you agree that your contribution will be released under the [Apache License 2.0](LICENSE).
