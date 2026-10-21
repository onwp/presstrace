import { CodeBlock } from "./ui";

export function wpConfigSnippet(appUrl: string, key: string): string {
  return `define( 'PRESSTRACE_APP_URL', '${appUrl}' );\ndefine( 'PRESSTRACE_SITE_KEY', '${key}' );`;
}

/** Step-by-step plugin setup. Pass the key when it is known (right after creating or rotating). */
export function SetupSteps({ appUrl, siteKey }: { appUrl: string; siteKey: string | null }) {
  const keyText = siteKey ?? "pt_your_site_key";
  return (
    <ol className="list-decimal space-y-4 pl-5 text-sm">
      <li>
        <p className="font-medium">Install the PressTrace plugin on the WordPress site.</p>
        <p className="mt-1 text-muted">
          Build the zip with <code className="mono">bin/build-plugin.sh</code> in the PressTrace repository, which writes{" "}
          <code className="mono">dist/presstrace-&lt;version&gt;.zip</code>. In WordPress go to Plugins, Add New, Upload Plugin, choose that
          zip and activate it. On activation it adds a small must-use loader and, when no other one exists, a db.php drop-in for query
          timing.
        </p>
      </li>
      <li>
        <p className="font-medium">Add these two lines to wp-config.php, above the line "That's all, stop editing!".</p>
        {!siteKey && (
          <p className="mt-1 text-muted">
            The site key is shown only once, when the site is created or the key is rotated. Rotate the key below if you no longer have it.
          </p>
        )}
        <div className="mt-2">
          <CodeBlock code={wpConfigSnippet(appUrl, keyText)} label="wp-config.php" />
        </div>
      </li>
      <li>
        <p className="font-medium">Open Tools, PressTrace in the WordPress admin.</p>
        <p className="mt-1 text-muted">
          Click Test connection, then turn on monitoring and pick a monitoring window. Data appears here within a few seconds of the next
          page view.
        </p>
      </li>
    </ol>
  );
}
