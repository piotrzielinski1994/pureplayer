import { createRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { greet } from "@/lib/tauri";
import { rootRoute } from "@/routes/__root";

function Greeting() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["greet", "World"],
    queryFn: () => greet("World"),
  });

  if (isPending) return <p className="text-muted-foreground">Loading...</p>;
  if (isError) {
    return (
      <p role="alert" className="text-destructive">
        Failed to reach the backend.
      </p>
    );
  }

  return <p>{data}</p>;
}

function HomePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Home</h1>
      <Greeting />
      <Button>Play</Button>
    </div>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
