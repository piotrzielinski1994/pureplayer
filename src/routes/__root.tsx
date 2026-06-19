import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { CommandPalette } from "@/components/command-palette";

function RootLayout() {
  return (
    <div className="flex h-full flex-col">
      <nav className="flex items-center gap-4 border-b px-4 py-2 text-sm">
        <Link to="/" className="[&.active]:font-semibold">
          Home
        </Link>
        <Link to="/settings" className="[&.active]:font-semibold">
          Settings
        </Link>
      </nav>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  );
}

function NotFound() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">404 - Not found</h1>
      <p className="text-muted-foreground">
        The page you are looking for does not exist.
      </p>
      <Link to="/" className="underline">
        Go home
      </Link>
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});
