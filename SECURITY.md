# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.x | Yes |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email the maintainer directly or use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) feature.

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive a response within 72 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Security Measures

This project implements the following security controls:

### Path Traversal Prevention
All file operations route through the `SafePath` value object, which validates and normalizes paths before any I/O. It blocks:
- Directory traversal (`../`, `..\\`)
- URL-encoded traversal (`%2e%2e%2f`)
- Double-encoded traversal (`%252e%252e%252f`)
- Null byte injection (`\0`)
- Empty and whitespace-only paths

### Atomic File Writes
The `LocalFileSystemAdapter` writes to a temporary file first, then renames it to the target path. This prevents partial writes from corrupting notes.

### Docker Security
- The production Docker image runs as a non-root user (`mcp`)
- The vault is mounted as a volume, isolating it from the container filesystem
- The Debian slim base image has a minimal attack surface

### Input Validation
All MCP tool inputs are validated with Zod schemas before processing.
