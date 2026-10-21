import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, useParams, useSearchParams } from "react-router";
import "./styles.css";
import { RequireAuth, SiteLayout } from "./components/Layout";
import { LoginPage } from "./pages/Login";
import { FleetPage } from "./pages/Fleet";
import { TransactionsPage } from "./pages/Transactions";
import { WordPressPage } from "./pages/WordPress";
import { DatabasePage } from "./pages/Database";
import { ExternalPage } from "./pages/External";
import { ErrorsPage } from "./pages/Errors";
import { IssuesPage } from "./pages/Issues";
import { IssueDetailPage } from "./pages/IssueDetail";
import { TracePage } from "./pages/Trace";
import { SettingsPage } from "./pages/Settings";
import { EmptyState } from "./components/ui";

function SiteIndex() {
  const { siteId } = useParams();
  const [params] = useSearchParams();
  return <Navigate to={`/sites/${siteId}/transactions?${params}`} replace />;
}

function NotFound() {
  return (
    <EmptyState title="Page not found">
      <a href="/" className="link">
        Go to sites
      </a>
    </EmptyState>
  );
}

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <FleetPage /> },
      {
        path: "/sites/:siteId",
        element: <SiteLayout />,
        children: [
          { index: true, element: <SiteIndex /> },
          { path: "transactions", element: <TransactionsPage /> },
          { path: "wordpress", element: <WordPressPage /> },
          { path: "database", element: <DatabasePage /> },
          { path: "external", element: <ExternalPage /> },
          { path: "errors", element: <ErrorsPage /> },
          { path: "issues", element: <IssuesPage /> },
          { path: "issues/:fp", element: <IssueDetailPage /> },
          { path: "traces/:tid", element: <TracePage /> },
          { path: "settings", element: <SettingsPage /> },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
