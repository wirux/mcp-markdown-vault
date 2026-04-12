# Contributing

Thank you for considering contributing to the Obsidian Semantic MCP Server.

## Development Setup

```bash
git clone https://github.com/Wirux/mcp-obsidian.git
cd mcp-obsidian
npm install
npm test
```

Requires Node.js >= 22.

## Workflow

1. Fork the repository and create a feature branch from `main`.
2. Write tests first (TDD). Place test files next to the module they test: `foo.ts` → `foo.test.ts`.
3. Implement the feature or fix.
4. Ensure all tests pass: `npm test`
5. Ensure TypeScript compiles cleanly: `npm run lint`
6. Open a pull request against `main`.
7. PR Check CI will run automatically (lint → build → test → Docker dry run).

## Code Guidelines

### Architecture

This project follows Clean Architecture. Respect the layer boundaries:

- **Domain** (`src/domain/`) — No imports from other layers. Pure types, errors, value objects, and port interfaces.
- **Use Cases** (`src/use-cases/`) — May import from domain. Business logic only.
- **Infrastructure** (`src/infrastructure/`) — Implements domain interfaces. May import from domain.
- **Presentation** (`src/presentation/`) — Wires everything together. May import from all layers.

### TypeScript

- Strict mode is enabled with additional flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.)
- All code must compile with zero errors
- Use explicit types at module boundaries; infer internally

### Testing

- Write tests before implementation (RED → GREEN)
- Use real temp directories for file system tests, not mocks
- Use `InMemoryTransport` from the MCP SDK for integration tests
- Co-locate test files: `module.ts` and `module.test.ts` in the same directory

### Error Handling

- Throw domain-specific errors (subclasses of `DomainError`) with machine-readable `code` fields
- Do not use generic `Error` for domain-level failures
- Catch and wrap infrastructure errors into domain errors at the adapter boundary

### Security

- All file paths must go through `SafePath` before any I/O
- Never construct file paths from user input without validation
- See [SECURITY.md](SECURITY.md) for reporting vulnerabilities

## Pull Requests

- Keep PRs focused on a single concern
- Include test coverage for new functionality
- Use [Conventional Commits](https://www.conventionalcommits.org/) — versioning is automated via semantic-release
- Ensure CI passes before requesting review

## Reporting Issues

Open an issue on GitHub with:
- A clear description of the problem or feature request
- Steps to reproduce (for bugs)
- Expected vs actual behavior
