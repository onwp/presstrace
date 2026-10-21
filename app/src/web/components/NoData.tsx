import { Link } from "react-router";
import { useRange } from "../lib/hooks";
import { useSite } from "./Layout";
import { Card, EmptyState } from "./ui";

/**
 * Explains what to do when a site has no data in the selected range. Tabs where an empty list is normal
 * (no errors, no issues) pass `normal` so a healthy site is not told that monitoring may be off.
 */
export function NoData({ what = "requests", normal }: { what?: string; normal?: string }) {
  const site = useSite();
  const [range] = useRange();
  return (
    <Card>
      {site.lastSeen && normal ? (
        <EmptyState title={`No ${what} in this time range`}>
          <p>{normal}</p>
        </EmptyState>
      ) : site.lastSeen ? (
        <EmptyState title={`No ${what} in this time range`}>
          <p>The last data from this site arrived earlier. Pick a longer time range, or check that monitoring is still on in Tools, PressTrace.</p>
        </EmptyState>
      ) : (
        <EmptyState title="No data from this site yet">
          <p>Install the PressTrace plugin, paste the two wp-config.php lines with the site key, and turn on monitoring in Tools, PressTrace.</p>
          <Link to={`/sites/${site.id}/settings?range=${range}`} className="btn-primary mt-3">
            Open setup instructions
          </Link>
        </EmptyState>
      )}
    </Card>
  );
}
