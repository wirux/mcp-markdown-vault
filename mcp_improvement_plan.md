# Obsidian MCP Server Rework: Improvement Plan & Agent Context

## 1. Project Context
This project is a custom, **headless** MCP (Model Context Protocol) server for Obsidian. It interacts directly with the local file system and does not require the Obsidian desktop app.

## 2. Architectural & Methodological Standards (MANDATORY)
To ensure long-term maintainability and reliability, the following standards must be strictly followed:
* **Clean Architecture:** Maintain a strict separation of concerns. 
    * **Domain/Entities:** Core logic and business rules.
    * **Use Cases:** Application-specific business rules.
    * **Interface Adapters:** Conversion of data from MCP tools to Use Cases.
    * **Frameworks & Drivers:** External tools (File System, MCP SDK).
* **TDD (Test-Driven Development):** * Every new feature or bug fix must start with a failing test.
    * Implementation is complete only when tests pass and the code is refactored for clarity.
    * Maintain high test coverage for Use Cases and Domain logic.

## 3. Current State Analysis
### What works well:
* **Deep Listing:** Recursive `.md` file discovery.
* **Reliable Reading:** Direct raw note fetching.
* **AST-based Editing:** Stable, deterministic heading/block-based updates.

### Gaps to Address:
1.  **Global Vault Search:** Currently, search is limited to a single file. We need a cross-vault search capability.
2.  **Freeform / Line-based Editing:** A fallback mechanism is needed for text that doesn't fit the AST (heading/block) structure.
3.  **Utility Methods:** Re-evaluating the need for basic file system utilities (if not already present).

## 4. Tasks for the AI Agent

### Task 1: Implement Global Vault Search (via TDD)
* **Goal:** Enable keyword search across all indexed `.md` files.
* **Requirement:** Start by defining the `SearchUseCase` and its unit tests. Mock the file system access. Only then implement the search logic using the existing index.

### Task 2: Implement Fallback Freeform Editing (via TDD)
* **Goal:** Provide a way to edit files using line numbers or string replacement.
* **Requirement:** Ensure this is implemented as a separate Use Case. Write tests for edge cases (file not found, multiple string matches, whitespace sensitivity).

### Task 3: Refactor existing code to Clean Architecture
* **Goal:** If the current rework has mixed concerns (e.g., MCP tool logic mixed with file system logic), refactor it.
* **Requirement:** Move core logic into Use Cases/Entities so the server can be easily tested without real file system calls.

## 5. Development Guidelines
* **Deterministic Output:** Avoid brittle regex for file modifications.
* **Verbose Error Handling:** Return clear, actionable errors to the MCP client.
* **Self-Correction:** If a test fails, analyze the architectural layer responsible and fix it there, rather than applying a "quick patch."
