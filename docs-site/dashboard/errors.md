# Errors

The **Errors** page lists PHP errors from traced requests, grouped by level, message, file and line.

![The Errors page: PHP errors with message and file path, level (exception, warning, notice, deprecated, fatal), component, count, first seen and last seen](/screenshots/errors.png){.shot}

| Column | Meaning |
|---|---|
| Message | The error message, with the file and line below it. Click it for sample requests. |
| Level | `Fatal`, `Error`, `Exception` (uncaught), `Warning`, `Notice` or `Deprecated`. |
| Component | The plugin, theme or core code the file belongs to. |
| Count | How many times it was recorded in the range, in traced requests. |
| First seen, Last seen | Within the range. |

Numbers and hex values in messages are replaced before grouping, so `Undefined offset 12` and `Undefined offset 7` are one row.

## How errors are caught

The agent chains its own error and exception handlers in front of any existing ones, and checks for a fatal error at shutdown. Every error is passed on, so the WordPress debug log and other handlers keep working. The same error at the same place is kept once per request, and at most 50 different errors are kept per request.

Errors are only recorded on traced requests. With a sample rate of 0.1, the count is about a tenth of the real number.

## Errors and issues

Fatal errors, errors and uncaught exceptions raise a high [PHP error](/issues/#php-error) issue. Warnings raise a low one. Notices and deprecations show here but do not raise issues.
