# Implementation Plan: Frontmatter / YAML Management (Clean Architecture & TDD)

## Objective
Implement safe, object-based read and update operations for Markdown YAML frontmatter. This provides the AI agent with a reliable way to manage tags, statuses, and other metadata without corrupting the file structure.

## Architecture Layers
1. **Domain/Interfaces:** Data Transfer Objects (DTOs) and Repository contracts.
2. **Use Cases:** Two distinct use cases: `GetFrontmatterUseCase` and `SetFrontmatterUseCase`.
3. **Infrastructure:** The actual file modifier, utilizing a robust parser (e.g., `gray-matter` for Node.js).
4. **Delivery/Controller:** MCP action handlers (`frontmatter_get`, `frontmatter_set`).

---

### Step 1: Define Interfaces (Domain)
Define how the application interacts with frontmatter data.

* Update or create `IMarkdownRepository` to include:
    * `readFrontmatter(filePath: string): Promise<Record<string, any>>`
    * `updateFrontmatter(filePath: string, dataToMerge: Record<string, any>): Promise<void>`
* Create DTOs:
    * `GetFrontmatterRequest { path: string }`
    * `GetFrontmatterResponse { frontmatter: Record<string, any> }`
    * `SetFrontmatterRequest { path: string, content: string }` (content is a JSON-stringified object representing the fields to update).

### Step 2: Write Tests for the Use Cases (TDD Phase 1 - RED)
Write unit tests using a mocked `IMarkdownRepository`.

* **Tests for `GetFrontmatterUseCase`:**
    * **Test 1:** File has frontmatter. Mock returns an object `{ tags: ["mcp"], status: "draft" }`. Use case should return it successfully.
    * **Test 2:** File has NO frontmatter. Mock returns an empty object `{}`. Use case should handle this gracefully.

* **Tests for `SetFrontmatterUseCase`:**
    * **Test 3:** Update existing key. Input payload: `{"status": "published"}`. The Use Case should call `repository.updateFrontmatter` with the correct path and parsed JSON object.
    * **Test 4:** Add new key to existing frontmatter.
    * **Test 5:** Invalid JSON payload. If `SetFrontmatterRequest.content` is not valid JSON, the Use Case must throw a clear, structured error instead of crashing.

### Step 3: Implement the Use Cases (TDD Phase 2 - GREEN & REFACTOR)
Implement the business logic.

* **`GetFrontmatterUseCase`:** Simply validates the path and delegates to `repository.readFrontmatter`.
* **`SetFrontmatterUseCase`:** 1. Parses the incoming `content` string into a JavaScript/Python object.
    2. Catches JSON parsing errors and throws a Domain Error (e.g., `InvalidFrontmatterPayloadError`).
    3. Delegates to `repository.updateFrontmatter(path, parsedObject)`.

### Step 4: Implement Infrastructure (Repository)
Implement the actual file manipulation in `MarkdownFileRepository`. This is where you MUST use a dedicated parser (like `gray-matter`).

* **`readFrontmatter` implementation:** Read the file, pass it to the parser, and return the `data` object. If no frontmatter exists, return `{}`.
* **`updateFrontmatter` implementation:**
    1. Read the file and parse it (separating `data` from `content`).
    2. Deep merge the existing `data` object with the new `dataToMerge` object. (e.g., `Object.assign({}, existingData, dataToMerge)` or a deep merge utility).
    3. Stringify the merged object back into the frontmatter format, appending the original Markdown `content`.
    4. Write the file back to disk.
* *Note: Write at least one Integration Test here writing to a temporary dummy `.md` file to verify that the Markdown content below the YAML block is completely untouched.*

### Step 5: Wire up the Controller (MCP Action)
Expose the new actions to the MCP server.

* Create a new action handler (or add to existing `rework_edit`):
    * Action: `frontmatter_get`. Maps to `GetFrontmatterUseCase`. Returns JSON stringified frontmatter to the MCP client.
    * Action: `frontmatter_set`. Maps to `SetFrontmatterUseCase`. Returns a success message.
