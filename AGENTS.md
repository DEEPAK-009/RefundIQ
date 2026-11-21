# Project Guidelines & Rules

## Strict Policy: Absolutely No Emojis

1. **Zero Emojis Allowed**: Never use emojis anywhere in this project.
   - Prohibited in: Source code, comments, console log messages, error messages, user interface / HTML templates, API responses, test descriptions, markdown documentation, commit messages, and agent responses.
2. **Professional Plain-Text Format**:
   - Use standard ASCII status tags for logging and console output:
     - `[INFO]` for informational logs
     - `[WARN]` for warnings
     - `[ERROR]` for errors
     - `[SUCCESS]` for successful operations
     - `[TEST]` for test suites and executions
     - `[PASS]` for passing tests
     - `[FAIL]` for failing tests
   - For UI elements, use FontAwesome icon classes (e.g., `<i class="fa-solid fa-utensils"></i>`) or clean text labels.
3. **Automated Enforcement**:
   - Run `npm run lint:no-emoji` to verify that zero emojis exist in the project.
